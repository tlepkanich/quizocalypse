import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz, ResultStage as ResultStageT } from "../../lib/quizSchema";
import { isFreeformType } from "../../lib/quizSchema";
import {
  resolveNextStep,
  recommendForResult,
  recommendForStage,
  recommendPreview,
  selectSecondaryRecs,
  type BranchContext,
  type IndexedProduct,
  type RecommendedProduct,
} from "../../lib/recommendationEngine";
import { resolveNodeOverride } from "../../lib/resultLayout";
import { cartPermalink, numericId } from "../../lib/cartLink";
import { progressPct, reachableQuestionCount } from "../../lib/progress";
import {
  resolveForBreakpoint,
  tokensToCssVars,
  type DesignTokensT,
} from "../../lib/designTokens";
import { createAnalyticsClient, newSessionId } from "../../lib/analytics";
import {
  buildMergeContext,
  resolveMergeTags,
  type PathStep,
} from "../../lib/mergeTags";
import { stylesFor, googleFontsUrl, useBreakpoint } from "./runtimeStyles";
import { BlockRenderer, type BlockRenderCtx } from "./BlockRenderer";

type QuizDoc = Quiz;

// ════════════════════════════════════════════════════════════════════════════
// QuizRuntime — the interactive shopper-facing quiz, extracted from q.$id.tsx so
// BOTH the public storefront route (mode="live") AND the builder's Preview step
// (mode="preview") render the identical runtime. Server-free (no prisma / node
// imports) so it bundles into the builder's client. In mode="preview" every
// side-effect (analytics, localStorage, /captures, add-to-cart, integration,
// ai-chat) is a no-op, the breakpoint follows the `breakpoint` prop (the
// resizable frame width) instead of the window, and `tokensOverride` powers
// instant theme reskins. mode="live" is byte-identical to the old route.
// ════════════════════════════════════════════════════════════════════════════

export type QuizRuntimeMode = "live" | "preview";

export interface QuizRuntimeProps {
  doc: QuizDoc;
  productIndex: IndexedProduct[];
  designTokens: DesignTokensT | null;
  designOverrides: Record<string, DesignTokensT>;
  breakpointOverrides: Record<
    string,
    { desktop?: DesignTokensT; mobile?: DesignTokensT }
  >;
  resultLayoutMode: QuizDoc["result_layout_mode"];
  quizId: string;
  version: number;
  shopDomain: string;
  mode?: QuizRuntimeMode;
  // Preview-only (ignored when mode==="live"). Preview always starts fresh at
  // the intro because the localStorage restore effect early-returns on isPreview.
  tokensOverride?: DesignTokensT | null;
  breakpoint?: "desktop" | "mobile";
}

// Content-block types the storefront renders directly. Literal blocks render via
// BlockRenderer; `recommendations` delegates to the (bare) result view. Layouts
// containing the harder interactive regions (answers/email_input/ai_chat/
// product_grid) fall back to the node's fixed template — safe + byte-identical.
const RUNTIME_BLOCK_TYPES = new Set([
  "heading",
  "text",
  "image",
  "button",
  "spacer",
  "divider",
  "recommendations",
]);

// Preview mode flag shared with the deep leaf views (cart / email-capture /
// integration / ai-chat) so they can no-op their side-effects without threading
// a prop through every intermediate component. Default false = live.
const RuntimePreviewContext = createContext(false);

