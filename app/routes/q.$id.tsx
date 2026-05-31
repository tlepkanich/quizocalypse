import { useEffect, useMemo, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { Quiz, type ResultStage as ResultStageT } from "../lib/quizSchema";
import {
  resolveNextStep,
  recommendForResult,
  recommendForStage,
  recommendPreview,
  type BranchContext,
  type IndexedProduct,
  type RecommendedProduct,
} from "../lib/recommendationEngine";
import { resolveNodeOverride } from "../lib/resultLayout";
import {
  resolveForBreakpoint,
  tokensToCssVars,
  type DesignTokensT,
} from "../lib/designTokens";
import { createAnalyticsClient, newSessionId } from "../lib/analytics";
import {
  buildMergeContext,
  resolveMergeTags,
  type PathStep,
} from "../lib/mergeTags";
import {
  stylesFor,
  googleFontsUrl,
  useBreakpoint,
} from "../components/runtime/runtimeStyles";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

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
    breakpointOverrides: parsed.data.breakpoint_overrides ?? {},
    resultLayoutMode: parsed.data.result_layout_mode,
    shopDomain: publishedRaw.shop_domain ?? "",
  });
};


export default function StorefrontRuntime() {
  const {
    doc,
    productIndex,
    designTokens,
    designOverrides,
    breakpointOverrides,
    resultLayoutMode,
    quizId,
    shopDomain,
  } = useLoaderData<typeof loader>();
  const introNode = useMemo(
    () => doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0],
    [doc.nodes],
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(
    introNode ? introNode.id : null,
  );
  const [path, setPath] = useState<PathStep[]>([]);
  const breakpoint = useBreakpoint();

  // Resolve baked tokens + the current node's override on every render — this
  // is what implements the design cascade at the storefront layer. The
  // breakpoint layer is picked from breakpoint_overrides[nodeId][bp] and only
  // applied if the viewport matches.
  const resolved = useMemo(() => {
    const baked = designTokens as DesignTokensT | null;
    const currentNodeType = currentNodeId
      ? (doc.nodes.find((n) => n.id === currentNodeId)?.type ?? "")
      : "";
    const nodeOverride = currentNodeId
      ? resolveNodeOverride(
          currentNodeId,
          currentNodeType,
          resultLayoutMode,
          designOverrides as Record<string, DesignTokensT>,
        )
      : null;
    const bpRecord = currentNodeId
      ? (breakpointOverrides as Record<
          string,
          { desktop?: DesignTokensT; mobile?: DesignTokensT }
        >)[currentNodeId]
      : undefined;
    const bpLayer = bpRecord?.[breakpoint] ?? null;
    return resolveForBreakpoint(null, baked, nodeOverride, bpLayer);
  }, [
    designTokens,
    designOverrides,
    breakpointOverrides,
    resultLayoutMode,
    currentNodeId,
    breakpoint,
    doc.nodes,
  ]);

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
    // Note: we deliberately do NOT clear ab assignments on reset — the spec
    // wants stickiness across retakes within a session for honest A/B
    // attribution. Closing the tab clears sessionStorage and re-rolls.
  }

  // Sticky A/B assignments: persisted to sessionStorage keyed by quizId so
  // refreshes inside the same tab don't re-roll. Lives in a ref so writes
  // don't trigger re-renders.
  const abKey = `qz-ab-${quizId}`;
  const abRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(abKey);
      if (raw) abRef.current = JSON.parse(raw) as Record<string, string>;
    } catch {
      // sessionStorage may be unavailable (private mode, embed sandbox); just
      // fall through to in-memory assignments.
    }
  }, [abKey]);

  function buildBranchContext(): BranchContext {
    const selectedAnswerIds = new Set<string>();
    const accumulatedTags = new Set<string>();
    for (const step of path) {
      const node = doc.nodes.find((n) => n.id === step.questionNodeId);
      if (!node || node.type !== "question") continue;
      for (const ansId of step.answerIds) {
        selectedAnswerIds.add(ansId);
        const ans = node.data.answers.find((a) => a.id === ansId);
        if (ans) for (const t of ans.tags) accumulatedTags.add(t);
      }
    }
    return {
      selectedAnswerIds,
      accumulatedTags,
      abAssignments: abRef.current,
    };
  }

  function gotoNextFrom(nodeId: string, handle: string | null) {
    const ctx = buildBranchContext();
    const next = resolveNextStep(doc, nodeId, handle, ctx);
    // Persist any A/B assignments mutated while traversing branches.
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(abKey, JSON.stringify(ctx.abAssignments));
      } catch {
        // Same as above — ignore storage failures.
      }
    }
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
    } else if (currentNode.type === "message") {
      // v2: Message step. Renders the merge-tag-resolved text and advances on click.
      const ctx = buildMergeContext(path, doc);
      const rendered = resolveMergeTags(currentNode.data.text, ctx);
      content = (
        <div style={styles.card}>
          <p style={{ ...styles.muted, whiteSpace: "pre-wrap", margin: 0 }}>
            {rendered}
          </p>
          <button
            style={styles.primaryBtn}
            onClick={() => gotoNextFrom(currentNode.id, null)}
          >
            Continue
          </button>
        </div>
      );
    } else if (currentNode.type === "end") {
      const node = currentNode;
      content = (
        <div style={styles.card}>
          <h2 style={styles.h2}>{node.data.headline}</h2>
          {node.data.subtext && (
            <p style={{ ...styles.muted, marginTop: 8 }}>{node.data.subtext}</p>
          )}
          {node.data.cta_url && (
            <a
              href={node.data.cta_url}
              target="_blank"
              rel="noreferrer"
              style={{
                ...styles.primaryBtn,
                display: "inline-block",
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {node.data.cta_label ?? "Continue"}
            </a>
          )}
        </div>
      );
    } else if (currentNode.type === "ask_ai") {
      content = (
        <AskAIView
          node={currentNode}
          quizId={quizId}
          path={path}
          styles={styles}
          onContinue={() => gotoNextFrom(currentNode.id, null)}
        />
      );
    } else if (currentNode.type === "integration") {
      // Transient — IntegrationView fires the configured actions server-side
      // and then advances. UI shows a brief "Saving…" state.
      content = (
        <IntegrationView
          node={currentNode}
          quizId={quizId}
          path={path}
          styles={styles}
          onDone={() => gotoNextFrom(currentNode.id, null)}
        />
      );
    } else if (currentNode.type === "product_cards") {
      content = (
        <ProductCardsView
          node={currentNode}
          productIndex={productIndex}
          shopDomain={shopDomain}
          styles={styles}
          onContinue={() => gotoNextFrom(currentNode.id, null)}
        />
      );
    } else if (currentNode.type === "result") {
      const selectedAnswerIds = path.flatMap((p) => p.answerIds);
      const stages = currentNode.data.stages;
      if (stages.length === 0) {
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
      } else {
        const stageSections = stages.map((stage) => ({
          stage,
          recs: recommendForStage(
            doc,
            productIndex,
            selectedAnswerIds,
            currentNode.id,
            stage,
          ),
        }));
        content = (
          <MultiStageResultView
            headline={currentNode.data.headline}
            subtext={currentNode.data.subtext}
            ctaLabel={currentNode.data.cta_label}
            sections={stageSections}
            resultNodeId={currentNode.id}
            shopDomain={shopDomain}
            styles={styles}
            startedAt={startedAtRef.current}
            completed={completedRef}
            analytics={analyticsRef.current}
            onReset={reset}
          />
        );
      }
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
  const [freeform, setFreeform] = useState("");
  const isMulti = node.data.question_type === "multi_select";
  const isFreeform =
    node.data.question_type === "text" || node.data.question_type === "email";

  if (isFreeform) {
    // Freeform input: the typed value becomes the answer text. We piggy-back
    // on the question's seed answer (answers[0]) so tag accumulation +
    // outbound edge routing stay identical to card questions.
    const seed = node.data.answers[0];
    const cfg = node.data.input_config;
    const placeholder = cfg?.placeholder ?? "";
    const maxLength = cfg?.max_length ?? 120;
    const inputType = node.data.question_type === "email" ? "email" : "text";
    const required = node.data.required;
    const value = freeform.trim();
    const canSubmit =
      !required ||
      (value.length > 0 &&
        (inputType !== "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)));
    return (
      <div style={styles.card}>
        <h2 style={styles.h2}>{node.data.text}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || !seed) return;
            // Capture the typed value as the picked answer so it shows up in
            // merge tags and the path. The runtime persists step.answerIds
            // by id; here we use the seed answer's id.
            onAdvance([seed.id], seed.edge_handle_id);
            // (We don't yet persist the typed string — that lands in the
            // path-derived merge context via the seed answer's text. Future
            // phase: dedicated freeform_responses[] in the path.)
          }}
          style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}
        >
          <input
            type={inputType}
            value={freeform}
            onChange={(e) => setFreeform(e.target.value.slice(0, maxLength))}
            placeholder={placeholder}
            maxLength={maxLength}
            autoFocus
            style={{
              ...styles.answerBtn,
              padding: "var(--qz-pad)",
              textAlign: "left",
              cursor: "text",
            }}
          />
          <button
            type="submit"
            style={{
              ...styles.primaryBtn,
              opacity: canSubmit ? 1 : 0.5,
            }}
            disabled={!canSubmit}
          >
            Continue
          </button>
        </form>
      </div>
    );
  }

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

  // Searchable: same single-select semantics, but with a top search input
  // that substring-filters the answer list. Useful for long pickers (brand,
  // country, etc.) where scrolling 50+ buttons would be annoying.
  if (node.data.question_type === "searchable") {
    return <SearchableQuestion node={node} onAdvance={onAdvance} styles={styles} />;
  }

  // ImagePicker: dense thumbnail grid. Each answer's image dominates with a
  // small caption underneath. Visual-first picking — like "which of these
  // styles feels right?".
  if (node.data.question_type === "image_picker") {
    return (
      <div style={styles.card}>
        <h2 style={styles.h2}>{node.data.text}</h2>
        <div
          style={{
            marginTop: 20,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 10,
          }}
        >
          {node.data.answers.map((a) => (
            <button
              key={a.id}
              style={{
                ...styles.answerBtn,
                padding: 6,
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 6,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--qz-color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#00000022";
              }}
              onClick={() => onAdvance([a.id], a.edge_handle_id)}
            >
              {a.image_url ? (
                <img
                  src={a.image_url}
                  alt=""
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: "var(--qz-radius)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    background: "#00000010",
                    borderRadius: "var(--qz-radius)",
                  }}
                />
              )}
              <span style={{ fontSize: 12 }}>{a.text}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // single_select / image_tile (default fall-through)
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

// Substring-filtered single-select. Hoisted to its own component so the
// search state doesn't churn the parent.
function SearchableQuestion({
  node,
  onAdvance,
  styles,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? node.data.answers.filter((a) => a.text.toLowerCase().includes(needle))
    : node.data.answers;
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{node.data.text}</h2>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        autoFocus
        style={{
          ...styles.answerBtn,
          marginTop: 16,
          padding: "12px 14px",
          textAlign: "left",
          cursor: "text",
          fontSize: "var(--qz-base-size)",
        }}
      />
      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 8,
          maxHeight: 360,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 16,
              color: "var(--qz-color-muted)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            No matches for &ldquo;{query}&rdquo;.
          </div>
        ) : (
          filtered.map((a) => (
            <button
              key={a.id}
              style={{
                ...styles.answerBtn,
                padding: "10px 14px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--qz-color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#00000022";
              }}
              onClick={() => onAdvance([a.id], a.edge_handle_id)}
            >
              {a.text}
            </button>
          ))
        )}
      </div>
    </div>
  );
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

// Conversational chat step. Renders an opening assistant turn, optional
// suggested-question quick-reply chips, the running transcript, and a text
// input. Each user send posts to /q/:id/ai-chat and appends the reply.
// "Continue" advances to the next quiz node. max_turns capped client-side
// to mirror the server-side enforcement.
function AskAIView({
  node,
  quizId,
  path,
  styles,
  onContinue,
}: {
  node: Extract<
    z.infer<typeof Quiz>["nodes"][number],
    { type: "ask_ai" }
  >;
  quizId: string;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
}) {
  type Turn = { role: "user" | "assistant"; content: string };
  const [transcript, setTranscript] = useState<Turn[]>([
    { role: "assistant", content: node.data.opening_message },
  ]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, sending]);

  const assistantTurns = transcript.filter((t) => t.role === "assistant").length;
  // Opening message counts as turn 1, so cap allows max_turns total replies.
  const turnsRemaining = Math.max(0, node.data.max_turns - assistantTurns);
  const canSend = !sending && draft.trim().length > 0 && turnsRemaining > 0;

  async function send(message: string) {
    if (!message.trim()) return;
    if (turnsRemaining <= 0) return;
    setSending(true);
    setError(null);
    const nextTurn: Turn = { role: "user", content: message };
    // Build the history we forward — strip the synthetic opening message so
    // Claude doesn't re-see it; the system prompt already names the persona.
    const history = transcript
      .slice(1)
      .map((t) => ({ role: t.role, content: t.content }));
    setTranscript((prev) => [...prev, nextTurn]);
    setDraft("");
    try {
      const res = await fetch(`/q/${quizId}/ai-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: node.id,
          path,
          history,
          userMessage: message,
        }),
      });
      const body = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !body.reply) {
        setError(body.error ?? "Something went wrong.");
        setTranscript((prev) => prev.slice(0, -1)); // roll back user turn
        return;
      }
      setTranscript((prev) => [
        ...prev,
        { role: "assistant", content: body.reply! },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setTranscript((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  const bubble = (turn: Turn): React.CSSProperties => ({
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: "var(--qz-radius)",
    background:
      turn.role === "user" ? "var(--qz-color-primary)" : "#00000010",
    color: turn.role === "user" ? "#FFF" : "var(--qz-color-text)",
    alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
    whiteSpace: "pre-wrap",
    fontSize: "var(--qz-base-size)",
    lineHeight: 1.4,
  });

  return (
    <div style={{ ...styles.card, display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <h2 style={{ ...styles.h2, margin: 0 }}>{node.data.persona_name}</h2>
        <span
          style={{
            fontSize: 11,
            color: "var(--qz-color-muted)",
            fontFamily: "monospace",
          }}
        >
          {turnsRemaining > 0
            ? `${turnsRemaining} turn${turnsRemaining === 1 ? "" : "s"} left`
            : "Chat ended"}
        </span>
      </div>
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          maxHeight: 360,
          overflowY: "auto",
          paddingRight: 4,
        }}
      >
        {transcript.map((turn, i) => (
          <div key={i} style={bubble(turn)}>
            {turn.content}
          </div>
        ))}
        {sending && (
          <div
            style={{
              ...bubble({ role: "assistant", content: "" }),
              opacity: 0.6,
              fontStyle: "italic",
            }}
          >
            Thinking…
          </div>
        )}
      </div>
      {transcript.length === 1 && node.data.suggested_questions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {node.data.suggested_questions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              disabled={!canSend && sending}
              style={{
                background: "transparent",
                border: "1px solid #00000020",
                borderRadius: "var(--qz-radius)",
                padding: "6px 10px",
                cursor: "pointer",
                fontSize: 12,
                color: "var(--qz-color-text)",
                fontFamily: "var(--qz-font-body)",
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "#C2410C20",
            color: "#C2410C",
            padding: 8,
            borderRadius: "var(--qz-radius)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) send(draft);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending || turnsRemaining <= 0}
          placeholder={turnsRemaining > 0 ? "Type a question…" : "Chat ended"}
          style={{
            flex: 1,
            padding: "10px 12px",
            border: "1px solid #00000022",
            borderRadius: "var(--qz-radius)",
            fontSize: "var(--qz-base-size)",
            fontFamily: "var(--qz-font-body)",
          }}
        />
        <button
          type="submit"
          disabled={!canSend}
          style={{
            ...styles.primaryBtn,
            marginTop: 0,
            opacity: canSend ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </form>
      <button
        type="button"
        onClick={onContinue}
        style={{
          ...styles.primaryBtn,
          marginTop: 0,
          background: "transparent",
          color: "var(--qz-color-primary)",
          border: "2px solid var(--qz-color-primary)",
        }}
      >
        {node.data.continue_label}
      </button>
    </div>
  );
}

// Transient step. Fires the integration node's configured actions
// server-side, then advances. The shopper sees a brief "Saving…" while the
// fetch runs. continue_on_error (true by default) lets the runtime move on
// even if every webhook failed — better than dead-ending on a broken Zap.
function IntegrationView({
  node,
  quizId,
  path,
  styles,
  onDone,
}: {
  node: Extract<
    z.infer<typeof Quiz>["nodes"][number],
    { type: "integration" }
  >;
  quizId: string;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onDone: () => void;
}) {
  const fired = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/q/${quizId}/integration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId: node.id, path }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          if (!node.data.continue_on_error) {
            setError(body.error ?? "Integration failed.");
            return;
          }
        }
        onDone();
      } catch (err) {
        if (cancelled) return;
        if (!node.data.continue_on_error) {
          setError(err instanceof Error ? err.message : "Network error.");
          return;
        }
        onDone();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [node.id, node.data.continue_on_error, quizId, path, onDone]);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{error ? "Something went wrong" : "Saving…"}</h2>
      {error ? (
        <>
          <p style={styles.muted}>{error}</p>
          <button style={styles.primaryBtn} onClick={onDone}>
            Continue anyway
          </button>
        </>
      ) : (
        <p style={styles.muted}>One moment — sending your answers along.</p>
      )}
    </div>
  );
}

// Visible step that shows merchant-picked products as cards. Distinct from
// Result (scored recommendations on the path) and the mid-quiz preview rail
// (refining list). Products that aren't in product_index render a graceful
// fallback so a deleted SKU doesn't break the step.
function ProductCardsView({
  node,
  productIndex,
  shopDomain,
  styles,
  onContinue,
}: {
  node: Extract<
    z.infer<typeof Quiz>["nodes"][number],
    { type: "product_cards" }
  >;
  productIndex: IndexedProduct[];
  shopDomain: string;
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
}) {
  const products = node.data.product_ids
    .map((id) => productIndex.find((p) => p.product_id === id))
    .filter((p): p is IndexedProduct => !!p);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{node.data.headline}</h2>
      {node.data.subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }}>{node.data.subtext}</p>
      )}
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${products.length > 2 ? 180 : 240}px, 1fr))`,
          gap: 12,
        }}
      >
        {products.map((p) => (
          <a
            key={p.product_id}
            href={
              shopDomain
                ? `https://${shopDomain}/products/${p.handle}`
                : `#${p.handle}`
            }
            target="_blank"
            rel="noreferrer"
            style={{
              ...styles.productCard,
              flexDirection: "column",
              alignItems: "stretch",
              gap: 8,
            }}
          >
            {p.image_url && (
              <img
                src={p.image_url}
                alt=""
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  borderRadius: "var(--qz-radius)",
                }}
              />
            )}
            <div style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</div>
            {p.price && (
              <div
                style={{
                  color: "var(--qz-color-muted)",
                  fontSize: 12,
                }}
              >
                ${p.price}
              </div>
            )}
            <span
              style={{
                marginTop: 4,
                fontSize: 12,
                color: "var(--qz-color-primary)",
                fontWeight: 600,
              }}
            >
              {node.data.cta_label} →
            </span>
          </a>
        ))}
        {products.length === 0 && (
          <div
            style={{
              padding: 16,
              border: "1px dashed #00000022",
              borderRadius: "var(--qz-radius)",
              color: "var(--qz-color-muted)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            None of the configured products are available right now.
          </div>
        )}
      </div>
      <button style={{ ...styles.primaryBtn, marginTop: 16 }} onClick={onContinue}>
        {node.data.continue_label}
      </button>
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

// Multi-stage (Advanced) result page. Renders the page headline/subtext, then
// each stage as its own section (stage headline/subtext + its product cards),
// reusing the same ProductCard markup as the single-result view. Fires the
// same result analytics events once on first render, using the union of all
// stages' product ids for recommendation_viewed.
function MultiStageResultView({
  headline,
  subtext,
  ctaLabel,
  sections,
  resultNodeId,
  shopDomain,
  styles,
  startedAt,
  completed,
  analytics,
  onReset,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  sections: { stage: ResultStageT; recs: RecommendedProduct[] }[];
  resultNodeId: string;
  shopDomain: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  onReset: () => void;
}) {
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: sections.flatMap((s) => s.recs.map((r) => r.product_id)),
    });
  }, [analytics, completed, resultNodeId, startedAt, sections]);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{headline}</h2>
      {subtext && <p style={{ ...styles.muted, marginTop: 8 }}>{subtext}</p>}
      <div style={{ marginTop: 20, display: "grid", gap: 28 }}>
        {sections.map(({ stage, recs }) => (
          <StageSection
            key={stage.id}
            stage={stage}
            recs={recs}
            ctaLabel={ctaLabel}
            shopDomain={shopDomain}
            styles={styles}
            analytics={analytics}
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

function StageSection({
  stage,
  recs,
  ctaLabel,
  shopDomain,
  styles,
  analytics,
}: {
  stage: ResultStageT;
  recs: RecommendedProduct[];
  ctaLabel: string;
  shopDomain: string;
  styles: ReturnType<typeof stylesFor>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
}) {
  return (
    <section>
      {stage.headline && (
        <h2 style={{ ...styles.h2, fontSize: "var(--qz-h2-size)" }}>
          {stage.headline}
        </h2>
      )}
      {stage.subtext && (
        <p style={{ ...styles.muted, marginTop: 6 }}>{stage.subtext}</p>
      )}
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        {recs.length === 0 && (
          <p style={{ color: "var(--qz-color-muted)" }}>
            No products to show for this section.
          </p>
        )}
        {recs.map((r, idx) => {
          const href = shopDomain
            ? `https://${shopDomain}/products/${r.handle}`
            : undefined;
          return (
            <ProductCard
              key={r.product_id}
              product={r}
              position={idx}
              ctaLabel={ctaLabel}
              href={href}
              styles={styles}
              onClick={() =>
                analytics?.track("recommendation_clicked", {
                  result_stage_id: stage.id,
                  product_id: r.product_id,
                  position: idx,
                })
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function ProductCard({
  product,
  position,
  ctaLabel,
  href,
  styles,
  onClick,
}: {
  product: RecommendedProduct;
  position: number;
  ctaLabel: string;
  // When set, the card renders as a PDP link (multi-stage result sections).
  // When omitted, it stays the click-tracked button (single-result view).
  href?: string;
  styles: ReturnType<typeof stylesFor>;
  onClick?: () => void;
}) {
  void position;
  const inner = (
    <>
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
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={onClick}
        style={{
          ...styles.productCard,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {inner}
      </a>
    );
  }

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
      {inner}
    </button>
  );
}
