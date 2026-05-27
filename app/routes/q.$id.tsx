import { useEffect, useMemo, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import {
  nextNodeFor,
  recommendForResult,
  recommendPreview,
  type IndexedProduct,
  type RecommendedProduct,
} from "../lib/recommendationEngine";
import {
  resolveDesignTokens,
  tokensToCssVars,
  buttonStyle,
  type DesignTokensT,
} from "../lib/designTokens";
import { createAnalyticsClient, newSessionId } from "../lib/analytics";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

const SYSTEM_FONTS = new Set([
  "system",
  "system-ui",
  "Inter",
  "Helvetica",
  "Arial",
  "Georgia",
  "Times",
  "Times New Roman",
  "Courier",
  "Courier New",
]);

function googleFontsUrl(families: string[]): string | null {
  const params = families
    .filter((f) => f && !SYSTEM_FONTS.has(f))
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`);
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.join("&")}&display=swap`;
}

// Public shopper-facing runtime. No Polaris, no Shopify auth — this is what
// a real customer sees when the merchant shares the quiz link. Spec §3.6.

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing id", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      publishedJson: true,
    },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  if (!quiz.publishedJson) {
    throw new Response("Quiz not yet published", { status: 404 });
  }

  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) {
    throw new Response("Published JSON failed validation", { status: 500 });
  }
  // product_index + shop_domain aren't in the Zod schema (added at publish time).
  const publishedRaw = quiz.publishedJson as {
    product_index?: IndexedProduct[];
    shop_domain?: string;
  };

  return json({
    quizId: quiz.id,
    name: quiz.name,
    doc: parsed.data,
    productIndex: publishedRaw.product_index ?? [],
    designTokens: parsed.data.design_tokens ?? null,
    designOverrides: parsed.data.design_overrides ?? {},
    shopDomain: publishedRaw.shop_domain ?? "",
  });
};

