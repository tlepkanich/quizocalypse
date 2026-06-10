import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useState } from "react";
import prisma from "../db.server";
import { Quiz, type QuizNode } from "../lib/quizSchema";
import { recommendForResult, type IndexedProduct } from "../lib/recommendationEngine";

// Public "My Results" page (Miro "Save State & Resume → persistent recommendation
// page; return via email link"). A shopper returns via a link carrying
// ?session_id=<token>; we read the saved QuizSession and re-render the outcome +
// matched products. session_id is an unguessable capability token, so no auth —
// only non-PII fields are exposed. Reuses recommendForResult (the same engine the
// live runtime uses) rather than rebuilding the result logic.

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing id", { status: 400 });
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) throw new Response("Missing session_id", { status: 400 });

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
  };
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
    doc: parsed.data,
    productIndex,
    shopDomain: publishedRaw.shop_domain ?? "",
    share,
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
  const { quizId, doc, productIndex, shopDomain, share, session } = useLoaderData<typeof loader>();

  // The saved outcome node, falling back to the first result if it was removed
  // in a later re-publish.
  const resultNode =
    doc.nodes.find(
      (n): n is Extract<QuizNode, { type: "result" }> =>
        n.type === "result" && n.id === session.outcomeId,
    ) ?? doc.nodes.find((n): n is Extract<QuizNode, { type: "result" }> => n.type === "result");

  if (!resultNode) {
    return (
      <div style={shellStyle}>
        <p>
          Your results are no longer available.{" "}
          <a href={`/q/${quizId}`} style={{ color: "#2a6df4" }}>
            Take the quiz again →
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
  });
  const completedDate = session.completedAt
    ? new Date(session.completedAt).toLocaleDateString()
    : null;

  return (
    <div style={shellStyle}>
      <div style={{ marginBottom: 24 }}>
        <p style={{ color: "#666", fontSize: 13, margin: "0 0 4px" }}>
          Your saved results{completedDate ? ` from ${completedDate}` : ""}
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
