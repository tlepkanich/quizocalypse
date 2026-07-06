import type { HeadersFunction, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import quizRuntimeStyles from "../styles/quiz-runtime.css?url";
import { isRouteErrorResponse, useLoaderData, useParams, useRouteError } from "@remix-run/react";
import { useState } from "react";
import prisma from "../db.server";
import { Quiz, type QuizNode } from "../lib/quizSchema";
import { recommendForResult, type IndexedProduct } from "../lib/recommendationEngine";
import { applyTranslations, parseLocaleParam, resolveLocale } from "../lib/quizTranslate";
import { stripPublicDoc } from "../lib/quizPublish";
import { chromeFor, t, type ChromeToken } from "../components/runtime/chromeStrings";
import { formatDate } from "../lib/formatDate";
import { rateLimit } from "../lib/rateLimiters";

// BIC-2 B1 — shopper-side sheet only (base body reset); no admin CSS here.
export const links: LinksFunction = () => [{ rel: "stylesheet", href: quizRuntimeStyles }];

// Public "My Results" page (Miro "Save State & Resume → persistent recommendation
// page; return via email link"). A shopper returns via a link carrying
// ?session_id=<token>; we read the saved QuizSession and re-render the outcome +
// matched products. session_id is an unguessable capability token, so no auth —
// only non-PII fields are exposed. Reuses recommendForResult (the same engine the
// live runtime uses) rather than rebuilding the result logic.

// Remix derives a document's headers from this export, NOT from a thrown
// Response's headers — without it the limiter's Retry-After never reaches the
// client. Forwards it from the thrown 429 (errorHeaders); everything else is
// unchanged (empty object = the pre-existing no-route-headers behavior).
// NB: errorHeaders is only consulted when THIS route owns the error boundary,
// hence the ErrorBoundary export below.
export const headers: HeadersFunction = ({ errorHeaders }) => {
  const out: Record<string, string> = {};
  const retryAfter = errorHeaders?.get("Retry-After");
  if (retryAfter) out["Retry-After"] = retryAfter;
  return out;
};

// Route-local boundary: (1) it makes the headers export receive the thrown
// 429's errorHeaders (Retry-After), and (2) shoppers hitting an error on a
// shared results link get a plain message + a way into the quiz instead of the
// bare framework error screen. Thrown redirects (the unknown-session soft
// path) never land here.
export function ErrorBoundary() {
  const error = useRouteError();
  const { id } = useParams();
  const throttled = isRouteErrorResponse(error) && error.status === 429;
  return (
    <div style={shellStyle}>
      <p>
        {throttled
          ? "Too many requests — please wait a moment and try again."
          : "We couldn't load these results."}{" "}
        {id ? <a href={`/q/${id}`}>Take the quiz</a> : null}
      </p>
    </div>
  );
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing id", { status: 400 });
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) throw new Response("Missing session_id", { status: 400 });

  // BIC-2 A2(c) — session_id is a bearer capability token; throttle lookups so
  // it can't be brute-forced. 30/min/IP is far above any legitimate shopper
  // (one click from an email/share link) while making enumeration useless.
  // Checked BEFORE any DB read; unknown sessions still soft-redirect below.
  const rl = rateLimit(request, "results", 30);
  if (!rl.ok) {
    throw new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(rl.retryAfterS) },
    });
  }

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { id: true, name: true, publishedJson: true },
  });
  if (!quiz?.publishedJson) {
    throw new Response("Quiz not found or not published", { status: 404 });
  }
  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) {
    throw new Response("Published JSON failed validation", { status: 500 });
  }

  const session = await prisma.quizSession.findUnique({
    where: { quizId_sessionId: { quizId: quiz.id, sessionId } },
    select: { outcomeId: true, answerIds: true, completedAt: true },
  });
  // BIC P6: soften unknown sessions into "retake the quiz" instead of an error
  // page — Klaviyo emails can fire BEFORE the result render writes the session
  // row, and old sessions may be pruned. The link should never dead-end.
  if (!session) throw redirect(`/q/${quiz.id}`);

  const publishedRaw = quiz.publishedJson as {
    product_index?: IndexedProduct[];
    shop_domain?: string;
    answer_weights?: Record<string, number>;
    // LOGIC v2 (L2-9) — the decider bake, recovered from the raw JSON (the
    // answer_weights pattern; Quiz.safeParse strips publish-time-only fields).
    target_product_ids_map?: Record<string, string[]>;
    target_index?: Record<string, { type: "product" | "collection" | "tag"; name?: string }>;
  };
  const targetFields = {
    ...(publishedRaw.target_product_ids_map
      ? { targetProductIdsMap: publishedRaw.target_product_ids_map }
      : {}),
    ...(publishedRaw.target_index ? { targetIndex: publishedRaw.target_index } : {}),
  };
  // Phase K2 — localize BEFORE share/recs compute so the whole page (and its
  // unfurl) follows the locale. Strip the raw maps from what we serve.
  const requestedLocale = new URL(request.url).searchParams.get("locale");
  const availableLocales = Object.keys(parsed.data.translations ?? {});
  const locale = resolveLocale(parseLocaleParam(requestedLocale), availableLocales);
  const localizedDoc = locale
    ? applyTranslations(parsed.data, parsed.data.translations![locale]!.strings)
    : parsed.data;
  const chrome = chromeFor(locale ? parsed.data.translations![locale]!.strings : null);
  parsed.data = localizedDoc;

  // Phase L1 — share metadata, computed server-side so the meta export can
  // build a rich unfurl (crawlers never run JS). Top recommendation's image
  // doubles as the og:image — real product photography, zero image pipeline.
  const productIndex = publishedRaw.product_index ?? [];
  const outcomeNode =
    parsed.data.nodes.find((n) => n.type === "result" && n.id === session.outcomeId) ??
    parsed.data.nodes.find((n) => n.type === "result");
  const shareRecs =
    outcomeNode && outcomeNode.type === "result"
      ? recommendForResult({
          quiz: parsed.data,
          productIndex,
          selectedAnswerIds: session.answerIds,
          resultNodeId: outcomeNode.id,
          ...(publishedRaw.answer_weights ? { answerWeights: publishedRaw.answer_weights } : {}),
          ...targetFields,
        })
      : [];
  const share = {
    title:
      outcomeNode?.type === "result"
        ? `My ${quiz.name} match: ${outcomeNode.data.headline}`
        : `My ${quiz.name} results`,
    description:
      shareRecs.length > 0
        ? `Top picks: ${shareRecs.slice(0, 3).map((r) => r.title).join(" · ")}`
        : "See the products matched to my answers.",
    image: shareRecs.find((r) => r.image_url)?.image_url ?? null,
    url: request.url,
  };

  return json({
    quizId: quiz.id,
    doc: stripPublicDoc(parsed.data),
    productIndex,
    shopDomain: publishedRaw.shop_domain ?? "",
    answerWeights: publishedRaw.answer_weights ?? null,
    targetProductIdsMap: publishedRaw.target_product_ids_map ?? null,
    targetIndex: publishedRaw.target_index ?? null,
    share,
    locale: locale ?? "en",
    chrome,
    session: {
      outcomeId: session.outcomeId,
      answerIds: session.answerIds,
      completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    },
  });
};