const stylesFor = (t: DesignTokensT) => ({
  page: {
    minHeight: "100vh",
    background: "#FAFAFA",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: "var(--qz-font-body)",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  card: {
    background: "var(--qz-color-bg)",
    borderRadius: "var(--qz-radius)",
    padding: "calc(var(--qz-pad) * 1.6)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
    maxWidth: 560,
    width: "100%",
  } satisfies React.CSSProperties,
  primaryBtn: {
    ...buttonStyle(t),
    marginTop: 24,
    borderRadius: "var(--qz-radius)",
    padding: "calc(var(--qz-pad) / 2) var(--qz-pad)",
    fontFamily: "var(--qz-font-body)",
    fontSize: "var(--qz-base-size)",
    fontWeight: 600,
    cursor: "pointer",
  } satisfies React.CSSProperties,
  answerBtn: {
    textAlign: "left" as const,
    background: "var(--qz-color-bg)",
    border: "2px solid #00000022",
    borderRadius: "var(--qz-radius)",
    padding: "var(--qz-pad)",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    color: "var(--qz-color-text)",
    cursor: "pointer",
    transition: "border-color 150ms",
    width: "100%",
  } satisfies React.CSSProperties,
  productCard: {
    display: "flex",
    gap: 16,
    padding: "var(--qz-pad)",
    borderRadius: "var(--qz-radius)",
    border: "1px solid #00000010",
    background: "var(--qz-color-bg)",
    alignItems: "center" as const,
    textDecoration: "none",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  h1: {
    margin: 0,
    fontSize: "var(--qz-h1-size)",
    fontFamily: "var(--qz-font-heading)",
    lineHeight: 1.2,
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  h2: {
    margin: 0,
    fontSize: "var(--qz-h2-size)",
    fontFamily: "var(--qz-font-heading)",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  muted: {
    marginTop: 12,
    color: "var(--qz-color-muted)",
    fontSize: "calc(var(--qz-base-size) * 1.05)",
  } satisfies React.CSSProperties,
});

interface PathStep {
  questionNodeId: string;
  answerIds: string[];
}

export default function StorefrontRuntime() {
  const { doc, productIndex, designTokens, designOverrides, quizId, shopDomain } =
    useLoaderData<typeof loader>();
  const introNode = useMemo(
    () => doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0],
    [doc.nodes],
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(
    introNode ? introNode.id : null,
  );
  const [path, setPath] = useState<PathStep[]>([]);

  // Resolve baked tokens + the current node's override on every render — this
  // is what implements the design cascade at the storefront layer.
  const resolved = useMemo(() => {
    const baked = designTokens as DesignTokensT | null;
    const nodeOverride = currentNodeId
      ? ((designOverrides as Record<string, DesignTokensT>)[currentNodeId] ?? null)
      : null;
    return resolveDesignTokens(baked, nodeOverride);
  }, [designTokens, designOverrides, currentNodeId]);

  const styles = useMemo(() => stylesFor(resolved), [resolved]);
  const cssVars = useMemo(
    () => tokensToCssVars(resolved) as React.CSSProperties,
    [resolved],
  );
  const fontUrl = useMemo(() => {
    const heading = resolved.typography?.heading?.family;
    const body = resolved.typography?.body?.family;
    return googleFontsUrl([heading ?? "", body ?? ""]);
  }, [resolved]);

  // Analytics: session-scoped tracker + start/completion timing.
  const sessionIdRef = useRef<string>(null as unknown as string);
  if (!sessionIdRef.current) sessionIdRef.current = newSessionId();
  const analyticsRef = useRef<ReturnType<typeof createAnalyticsClient> | null>(null);
  const startedAtRef = useRef<number>(0);
  const completedRef = useRef(false);

  useEffect(() => {
    const client = createAnalyticsClient({
      quizId,
      sessionId: sessionIdRef.current,
    });
    analyticsRef.current = client;
    client.start();
    const source =
      typeof window !== "undefined" && window.self !== window.top
        ? "embed"
        : "direct";
    startedAtRef.current = Date.now();
    client.track("quiz_started", { source });
    return () => {
      client.stop();
    };
  }, [quizId]);

  // Apply CSS vars at the very root so all children resolve var(--qz-*).
  const rootStyle: React.CSSProperties = { ...cssVars };

  // Mid-quiz product preview: active once any answered question is flagged.
  const previewActive = useMemo(
    () =>
      path.some((step) => {
        const node = doc.nodes.find((n) => n.id === step.questionNodeId);
        return node?.type === "question" && node.data.show_preview_after === true;
      }),
    [path, doc.nodes],
  );

  const previewRecs = useMemo(() => {
    if (!previewActive) return [];
    const ids = path.flatMap((p) => p.answerIds);
    return recommendPreview({
      quiz: doc,
      productIndex,
      selectedAnswerIds: ids,
    });
  }, [previewActive, path, doc, productIndex]);

  // Fire recommendation_viewed once when the preview first activates.
  const previewViewedRef = useRef(false);
  useEffect(() => {
    if (
      previewActive &&
      !previewViewedRef.current &&
      analyticsRef.current
    ) {
      previewViewedRef.current = true;
      analyticsRef.current.track("recommendation_viewed", {
        stage: "preview",
        product_ids: previewRecs.map((r) => r.product_id),
      });
    }
  }, [previewActive, previewRecs]);

  const handlePreviewClick = (product: RecommendedProduct, position: number) => {
    analyticsRef.current?.track("recommendation_clicked", {
      stage: "preview",
      product_id: product.product_id,
      position,
    });
  };

  function reset() {
    setCurrentNodeId(introNode ? introNode.id : null);
    setPath([]);
    previewViewedRef.current = false;
  }

  function gotoNextFrom(nodeId: string, handle: string | null) {
    const next = nextNodeFor(doc, nodeId, handle);
    if (!next) return;
    setCurrentNodeId(next);
  }

  let content: React.ReactNode;

  if (!currentNodeId) {
    content = (
      <div style={styles.card}>
        <h1 style={styles.h1}>Quiz unavailable</h1>
        <p>This quiz has no nodes defined.</p>
      </div>
    );
  } else {
    const currentNode = doc.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) {
      content = (
        <div style={styles.card}>
          <h1 style={styles.h1}>Lost the thread</h1>
          <p>Reached an unknown node — the quiz may have a missing edge.</p>
        </div>
      );
    } else if (currentNode.type === "intro") {
      content = (
        <div style={styles.card}>
          <h1 style={styles.h1}>{currentNode.data.headline}</h1>
          {currentNode.data.subtext && (
            <p style={styles.muted}>{currentNode.data.subtext}</p>
          )}
          <button
            style={styles.primaryBtn}
            onClick={() => gotoNextFrom(currentNode.id, null)}
          >
            {currentNode.data.button_label}
          </button>
        </div>
      );
    } else if (currentNode.type === "question") {
      content = (
        <QuestionView
          node={currentNode}
          styles={styles}
          tokens={resolved}
          onAdvance={(answerIds, handle) => {
            analyticsRef.current?.track("question_answered", {
              question_id: currentNode.id,
              answer_ids: answerIds,
            });
            setPath((prev) => [
              ...prev,
              { questionNodeId: currentNode.id, answerIds },
            ]);
            gotoNextFrom(currentNode.id, handle);
          }}
        />
      );
    } else if (currentNode.type === "email_gate") {
      content = (
        <EmailGateView
          node={currentNode}
          styles={styles}
          quizId={quizId}
          sessionId={sessionIdRef.current}
          onSubmit={() => gotoNextFrom(currentNode.id, null)}
        />
      );
    } else {
      // result
      const selectedAnswerIds = path.flatMap((p) => p.answerIds);
      const recs = recommendForResult({
        quiz: doc,
        productIndex,
        selectedAnswerIds,
        resultNodeId: currentNode.id,
      });
      content = (
        <ResultView
          headline={currentNode.data.headline}
          subtext={currentNode.data.subtext}
          ctaLabel={currentNode.data.cta_label}
          recs={recs}
          resultNodeId={currentNode.id}
          styles={styles}
          startedAt={startedAtRef.current}
          completed={completedRef}
          analytics={analyticsRef.current}
          onReset={reset}
        />
      );
    }
  }

  const currentNode = currentNodeId
    ? doc.nodes.find((n) => n.id === currentNodeId)
    : null;
  const showPreview = previewActive && currentNode?.type !== "result";

  return (
    <div style={rootStyle}>
      {fontUrl && <link rel="stylesheet" href={fontUrl} />}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0ms !important;
            scroll-behavior: auto !important;
          }
        }
        .qz-runtime-shell { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 24px; }
        @media (min-width: 900px) {
          .qz-runtime-page {
            align-items: flex-start !important;
            justify-content: center !important;
            padding-top: 64px !important;
          }
          .qz-runtime-shell {
            flex-direction: row;
            align-items: flex-start;
            max-width: 1100px;
            gap: 40px;
          }
          .qz-runtime-content {
            flex: 1;
            min-width: 0;
            display: flex;
            justify-content: center;
          }
          .qz-preview-rail {
            flex: 0 0 320px;
            position: sticky;
            top: 64px;
          }
          .qz-preview-chip { display: none !important; }
        }
        @media (max-width: 899px) {
          .qz-preview-rail { display: none; }
        }
      `}</style>
      <div className="qz-runtime-page" style={styles.page}>
        <div className="qz-runtime-shell">
          <div className="qz-runtime-content">{content}</div>
          {showPreview && (
            <div className="qz-preview-rail">
              <PreviewRail
                recs={previewRecs}
                shopDomain={shopDomain}
                onClick={handlePreviewClick}
              />
            </div>
          )}
        </div>
        {showPreview && (
          <PreviewChip
            recs={previewRecs}
            shopDomain={shopDomain}
            onClick={handlePreviewClick}
          />
        )}
      </div>
    </div>
  );
}

function PreviewRail({
  recs,
  shopDomain,
  onClick,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
}) {
  return (
    <aside
      style={{
        background: "var(--qz-color-bg)",
        borderRadius: "var(--qz-radius)",
        padding: 20,
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--qz-font-body)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--qz-color-muted)",
          marginBottom: 4,
        }}
      >
        Picks for you
      </div>
      <div
        style={{
          fontFamily: "var(--qz-font-heading)",
          fontSize: 20,
          marginBottom: 14,
          color: "var(--qz-color-text)",
        }}
      >
        Updating as you answer
      </div>
      <PreviewList recs={recs} shopDomain={shopDomain} onClick={onClick} />
    </aside>
  );
}

function PreviewChip({
  recs,
  shopDomain,
  onClick,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="qz-preview-chip"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 50,
          padding: "8px 14px",
          background: "var(--qz-color-text)",
          color: "var(--qz-color-bg)",
          border: "none",
          borderRadius: 100,
          fontSize: 13,
          fontFamily: "var(--qz-font-body)",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}
      >
        Picks for you ({recs.length}) {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 49,
            }}
          />
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 50,
              background: "var(--qz-color-bg)",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 20,
              maxHeight: "70vh",
              overflowY: "auto",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--qz-font-heading)",
                fontSize: 22,
                marginBottom: 12,
                color: "var(--qz-color-text)",
              }}
            >
              Picks for you
            </div>
            <PreviewList recs={recs} shopDomain={shopDomain} onClick={onClick} />
          </div>
        </>
      )}
    </>
  );
}

function PreviewList({
  recs,
  shopDomain,
  onClick,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
}) {
  if (recs.length === 0) {
    return (
      <p
        style={{
          color: "var(--qz-color-muted)",
          fontSize: 13,
          margin: 0,
        }}
      >
        Pick more answers to see refined picks.
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {recs.map((r, idx) => {
        const href = shopDomain
          ? `https://${shopDomain}/products/${r.handle}`
          : undefined;
        const inner = (
          <>
            {r.image_url ? (
              <img
                src={r.image_url}
                alt=""
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "cover",
                  borderRadius: "var(--qz-radius)",
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  background: "#00000010",
                  borderRadius: "var(--qz-radius)",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 14,
                  color: "var(--qz-color-text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.title}
              </div>
              {r.price && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--qz-color-muted)",
                    marginTop: 2,
                  }}
                >
                  ${r.price}
                </div>
              )}
            </div>
          </>
        );
        const cardStyle: React.CSSProperties = {
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: 8,
          borderRadius: "var(--qz-radius)",
          border: "1px solid #00000012",
          textDecoration: "none",
          color: "inherit",
          background: "var(--qz-color-bg)",
        };
        return href ? (
          <a
            key={r.product_id}
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={() => onClick(r, idx)}
            style={cardStyle}
          >
            {inner}
          </a>
        ) : (
          <div key={r.product_id} style={cardStyle}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function QuestionView({
  node,
  onAdvance,
  styles,
  tokens,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
  tokens: DesignTokensT;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const isMulti = node.data.question_type === "multi_select";

  if (isMulti) {
    const selectedIds = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => k);
    const max = node.data.max_selections;
    const tooMany = typeof max === "number" && selectedIds.length > max;
    return (
      <div style={styles.card}>
        <h2 style={styles.h2}>{node.data.text}</h2>
        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
          {node.data.answers.map((a) => (
            <label
              key={a.id}
              style={{
                ...styles.answerBtn,
                display: "flex",
                gap: 12,
                alignItems: "center",
                borderColor: checked[a.id]
                  ? "var(--qz-color-primary)"
                  : "#00000022",
              }}
            >
              <input
                type="checkbox"
                checked={!!checked[a.id]}
                onChange={(e) =>
                  setChecked({ ...checked, [a.id]: e.target.checked })
                }
              />
              {a.text}
            </label>
          ))}
        </div>
        <button
          style={{
            ...styles.primaryBtn,
            opacity: selectedIds.length === 0 || tooMany ? 0.5 : 1,
          }}
          disabled={selectedIds.length === 0 || tooMany}
          onClick={() => {
            const first = node.data.answers.find((a) => checked[a.id]);
            onAdvance(selectedIds, first ? first.edge_handle_id : null);
          }}
        >
          Next
          {tooMany ? ` (max ${max})` : ""}
        </button>
      </div>
    );
  }

  // single_select / image_tile
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{node.data.text}</h2>
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {node.data.answers.map((a) => (
          <button
            key={a.id}
            style={styles.answerBtn}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--qz-color-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#00000022";
            }}
            onClick={() => onAdvance([a.id], a.edge_handle_id)}
          >
            {node.data.question_type === "image_tile" && a.image_url && (
              <img
                src={a.image_url}
                alt=""
                style={{
                  width: "100%",
                  maxHeight: 200,
                  objectFit: "cover",
                  borderRadius: "var(--qz-radius)",
                  marginBottom: 8,
                }}
              />
            )}
            {a.text}
          </button>
        ))}
      </div>
    </div>
  );
  // (typescript exhaustiveness assist — unused but satisfies the tokens prop)
  void tokens;
}