export function QuizRuntime(props: QuizRuntimeProps) {
  const {
    doc,
    productIndex,
    designTokens,
    designOverrides,
    breakpointOverrides,
    resultLayoutMode,
    quizId,
    version,
    shopDomain,
    mode = "live",
    tokensOverride = null,
    breakpoint: breakpointProp,
  } = props;
  const isPreview = mode === "preview";
  const introNode = useMemo(
    () => doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0],
    [doc.nodes],
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(
    introNode ? introNode.id : null,
  );
  const [path, setPath] = useState<PathStep[]>([]);
  const liveBreakpoint = useBreakpoint();
  // In preview the breakpoint follows the resizable device-frame width (the
  // `breakpoint` prop); live follows the real window via useBreakpoint().
  const breakpoint = isPreview ? (breakpointProp ?? "desktop") : liveBreakpoint;

  // Resolve baked tokens + the current node's override on every render — this
  // is what implements the design cascade at the storefront layer. The
  // breakpoint layer is picked from breakpoint_overrides[nodeId][bp] and only
  // applied if the viewport matches.
  const resolved = useMemo(() => {
    // Preview reskin: a live `tokensOverride` replaces the quiz layer so theme
    // swatches restyle instantly (no save). undefined in live → unchanged.
    const baked = (tokensOverride ?? designTokens) as DesignTokensT | null;
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
    tokensOverride,
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

  // Save/resume: persist progress to localStorage so closing/re-opening the
  // quiz resumes instead of restarting. Sticky A/B assignments ride along.
  const stateKey = `qz-state-${quizId}`;
  const abRef = useRef<Record<string, string>>({});
  // Captured contact (email/name/phone) from an email_gate, so a downstream
  // integration node can forward it to Klaviyo.
  const contactRef = useRef<{ email?: string; name?: string; phone?: string }>({});
  const resumedRef = useRef(false);

  // Restore BEFORE the analytics effect (effect order = declaration order) so a
  // resumed visit reuses the saved sessionId and doesn't re-fire quiz_started.
  useEffect(() => {
    if (isPreview) return; // preview always starts fresh at the intro
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(stateKey);
      if (!raw) return;
      const s = JSON.parse(raw) as {
        version?: number;
        sessionId?: string;
        currentNodeId?: string | null;
        path?: PathStep[];
        ab?: Record<string, string>;
      };
      if (!s || s.version !== version) return; // republished → stale, ignore
      if (typeof s.sessionId === "string") sessionIdRef.current = s.sessionId;
      if (s.ab) abRef.current = s.ab;
      const savedPath = Array.isArray(s.path) ? s.path : [];
      const savedNodeId = s.currentNodeId ?? null;
      const introId = introNode ? introNode.id : null;
      // Only treat it as a "resume" (suppress a duplicate quiz_started) if
      // there's real progress — a reset-then-reload sits at the intro.
      if (savedPath.length > 0 || (savedNodeId !== null && savedNodeId !== introId)) {
        resumedRef.current = true;
      }
      // Resuming onto a result page means the quiz was already completed — don't
      // re-fire quiz_completed.
      const savedNode = savedNodeId ? doc.nodes.find((n) => n.id === savedNodeId) : null;
      if (savedNode?.type === "result") completedRef.current = true;
      if (savedNodeId) setCurrentNodeId(savedNodeId);
      setPath(savedPath);
    } catch {
      // disabled / malformed storage → start fresh
    }
  }, [stateKey, version, doc, introNode, isPreview]);

  useEffect(() => {
    // Preview fires no analytics: a no-op client means every `?.track(...)`
    // call site (here + in child views) silently does nothing, with no
    // start()/quiz_started/network — without touching ~12 call sites.
    if (isPreview) {
      analyticsRef.current = {
        track: () => {},
        start: () => {},
        stop: () => {},
      } as unknown as ReturnType<typeof createAnalyticsClient>;
      return;
    }
    const client = createAnalyticsClient({
      quizId,
      sessionId: sessionIdRef.current,
    });
    // Stamp every event with the shopper's sticky A/B assignments so the
    // builder can segment the funnel per variant. abRef holds
    // { [branchId]: slotId }, populated as the runtime traverses ab_split
    // branches (and restored from localStorage on resume). Wrapping `track`
    // once tags ALL call sites — including child components that receive
    // `analytics={analyticsRef.current}` — without touching each one.
    const wrapped: typeof client = {
      ...client,
      track: (type, payload = {}) =>
        client.track(type, { ...payload, ab: { ...abRef.current } }),
    };
    analyticsRef.current = wrapped;
    wrapped.start();
    const source =
      typeof window !== "undefined" && window.self !== window.top
        ? "embed"
        : "direct";
    startedAtRef.current = Date.now();
    if (!resumedRef.current) wrapped.track("quiz_started", { source });
    return () => {
      wrapped.stop();
    };
  }, [quizId, isPreview]);

  // Fire quiz_abandoned when the shopper leaves before reaching a result.
  // We listen on `pagehide` (not React unmount) so tab-close / navigation is
  // caught, and re-register per step so the event always reports the last node
  // seen. completedRef flips true on the result view, so a finished quiz is
  // never counted as abandoned.
  useEffect(() => {
    if (isPreview || typeof window === "undefined") return;
    const onHide = () => {
      if (!completedRef.current) {
        analyticsRef.current?.track("quiz_abandoned", { last_node_id: currentNodeId });
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [currentNodeId, isPreview]);

  // Persist progress whenever the step/path changes (ab is read at write time).
  // Skip the very first run so the restore effect's read is never clobbered.
  const skipFirstSaveRef = useRef(true);
  useEffect(() => {
    if (isPreview) return; // no progress persistence in preview
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        stateKey,
        JSON.stringify({
          version,
          sessionId: sessionIdRef.current,
          currentNodeId,
          path,
          ab: abRef.current,
        }),
      );
    } catch {
      // ignore storage failures
    }
  }, [stateKey, version, currentNodeId, path, isPreview]);

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

  // In-Quiz Add-On: add a mid-quiz preview product to cart (then continue).
  const handlePreviewAdd = (product: RecommendedProduct, position: number) => {
    analyticsRef.current?.track("add_to_cart", {
      stage: "preview",
      product_id: product.product_id,
      position,
    });
  };

  function reset() {
    setCurrentNodeId(introNode ? introNode.id : null);
    setPath([]);
    previewViewedRef.current = false;
    completedRef.current = false;
    // A/B assignments deliberately persist across "Start over" (sticky variant
    // for honest attribution). The save effect rewrites the cleared progress.
  }

  // Jump back to a previously answered step (clickable progress trail). Truncate
  // the path to that point and re-enter that question; downstream answers/tags
  // are discarded and rebuilt as the shopper re-answers.
  function gotoStep(stepIndex: number) {
    if (stepIndex < 0 || stepIndex >= path.length) return;
    const target = path[stepIndex];
    if (!target) return;
    setPath(path.slice(0, stepIndex));
    setCurrentNodeId(target.questionNodeId);
    previewViewedRef.current = false;
    completedRef.current = false;
  }

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
    // A/B assignments mutated during branch traversal live in abRef and are
    // persisted by the save effect along with the path + current node.
    if (!next) return;
    setCurrentNodeId(next);
  }

  // Live recommendations region for a `recommendations` content-block (bare —
  // no card/heading; those are separate blocks). Reuses the exact engine + view.
  function renderRecommendations(
    node: Extract<QuizDoc["nodes"][number], { type: "result" }>,
  ): React.ReactNode {
    const selectedAnswerIds = path.flatMap((p) => p.answerIds);
    const dc = doc.discount_config;
    const showDiscount = node.data.include_discount && dc.enabled && Boolean(dc.code);
    const discountCode = showDiscount ? dc.code : undefined;
    const discountLabel = showDiscount
      ? dc.kind === "percentage"
        ? `Save ${dc.value}%`
        : `$${dc.value} off`
      : undefined;
    const stages = node.data.stages;
    if (stages.length === 0) {
      const recs = recommendForResult({
        quiz: doc,
        productIndex,
        selectedAnswerIds,
        resultNodeId: node.id,
      });
      return (
        <ResultView
          headline=""
          subtext=""
          ctaLabel={node.data.cta_label}
          recs={recs}
          resultNodeId={node.id}
          shopDomain={shopDomain}
          discountCode={discountCode}
          discountLabel={discountLabel}
          styles={styles}
          startedAt={startedAtRef.current}
          completed={completedRef}
          analytics={analyticsRef.current}
          onReset={reset}
          bare
        />
      );
    }
    const sections = stages.map((stage) => ({
      stage,
      recs: recommendForStage(doc, productIndex, selectedAnswerIds, node.id, stage),
    }));
    return (
      <MultiStageResultView
        headline=""
        subtext=""
        ctaLabel={node.data.cta_label}
        sections={sections}
        resultNodeId={node.id}
        shopDomain={shopDomain}
        discountCode={discountCode}
        discountLabel={discountLabel}
        styles={styles}
        startedAt={startedAtRef.current}
        completed={completedRef}
        analytics={analyticsRef.current}
        onReset={reset}
        bare
      />
    );
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
    const layout = currentNode ? doc.node_layouts[currentNode.id] : undefined;
    const canBlockRender =
      !!currentNode &&
      !!layout &&
      layout.length > 0 &&
      layout.every((b) => RUNTIME_BLOCK_TYPES.has(b.type));
    if (!currentNode) {
      content = (
        <div style={styles.card}>
          <h1 style={styles.h1}>Lost the thread</h1>
          <p>Reached an unknown node — the quiz may have a missing edge.</p>
        </div>
      );
    } else if (canBlockRender && layout) {
      const node = currentNode;
      const blockCtx: BlockRenderCtx = {
        styles,
        nodeCss: doc.node_css[node.id] ?? null,
        resolveText: (t, merge) =>
          merge ? resolveMergeTags(t, buildMergeContext(path, doc)) : t,
        onPrimary: () => gotoNextFrom(node.id, null),
        renderSmart: (block, n) =>
          block.type === "recommendations" && n.type === "result"
            ? renderRecommendations(n)
            : null,
      };
      content = <BlockRenderer node={node} blocks={layout} ctx={blockCtx} />;
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
        <>
          {currentNode.data.education_card_before ? (
            <EducationCard text={currentNode.data.education_card_before} styles={styles} />
          ) : null}
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
        </>
      );
    } else if (currentNode.type === "email_gate") {
      content = (
        <EmailGateView
          node={currentNode}
          styles={styles}
          quizId={quizId}
          sessionId={sessionIdRef.current}
          onSubmit={(contact) => {
            if (contact?.email) {
              contactRef.current = contact;
              analyticsRef.current?.track("email_captured", {});
            }
            gotoNextFrom(currentNode.id, null);
          }}
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
          contact={contactRef.current}
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
      // Phase 5: a result page shows + applies the quiz discount only when it
      // opts in (include_discount) and the discount is enabled + created.
      const dc = doc.discount_config;
      const showDiscount =
        currentNode.data.include_discount && dc.enabled && Boolean(dc.code);
      const discountCode = showDiscount ? dc.code : undefined;
      const discountLabel = showDiscount
        ? dc.kind === "percentage"
          ? `Save ${dc.value}%`
          : `$${dc.value} off`
        : undefined;
      const stages = currentNode.data.stages;
      if (stages.length === 0) {
        const recs = recommendForResult({
          quiz: doc,
          productIndex,
          selectedAnswerIds,
          resultNodeId: currentNode.id,
        });
        // Secondary "you might also like": the same ladder fetched deeper (cap 12),
        // then diversity-filtered against the primary picks.
        const secondary = selectSecondaryRecs(
          recs,
          recommendForResult(
            { quiz: doc, productIndex, selectedAnswerIds, resultNodeId: currentNode.id },
            12,
          ),
          2,
        );
        content = (
          <ResultView
            headline={currentNode.data.headline}
            subtext={currentNode.data.subtext}
            whyBullets={currentNode.data.why_bullets}
            ctaLabel={currentNode.data.cta_label}
            recs={recs}
            secondary={secondary}
            quizId={quizId}
            sessionId={sessionIdRef.current}
            collectEmail={doc.collect_email_on_result}
            resultNodeId={currentNode.id}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
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
            whyBullets={currentNode.data.why_bullets}
            ctaLabel={currentNode.data.cta_label}
            sections={stageSections}
            quizId={quizId}
            sessionId={sessionIdRef.current}
            collectEmail={doc.collect_email_on_result}
            resultNodeId={currentNode.id}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
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
    <RuntimePreviewContext.Provider value={isPreview}>
    <div
      className={isPreview ? (breakpoint === "desktop" ? "qz-bp-desktop" : "qz-bp-mobile") : undefined}
      style={rootStyle}
    >
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
        ${
          isPreview
            ? `
        /* Preview: the two-column layout follows the resizable FRAME width via a
           breakpoint class on the root, NOT the window. */
        .qz-bp-desktop .qz-runtime-page { align-items: flex-start !important; justify-content: center !important; padding-top: 64px !important; }
        .qz-bp-desktop .qz-runtime-shell { flex-direction: row; align-items: flex-start; max-width: 1100px; gap: 40px; }
        .qz-bp-desktop .qz-runtime-content { flex: 1; min-width: 0; display: flex; justify-content: center; }
        .qz-bp-desktop .qz-preview-rail { flex: 0 0 320px; position: sticky; top: 64px; }
        .qz-bp-desktop .qz-preview-chip { display: none !important; }
        .qz-bp-mobile .qz-preview-rail { display: none; }
        `
            : `
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
        `
        }
      `}</style>
      <div className="qz-runtime-page" style={styles.page}>
        <div className="qz-runtime-shell">
          <div className="qz-runtime-content">
            <ProgressBar doc={doc} path={path} currentNodeId={currentNodeId} />
            <ProgressTrail
              doc={doc}
              path={path}
              currentNodeId={currentNodeId}
              onJump={gotoStep}
            />
            {content}
          </div>
          {showPreview && (
            <div className="qz-preview-rail">
              <PreviewRail
                recs={previewRecs}
                shopDomain={shopDomain}
                onClick={handlePreviewClick}
                onAdd={handlePreviewAdd}
              />
            </div>
          )}
        </div>
        {showPreview && (
          <PreviewChip
            recs={previewRecs}
            shopDomain={shopDomain}
            onClick={handlePreviewClick}
            onAdd={handlePreviewAdd}
          />
        )}
      </div>
    </div>
    </RuntimePreviewContext.Provider>
  );
}

// Clickable progress trail — one pill per answered question (jump back to
// re-answer) + the current question. Lets the shopper move around the quiz
// Thin percent-complete bar above the step trail (Phase 5). Denominator =
// reachable question steps; numerator = answered + the one in progress.
function ProgressBar({
  doc,
  path,
  currentNodeId,
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
}) {
  const total = useMemo(() => reachableQuestionCount(doc), [doc]);
  if (total <= 0) return null;
  const node = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  const onResult = node?.type === "result" || node?.type === "end";
  const onQuestion = node?.type === "question";
  const answered = path.length + (onQuestion ? 1 : 0);
  const pct = onResult ? 100 : progressPct(total, answered);
  return (
    <div
      style={{
        height: 6,
        borderRadius: 999,
        background: "#00000010",
        overflow: "hidden",
        marginBottom: 12,
      }}
      aria-hidden
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: "var(--qz-color-primary)",
          transition: "width .3s ease",
        }}
      />
    </div>
  );
}

// instead of only going forward; resume restores it on re-open.
function ProgressTrail({
  doc,
  path,
  currentNodeId,
  onJump,
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
  onJump: (i: number) => void;
}) {
  const current = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  const currentIsQuestion = current?.type === "question";
  if (path.length === 0 && !currentIsQuestion) return null;

  const label = (qid: string, i: number): string => {
    const node = doc.nodes.find((n) => n.id === qid);
    const text = node && node.type === "question" ? node.data.text : `Step ${i + 1}`;
    return text.length > 22 ? `${text.slice(0, 21)}…` : text;
  };
  const pill = (active: boolean, clickable: boolean): React.CSSProperties => ({
    border: "1px solid var(--qz-color-muted, #aaa)",
    background: active ? "var(--qz-color-text)" : "transparent",
    color: active ? "var(--qz-color-bg)" : "var(--qz-color-text)",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: "0.8em",
    fontFamily: "var(--qz-font-body)",
    cursor: clickable ? "pointer" : "default",
    whiteSpace: "nowrap",
  });

  return (
    <div
      aria-label="Quiz progress"
      style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, maxWidth: 560, width: "100%" }}
    >
      {path.map((s, i) => (
        <button
          key={`${s.questionNodeId}-${i}`}
          onClick={() => onJump(i)}
          title="Jump back to this question"
          style={pill(false, true)}
        >
          {i + 1}. {label(s.questionNodeId, i)}
        </button>
      ))}
      {currentIsQuestion && current ? (
        <span style={pill(true, false)}>
          {path.length + 1}. {label(current.id, path.length)}
        </span>
      ) : null}
    </div>
  );
}

function PreviewRail({
  recs,
  shopDomain,
  onClick,
  onAdd,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
  onAdd?: (product: RecommendedProduct, position: number) => void;
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
      <PreviewList recs={recs} shopDomain={shopDomain} onClick={onClick} onAdd={onAdd} />
    </aside>
  );
}

function PreviewChip({
  recs,
  shopDomain,
  onClick,
  onAdd,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
  onAdd?: (product: RecommendedProduct, position: number) => void;
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
            <PreviewList recs={recs} shopDomain={shopDomain} onClick={onClick} onAdd={onAdd} />
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
  onAdd,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
  onAdd?: (product: RecommendedProduct, position: number) => void;
}) {
  const isPreviewMode = useContext(RuntimePreviewContext);
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
        const cartUrl = cartPermalink(shopDomain, r.default_variant_id, 1);
        const infoFlex: React.CSSProperties = {
          display: "flex",
          gap: 10,
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          textDecoration: "none",
          color: "inherit",
        };
        return (
          <div key={r.product_id} style={cardStyle}>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" onClick={() => onClick(r, idx)} style={infoFlex}>
                {inner}
              </a>
            ) : (
              <div style={infoFlex}>{inner}</div>
            )}
            {cartUrl && onAdd ? (
              <button
                type="button"
                onClick={() => {
                  onAdd(r, idx);
                  if (isPreviewMode) return; // preview: no cart navigation
                  addToCartFromQuiz(cartUrl, numericId(r.default_variant_id), false);
                }}
                style={{
                  flexShrink: 0,
                  border: "1px solid var(--qz-color-primary)",
                  color: "var(--qz-color-primary)",
                  background: "transparent",
                  borderRadius: "var(--qz-radius)",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                Add
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function DropdownQuestion({
  node,
  onAdvance,
  styles,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
}) {
  const [sel, setSel] = useState("");
  const answer = node.data.answers.find((a) => a.id === sel);
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{node.data.text}</h2>
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          style={styles.selectInput}
        >
          <option value="">Choose…</option>
          {node.data.answers.map((a) => (
            <option key={a.id} value={a.id}>
              {a.text}
            </option>
          ))}
        </select>
        <button
          style={{ ...styles.primaryBtn, opacity: answer ? 1 : 0.5 }}
          disabled={!answer}
          onClick={() => answer && onAdvance([answer.id], answer.edge_handle_id)}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// Micro-education card (Dev Spec §4.1) — a one-line teaching callout shown
// before a question (Continue-only, no CTA; set by the AI/merchant via the
// editor's set_education_card edit-op). Renders only when the field is present.
function EducationCard({
  text,
  styles,
}: {
  text: string;
  styles: ReturnType<typeof stylesFor>;
}) {
  return (
    <div
      style={{
        ...styles.card,
        borderLeft: "4px solid var(--qz-color-primary)",
        marginBottom: 12,
      }}
    >
      <div className="qz-dim" style={{ fontSize: 13, lineHeight: 1.5 }}>💡 {text}</div>
    </div>
  );
}

// An answer's label plus an optional always-visible helper caption
// (Answer.tooltip_text, baked at publish — Dev Spec §4.1) that explains the
// option's tradeoff in plain English. Always-visible rather than a hover/click
// popover because answer options are themselves <button>/<label> elements: a
// nested interactive tooltip would be invalid markup and unreliable on touch.
function AnswerLabel({ text, tooltip }: { text: string; tooltip?: string }) {
  if (!tooltip) return <>{text}</>;
  return (
    <span style={{ display: "grid", gap: 2, textAlign: "left" }}>
      <span>{text}</span>
      <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 400, lineHeight: 1.35 }}>
        {tooltip}
      </span>
    </span>
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
  // Slider defaults to its midpoint so it's immediately submittable + shows a value.
  const [freeform, setFreeform] = useState(
    node.data.question_type === "slider" ? "50" : "",
  );
  const isMulti = node.data.question_type === "multi_select";
  const isFreeform = isFreeformType(node.data.question_type);

  if (isFreeform) {
    // Freeform input: the typed value becomes the answer text. We piggy-back
    // on the question's seed answer (answers[0]) so tag accumulation +
    // outbound edge routing stay identical to card questions.
    const seed = node.data.answers[0];
    const cfg = node.data.input_config;
    const placeholder = cfg?.placeholder ?? "";
    const maxLength = cfg?.max_length ?? 120;
    const inputType =
      node.data.question_type === "email"
        ? "email"
        : node.data.question_type === "numeric"
          ? "number"
          : node.data.question_type === "date"
            ? "date"
            : "text";
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
          {node.data.question_type === "slider" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="range"
                min={0}
                max={100}
                value={freeform || "50"}
                onChange={(e) => setFreeform(e.target.value)}
                style={{ width: "100%", cursor: "pointer", accentColor: "var(--qz-color-primary)" }}
              />
              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 18 }}>
                {freeform || "50"}
              </div>
            </div>
          ) : (
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
          )}
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
    const min = node.data.min_selections;
    const tooMany = typeof max === "number" && selectedIds.length > max;
    const tooFew = typeof min === "number" && selectedIds.length < min;
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
              <AnswerLabel text={a.text} tooltip={a.tooltip_text} />
            </label>
          ))}
        </div>
        <button
          style={{
            ...styles.primaryBtn,
            opacity: selectedIds.length === 0 || tooMany || tooFew ? 0.5 : 1,
          }}
          disabled={selectedIds.length === 0 || tooMany || tooFew}
          onClick={() => {
            const first = node.data.answers.find((a) => checked[a.id]);
            onAdvance(selectedIds, first ? first.edge_handle_id : null);
          }}
        >
          Next
          {tooMany ? ` (max ${max})` : tooFew ? ` (choose ${min}+)` : ""}
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

  // Dropdown: a compact <select> for long single-choice lists.
  if (node.data.question_type === "dropdown") {
    return <DropdownQuestion node={node} onAdvance={onAdvance} styles={styles} />;
  }

  // Rating / Likert scale: a single-select rendered as a compact horizontal row.
  if (node.data.question_type === "rating") {
    return (
      <div style={styles.card}>
        <h2 style={styles.h2}>{node.data.text}</h2>
        <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {node.data.answers.map((a) => (
            <button
              key={a.id}
              style={{ ...styles.answerBtn, flex: "1 1 auto", minWidth: 56, textAlign: "center" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--qz-color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#00000022";
              }}
              onClick={() => onAdvance([a.id], a.edge_handle_id)}
            >
              <AnswerLabel text={a.text} tooltip={a.tooltip_text} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Swatch picker: single-select rendered as circular colour / material swatches.
  if (node.data.question_type === "swatch") {
    return (
      <div style={styles.card}>
        <h2 style={styles.h2}>{node.data.text}</h2>
        <div style={{ marginTop: 20, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {node.data.answers.map((a) => (
            <button
              key={a.id}
              title={a.tooltip_text ?? a.text}
              style={{
                ...styles.answerBtn,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                width: 92,
                padding: 8,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--qz-color-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "#00000022";
              }}
              onClick={() => onAdvance([a.id], a.edge_handle_id)}
            >
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  border: "1px solid #00000022",
                  backgroundColor: "#00000010",
                  backgroundImage: a.image_url ? `url(${a.image_url})` : undefined,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <span style={{ fontSize: 12, textAlign: "center" }}>{a.text}</span>
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
            {a.video_url && (
              <video
                src={a.video_url}
                controls
                playsInline
                style={{
                  width: "100%",
                  maxHeight: 200,
                  borderRadius: "var(--qz-radius)",
                  marginBottom: 8,
                  display: "block",
                }}
              />
            )}
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
            <AnswerLabel text={a.text} tooltip={a.tooltip_text} />
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
  onSubmit: (contact?: { email?: string; name?: string; phone?: string }) => void;
}) {
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email);

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      if (isPreviewMode) return; // preview: no /captures POST (finally still advances)
      await fetch("/captures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quiz_id: quizId,
          session_id: sessionId,
          email,
          ...(name ? { first_name: name } : {}),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
        }),
        keepalive: true,
      });
    } catch {
      // Don't block the quiz on capture failure.
    } finally {
      onSubmit({
        email,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
      });
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
        {node.data.collect_phone && (
          <input
            type="tel"
            placeholder="Phone (optional)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
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
          onClick={() => onSubmit()}
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
    QuizDoc["nodes"][number],
    { type: "ask_ai" }
  >;
  quizId: string;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
}) {
  const isPreviewMode = useContext(RuntimePreviewContext);
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
    if (isPreviewMode) {
      // Preview: stub a canned reply (no live Claude call).
      setTranscript((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "This is a preview — the AI assistant replies for real in your published quiz.",
        },
      ]);
      setSending(false);
      return;
    }
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
  contact,
  styles,
  onDone,
}: {
  node: Extract<
    QuizDoc["nodes"][number],
    { type: "integration" }
  >;
  quizId: string;
  path: PathStep[];
  contact?: { email?: string; name?: string; phone?: string };
  styles: ReturnType<typeof stylesFor>;
  onDone: () => void;
}) {
  const isPreviewMode = useContext(RuntimePreviewContext);
  const fired = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (isPreviewMode) {
      onDone(); // preview: skip the webhook/Klaviyo POST, just advance
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/q/${quizId}/integration`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId: node.id,
            path,
            ...(contact?.email ? { email: contact.email } : {}),
            ...(contact?.name ? { name: contact.name } : {}),
            ...(contact?.phone ? { phone: contact.phone } : {}),
          }),
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
    // `contact` is read but intentionally not a dep — the effect fires once
    // (guarded by fired.current) with whatever contact was captured by then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    QuizDoc["nodes"][number],
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

// "Why this product" benefit bullets (Dev Spec §5) — baked at publish, rendered
// under the result headline. Shared by the single + multi-stage result views.
function WhyBullets({
  bullets,
  styles,
}: {
  bullets?: string[];
  styles: ReturnType<typeof stylesFor>;
}) {
  if (!bullets || bullets.length === 0) return null;
  return (
    <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
      {bullets.map((b, i) => (
        <li key={i} style={{ ...styles.muted, fontSize: 14, lineHeight: 1.45 }}>
          {b}
        </li>
      ))}
    </ul>
  );
}

// Inline email capture on the result page (Dev Spec §5), gated by
// Quiz.collect_email_on_result. Mirrors EmailGateView: preview mode does not
// POST; a real capture persists via /captures + fires email_captured.
function ResultEmailCapture({
  quizId,
  sessionId,
  styles,
  analytics,
}: {
  quizId: string;
  sessionId: string;
  styles: ReturnType<typeof stylesFor>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
}) {
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email);

  async function submit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      if (!isPreviewMode) {
        await fetch("/captures", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quiz_id: quizId, session_id: sessionId, email }),
          keepalive: true,
        });
      }
      analytics?.track("email_captured", { source: "result" });
      setDone(true);
    } catch {
      setDone(true); // never trap the shopper on a capture failure
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div
        style={{
          marginTop: 24,
          padding: 14,
          borderRadius: "var(--qz-radius)",
          background: "#00000008",
          textAlign: "center",
        }}
      >
        ✓ Thanks — we&rsquo;ll email your results.
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid #00000014" }}
    >
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Want your results emailed to you?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            flex: "1 1 200px",
            padding: "12px 14px",
            borderRadius: "var(--qz-radius)",
            border: "1px solid #00000022",
            fontSize: "var(--qz-base-size)",
            fontFamily: "var(--qz-font-body)",
          }}
        />
        <button
          type="submit"
          disabled={!valid || submitting}
          style={{ ...styles.primaryBtn, opacity: valid && !submitting ? 1 : 0.5 }}
        >
          {submitting ? "Sending…" : "Email me"}
        </button>
      </div>
    </form>
  );
}