// Rich unfurls when a shopper shares their results link (Phase L1).
export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Quiz results" }];
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
    ...(share.image ? [{ name: "twitter:image", content: share.image }] : []),
  ];
};

export default function MyResults() {
  const {
    quizId,
    doc,
    productIndex,
    shopDomain,
    answerWeights,
    targetProductIdsMap,
    targetIndex,
    share,
    session,
    locale,
    chrome,
  } = useLoaderData<typeof loader>();
  const tc = (token: ChromeToken, vars?: Record<string, string | number>) =>
    t(chrome as Record<ChromeToken, string>, token, vars);
  const localeSuffix = locale !== "en" ? `?locale=${encodeURIComponent(locale)}` : "";

  // The saved outcome node, falling back to the first result if it was removed
  // in a later re-publish.
  const resultNode =
    doc.nodes.find(
      (n): n is Extract<QuizNode, { type: "result" }> =>
        n.type === "result" && n.id === session.outcomeId,
    ) ?? doc.nodes.find((n): n is Extract<QuizNode, { type: "result" }> => n.type === "result");

  if (!resultNode) {
    return (
      <div style={shellStyle} lang={locale}>
        <p>
          {tc("results_gone")}{" "}
          <a href={`/q/${quizId}${localeSuffix}`} style={{ color: "#2a6df4" }}>
            {tc("take_again")}
          </a>
        </p>
      </div>
    );
  }

  const recs = recommendForResult({
    quiz: doc,
    productIndex,
    selectedAnswerIds: session.answerIds,
    resultNodeId: resultNode.id,
    ...(answerWeights ? { answerWeights } : {}),
    ...(targetProductIdsMap ? { targetProductIdsMap } : {}),
    ...(targetIndex ? { targetIndex } : {}),
  });
  const completedDate = session.completedAt ? formatDate(session.completedAt) : null;

  return (
    <div style={shellStyle} lang={locale}>
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: "#666", fontSize: 13, margin: "0 0 4px" }}>
          {completedDate
            ? tc("saved_results_from", { date: completedDate })
            : tc("saved_results")}
        </p>
        <h1 style={{ margin: "0 0 4px", fontSize: 26 }}>{resultNode.data.headline}</h1>
        {resultNode.data.subtext ? (
          <p style={{ color: "#555", margin: 0 }}>{resultNode.data.subtext}</p>
        ) : null}
        <ShareRow title={share.title} />
      </div>

      {recs.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: 16,
          }}
        >
          {recs.map((r) => {
            const productUrl =
              shopDomain && r.handle ? `https://${shopDomain}/products/${r.handle}` : undefined;
            return (
              <div
                key={r.product_id}
                style={{ border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden", background: "#fff" }}
              >
                {r.image_url ? (
                  <img
                    src={r.image_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }}
                  />
                ) : null}
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{r.title}</div>
                  {r.price ? <div style={{ fontSize: 13, color: "#444" }}>{r.price}</div> : null}
                  {productUrl ? (
                    <a
                      href={productUrl}
                      style={{ display: "inline-block", marginTop: 8, fontSize: 13, color: "#2a6df4", textDecoration: "none" }}
                    >
                      {resultNode.data.cta_label || "Shop now"} →
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p style={{ color: "#666" }}>No product recommendations found.</p>
      )}

      <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid #e5e5e5" }}>
        <a href={`/q/${quizId}`} style={{ color: "#666", fontSize: 13 }}>
          Retake this quiz →
        </a>
      </div>
    </div>
  );
}

// Phase L1 — let the shopper send their results anywhere: native share sheet
// where available (mobile), copy-link everywhere. The link itself unfurls
// richly via the meta export above.
function ShareRow({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const btn: React.CSSProperties = {
    font: "inherit",
    fontSize: 13,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #d9d9d9",
    background: "#fff",
    cursor: "pointer",
  };
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button
        type="button"
        style={btn}
        onClick={async () => {
          const url = window.location.href;
          if (navigator.share) {
            try {
              await navigator.share({ title, url });
              return;
            } catch {
              // dismissed the sheet — fall through to copy
            }
          }
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard blocked — the address bar still has the link
          }
        }}
      >
        {copied ? "Copied ✓" : "↗ Share my results"}
      </button>
    </div>
  );
}

const shellStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "40px auto",
  padding: "0 16px",
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  color: "#1a1a1a",
};