function EmailGateView({
  node,
  styles,
  quizId,
  sessionId,
  onSubmit,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "email_gate" }>;
  styles: ReturnType<typeof stylesFor>;
  quizId: string;
  sessionId: string;
  onSubmit: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email);

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quiz_id: quizId,
          session_id: sessionId,
          email,
          ...(name ? { first_name: name } : {}),
        }),
        keepalive: true,
      });
    } catch {
      // Don't block the quiz on capture failure.
    } finally {
      onSubmit();
    }
  }
  const inputStyle: React.CSSProperties = {
    padding: "12px 14px",
    borderRadius: "var(--qz-radius)",
    border: "1px solid #00000022",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
  };
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{node.data.headline}</h2>
      {node.data.subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }}>{node.data.subtext}</p>
      )}
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        {node.data.name_optional && (
          <input
            type="text"
            placeholder="First name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
      </div>
      <button
        style={{ ...styles.primaryBtn, opacity: valid && !submitting ? 1 : 0.5 }}
        disabled={!valid || submitting}
        onClick={handleSubmit}
      >
        {submitting ? "…" : "Continue"}
      </button>
      {node.data.skip_allowed && (
        <button
          onClick={onSubmit}
          style={{
            background: "none",
            border: "none",
            color: "var(--qz-color-muted)",
            fontSize: 14,
            cursor: "pointer",
            marginTop: 12,
            padding: 0,
          }}
        >
          Skip
        </button>
      )}
    </div>
  );
}