function ResultView({
  headline,
  subtext,
  ctaLabel,
  recs,
  secondary,
  quizId,
  sessionId,
  collectEmail,
  resultNodeId,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  startedAt,
  completed,
  analytics,
  onReset,
  bare,
  whyBullets,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  recs: RecommendedProduct[];
  secondary?: RecommendedProduct[];
  quizId?: string;
  sessionId?: string;
  collectEmail?: boolean;
  resultNodeId: string;
  shopDomain?: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  onReset: () => void;
  // When true, render just the products + "Start over" (no card / heading) so a
  // `recommendations` content-block can place it inside a custom layout.
  bare?: boolean;
  whyBullets?: string[];
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
      secondary_product_ids: (secondary ?? []).map((r) => r.product_id),
    });
  }, [analytics, completed, resultNodeId, startedAt, recs, secondary]);

  const inner = (
    <>
      {discountLabel ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            padding: "10px 14px",
            borderRadius: "var(--qz-radius)",
            background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
            color: "var(--qz-color-text)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          🎁 {discountLabel} on these picks — applied automatically at checkout.
        </div>
      ) : null}
      <div style={{ marginTop: bare && !discountLabel ? 0 : 20, display: "grid", gap: 12 }}>
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
            href={shopDomain ? `https://${shopDomain}/products/${r.handle}` : undefined}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            styles={styles}
            onClick={() =>
              analytics?.track("recommendation_clicked", {
                product_id: r.product_id,
                position: idx,
              })
            }
            onAdd={() =>
              analytics?.track("add_to_cart", {
                product_id: r.product_id,
                position: idx,
              })
            }
          />
        ))}
      </div>
      {secondary && secondary.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h3 style={{ ...styles.h2, fontSize: "0.8em", margin: "0 0 12px" }}>
            You might also like
          </h3>
          <div style={{ display: "grid", gap: 12 }}>
            {secondary.map((r, idx) => (
              <ProductCard
                key={r.product_id}
                product={r}
                position={recs.length + idx}
                ctaLabel={ctaLabel}
                href={shopDomain ? `https://${shopDomain}/products/${r.handle}` : undefined}
                shopDomain={shopDomain}
                styles={styles}
                onClick={() =>
                  analytics?.track("recommendation_clicked", {
                    product_id: r.product_id,
                    position: recs.length + idx,
                    secondary: true,
                  })
                }
                onAdd={() =>
                  analytics?.track("add_to_cart", {
                    product_id: r.product_id,
                    position: recs.length + idx,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
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
    </>
  );

  if (bare) return inner;
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{headline}</h2>
      {subtext && <p style={{ ...styles.muted, marginTop: 8 }}>{subtext}</p>}
      <WhyBullets bullets={whyBullets} styles={styles} />
      {inner}
      {collectEmail && quizId && sessionId ? (
        <ResultEmailCapture
          quizId={quizId}
          sessionId={sessionId}
          styles={styles}
          analytics={analytics}
        />
      ) : null}
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
  quizId,
  sessionId,
  collectEmail,
  resultNodeId,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  startedAt,
  completed,
  analytics,
  onReset,
  bare,
  whyBullets,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  sections: { stage: ResultStageT; recs: RecommendedProduct[] }[];
  quizId?: string;
  sessionId?: string;
  collectEmail?: boolean;
  resultNodeId: string;
  shopDomain: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  onReset: () => void;
  bare?: boolean;
  whyBullets?: string[];
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

  const inner = (
    <>
      <div style={{ marginTop: bare ? 0 : 20, display: "grid", gap: 28 }}>
        {sections.map(({ stage, recs }) => (
          <StageSection
            key={stage.id}
            stage={stage}
            recs={recs}
            ctaLabel={ctaLabel}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
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
    </>
  );

  if (bare) return inner;
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{headline}</h2>
      {subtext && <p style={{ ...styles.muted, marginTop: 8 }}>{subtext}</p>}
      <WhyBullets bullets={whyBullets} styles={styles} />
      {inner}
      {collectEmail && quizId && sessionId ? (
        <ResultEmailCapture
          quizId={quizId}
          sessionId={sessionId}
          styles={styles}
          analytics={analytics}
        />
      ) : null}
    </div>
  );
}

function StageSection({
  stage,
  recs,
  ctaLabel,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  analytics,
}: {
  stage: ResultStageT;
  recs: RecommendedProduct[];
  ctaLabel: string;
  shopDomain: string;
  discountCode?: string;
  discountLabel?: string;
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
              shopDomain={shopDomain}
              discountCode={discountCode}
              discountLabel={discountLabel}
              styles={styles}
              onClick={() =>
                analytics?.track("recommendation_clicked", {
                  result_stage_id: stage.id,
                  product_id: r.product_id,
                  position: idx,
                })
              }
              onAdd={() =>
                analytics?.track("add_to_cart", {
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

// Add-to-cart from the quiz (Phase 5). The quiz runs in a cross-origin iframe,
// so we first ask the parent storefront (the Theme App Extension listener) to
// add via the same-origin AJAX cart and ack — that's the In-Quiz Add-On
// (add then continue, no navigation). If no ack arrives quickly (not embedded /
// no listener), fall back to navigating the top window to the cart permalink,
// which adds the item + auto-applies the discount.
function addToCartFromQuiz(cartUrl: string, variantId: string | null, hasDiscount: boolean) {
  if (typeof window === "undefined") return;
  const goToCart = () => {
    try {
      (window.top ?? window).location.href = cartUrl;
    } catch {
      window.open(cartUrl, "_blank");
    }
  };
  // A discount can only be applied via the cart permalink (the AJAX cart can't
  // carry a code), so go straight there. Also when not embedded / no variant.
  if (hasDiscount || !variantId || window.parent === window) {
    goToCart();
    return;
  }
  // In-Quiz Add-On: ask the parent storefront (the Theme App Extension) to add
  // same-origin so the shopper stays in the quiz. The listener acks on RECEIPT
  // (so we cancel the fallback regardless of fetch timing → no double-add) and
  // posts :fail if the add fails (→ permalink fallback).
  let settled = false;
  const cleanup = () => window.removeEventListener("message", onMsg);
  const onMsg = (e: MessageEvent) => {
    if (e.source !== window.parent) return;
    const d = e.data as { type?: string } | null;
    if (!d || typeof d !== "object") return;
    if (d.type === "qz:add-to-cart:ok") {
      settled = true;
      cleanup();
    } else if (d.type === "qz:add-to-cart:fail") {
      settled = true;
      cleanup();
      goToCart();
    }
  };
  window.addEventListener("message", onMsg);
  try {
    window.parent.postMessage({ type: "qz:add-to-cart", variantId, quantity: 1 }, "*");
  } catch {
    cleanup();
    goToCart();
    return;
  }
  // No listener present (no ack of any kind) → permalink fallback.
  window.setTimeout(() => {
    if (!settled) {
      cleanup();
      goToCart();
    }
  }, 1200);
}

function ProductCard({
  product,
  position,
  ctaLabel,
  href,
  styles,
  onClick,
  shopDomain,
  discountCode,
  discountLabel,
  onAdd,
}: {
  product: RecommendedProduct;
  position: number;
  ctaLabel: string;
  // When set, the info region links to the PDP (new tab). When omitted, it's a
  // click-tracked button.
  href?: string;
  styles: ReturnType<typeof stylesFor>;
  onClick?: () => void;
  // Phase 5 add-to-cart: a cart permalink is built when a shop domain + variant
  // are available; the CTA then becomes "Add to cart".
  shopDomain?: string;
  discountCode?: string;
  discountLabel?: string;
  onAdd?: () => void;
}) {
  const isPreviewMode = useContext(RuntimePreviewContext);
  void position;
  // Selectable variant (Dev Spec §5). Defaults to the baked default variant;
  // the shopper can switch before adding to cart.
  const [selectedVariantId, setSelectedVariantId] = useState(
    product.default_variant_id ?? product.variants?.[0]?.id,
  );
  const cartUrl = cartPermalink(shopDomain, selectedVariantId, 1, discountCode);

  const infoStyle: React.CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    color: "inherit",
    textDecoration: "none",
    background: "none",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    padding: 0,
    font: "inherit",
  };
  const ctaStyle: React.CSSProperties = {
    background: "var(--qz-color-text)",
    color: "var(--qz-color-bg)",
    border: "none",
    borderRadius: "var(--qz-radius)",
    padding: "8px 16px",
    fontSize: 14,
    flexShrink: 0,
    font: "inherit",
  };

  const info = (
    <>
      {product.image_url ? (
        <img
          src={product.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          width={80}
          height={80}
          style={{ width: 80, height: 80, objectFit: "cover", borderRadius: "var(--qz-radius)", flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 80, height: 80, background: "#00000010", borderRadius: "var(--qz-radius)", flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{product.title}</div>
        {product.price && (
          <div style={{ color: "var(--qz-color-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>${product.price}</span>
            {discountLabel ? (
              <span style={{ background: "var(--qz-color-primary)", color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 600 }}>
                {discountLabel}
              </span>
            ) : null}
          </div>
        )}
        {!product.inventory_in_stock && (
          <div style={{ color: "#D72C0D", marginTop: 4, fontSize: 12 }}>Out of stock</div>
        )}
      </div>
    </>
  );

  return (
    <div style={{ ...styles.productCard, display: "flex", gap: 12, alignItems: "center" }}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" onClick={onClick} style={infoStyle}>
          {info}
        </a>
      ) : (
        <button type="button" onClick={onClick} style={infoStyle}>
          {info}
        </button>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", flexShrink: 0 }}>
        {product.variants && product.variants.length > 1 ? (
          <select
            aria-label="Choose a variant"
            value={selectedVariantId ?? ""}
            onChange={(e) => setSelectedVariantId(e.target.value)}
            style={{
              font: "inherit",
              fontSize: 13,
              padding: "6px 8px",
              borderRadius: "var(--qz-radius)",
              border: "1px solid #00000022",
              maxWidth: 180,
            }}
          >
            {product.variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.available}>
                {v.title}
                {v.available ? "" : " — sold out"}
              </option>
            ))}
          </select>
        ) : null}
        {cartUrl ? (
          <button
            type="button"
            onClick={() => {
              onAdd?.();
              if (isPreviewMode) return; // preview: no cart navigation / postMessage
              addToCartFromQuiz(cartUrl, numericId(selectedVariantId), Boolean(discountCode));
            }}
            style={{ ...ctaStyle, cursor: "pointer" }}
          >
            Add to cart
          </button>
        ) : (
          <span style={{ ...ctaStyle, cursor: "default" }}>{ctaLabel}</span>
        )}
      </div>
    </div>
  );
}
