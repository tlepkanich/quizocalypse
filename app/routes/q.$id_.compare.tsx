import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { Quiz, type QuizNode } from "../lib/quizSchema";
import { recommendForResult, type IndexedProduct, type RecommendedProduct } from "../lib/recommendationEngine";
import { compareBuddies } from "../lib/buddyCompare";
import { applyTranslations, resolveLocale } from "../lib/quizTranslate";

// ════════════════════════════════════════════════════════════════════════════
// Buddy mode (Phase L2) — /q/:id/compare?a=<session>&b=<session>: two saved
// sessions side by side, plus the products BOTH shoppers match and an
// agreement score. Capability-token security, same as My Results: session ids
// are unguessable, and the page exposes only outcomes + products (no PII).
// ════════════════════════════════════════════════════════════════════════════

type ResultNode = Extract<QuizNode, { type: "result" }>;

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing id", { status: 400 });
  const url = new URL(request.url);
  const a = url.searchParams.get("a");
  const b = url.searchParams.get("b");
  if (!a || !b) throw new Response("Missing session ids", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { id: true, name: true, publishedJson: true },
  });
  if (!quiz?.publishedJson) throw new Response("Quiz not found", { status: 404 });
  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) throw new Response("Invalid quiz", { status: 500 });

  const sessions = await prisma.quizSession.findMany({
    where: { quizId: quiz.id, sessionId: { in: [a, b] }, completedAt: { not: null } },
  });
  const sessA = sessions.find((s) => s.sessionId === a);
  const sessB = sessions.find((s) => s.sessionId === b);
  if (!sessA || !sessB) throw new Response("Sessions not found", { status: 404 });

  // Locale overlay before anything renders or unfurls (Phase K machinery).
  const requestedLocale = url.searchParams.get("locale");
  const locale = resolveLocale(requestedLocale, Object.keys(parsed.data.translations ?? {}));
  const doc = locale
    ? applyTranslations(parsed.data, parsed.data.translations![locale]!.strings)
    : parsed.data;

  const publishedRaw = quiz.publishedJson as { product_index?: IndexedProduct[]; shop_domain?: string; answer_weights?: Record<string, number> };
  const productIndex = publishedRaw.product_index ?? [];

  const resolve = (outcomeId: string | null, answerIds: string[]) => {
    const node =
      doc.nodes.find((n): n is ResultNode => n.type === "result" && n.id === outcomeId) ??
      doc.nodes.find((n): n is ResultNode => n.type === "result");
    const recs = node
      ? recommendForResult({ quiz: doc, productIndex, selectedAnswerIds: answerIds, resultNodeId: node.id, ...(publishedRaw.answer_weights ? { answerWeights: publishedRaw.answer_weights } : {}) })
      : [];
    return { headline: node?.data.headline ?? "", recs };
  };
  const A = resolve(sessA.outcomeId, sessA.answerIds);
  const B = resolve(sessB.outcomeId, sessB.answerIds);
  const comparison = compareBuddies({
    recsA: A.recs,
    recsB: B.recs,
    outcomeA: sessA.outcomeId,
    outcomeB: sessB.outcomeId,
  });

  const share = {
    title: comparison.sameOutcome
      ? `We're a match: both got "${A.headline}"`
      : `${quiz.name}: "${A.headline}" vs "${B.headline}"`,
    description: `${comparison.agreementPct}% match${
      comparison.shared.length > 0
        ? ` · We both suit: ${comparison.shared.slice(0, 3).map((r) => r.title).join(" · ")}`
        : ""
    }`,
    image:
      comparison.shared.find((r) => r.image_url)?.image_url ??
      A.recs.find((r) => r.image_url)?.image_url ??
      null,
    url: request.url,
  };

  return json({
    quizId: quiz.id,
    shopDomain: publishedRaw.shop_domain ?? "",
    locale: locale ?? "en",
    a: { headline: A.headline, recs: A.recs.slice(0, 5) },
    b: { headline: B.headline, recs: B.recs.slice(0, 5) },
    comparison: { ...comparison, shared: comparison.shared.slice(0, 5) },
    share,
  });
};

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Quiz comparison" }];
  const { share } = data;
  return [
    { title: share.title },
    { name: "description", content: share.description },
    { property: "og:title", content: share.title },
    { property: "og:description", content: share.description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: share.url },
    ...(share.image ? [{ property: "og:image", content: share.image }] : []),
    { name: "twitter:card", content: share.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: share.title },
    { name: "twitter:description", content: share.description },
  ];
};

function ProductStrip({ recs, shopDomain }: { recs: RecommendedProduct[]; shopDomain: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
      {recs.map((r) => {
        const href = shopDomain && r.handle ? `https://${shopDomain}/products/${r.handle}` : undefined;
        const card = (
          <div style={{ border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
            {r.image_url ? (
              <img src={r.image_url} alt="" loading="lazy" decoding="async"
                style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
            ) : null}
            <div style={{ padding: "6px 8px", fontSize: 12, fontWeight: 600 }}>{r.title}</div>
          </div>
        );
        return href ? (
          <a key={r.product_id} href={href} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
            {card}
          </a>
        ) : (
          <div key={r.product_id}>{card}</div>
        );
      })}
    </div>
  );
}

export default function BuddyCompare() {
  const { quizId, shopDomain, locale, a, b, comparison } = useLoaderData<typeof loader>();
  const localeSuffix = locale !== "en" ? `?locale=${encodeURIComponent(locale)}` : "";
  return (
    <div lang={locale} style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", color: "#1a1a1a" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1 }}>{comparison.agreementPct}%</div>
        <div style={{ color: "#666", marginTop: 4 }}>match</div>
        {comparison.sameOutcome ? (
          <div style={{ marginTop: 8, fontSize: 14 }}>🤝 You both landed on “{a.headline}”</div>
        ) : null}
      </div>

      {comparison.shared.length > 0 ? (
        <div style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, margin: "0 0 10px" }}>You both suit</h2>
          <ProductStrip recs={comparison.shared} shopDomain={shopDomain} />
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {[
          { label: "You", side: a },
          { label: "Your friend", side: b },
        ].map(({ label, side }) => (
          <div key={label}>
            <div style={{ fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
            <h2 style={{ fontSize: 18, margin: "4px 0 10px" }}>{side.headline}</h2>
            <ProductStrip recs={side.recs} shopDomain={shopDomain} />
          </div>
        ))}
      </div>

      <p style={{ textAlign: "center", marginTop: 28 }}>
        <a href={`/q/${quizId}${localeSuffix}`} style={{ color: "#2a6df4" }}>
          Take the quiz →
        </a>
      </p>
    </div>
  );
}