function ResultView({
  headline,
  subtext,
  ctaLabel,
  recs,
  resultNodeId,
  styles,
  startedAt,
  completed,
  analytics,
  onReset,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  recs: RecommendedProduct[];
  resultNodeId: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  onReset: () => void;
}) {
  // Fire completion + view events once when the result first renders.
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: recs.map((r) => r.product_id),
    });
  }, [analytics, completed, resultNodeId, startedAt, recs]);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{headline}</h2>
      {subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }}>{subtext}</p>
      )}
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {recs.length === 0 && (
          <p style={{ color: "var(--qz-color-muted)" }}>
            No products to show. Add a fallback collection in the editor.
          </p>
        )}
        {recs.map((r, idx) => (
          <ProductCard
            key={r.product_id}
            product={r}
            position={idx}
            ctaLabel={ctaLabel}
            styles={styles}
            onClick={() =>
              analytics?.track("recommendation_clicked", {
                product_id: r.product_id,
                position: idx,
              })
            }
          />
        ))}
      </div>
      <button
        onClick={onReset}
        style={{
          ...styles.primaryBtn,
          background: "transparent",
          color: "var(--qz-color-primary)",
          border: "2px solid var(--qz-color-primary)",
          marginTop: 24,
        }}
      >
        Start over
      </button>
    </div>
  );
}

function ProductCard({
  product,
  position,
  ctaLabel,
  styles,
  onClick,
}: {
  product: RecommendedProduct;
  position: number;
  ctaLabel: string;
  styles: ReturnType<typeof stylesFor>;
  onClick?: () => void;
}) {
  void position;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.productCard,
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
      }}
    >
      {product.image_url ? (
        <img
          src={product.image_url}
          alt=""
          style={{
            width: 80,
            height: 80,
            objectFit: "cover",
            borderRadius: "var(--qz-radius)",
            flexShrink: 0,
          }}
        />
      ) : (
        <div
          style={{
            width: 80,
            height: 80,
            background: "#00000010",
            borderRadius: "var(--qz-radius)",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{product.title}</div>
        {product.price && (
          <div style={{ color: "var(--qz-color-muted)", marginTop: 4 }}>
            ${product.price}
          </div>
        )}
        {!product.inventory_in_stock && (
          <div style={{ color: "#D72C0D", marginTop: 4, fontSize: 12 }}>
            Out of stock
          </div>
        )}
      </div>
      <span
        style={{
          background: "var(--qz-color-text)",
          color: "var(--qz-color-bg)",
          border: "none",
          borderRadius: "var(--qz-radius)",
          padding: "8px 16px",
          fontSize: 14,
        }}
      >
        {ctaLabel}
      </span>
    </button>
  );
}
