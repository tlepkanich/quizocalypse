import { useEffect, useMemo, useRef, useState } from "react";
import { ChromeContext, CHROME_TOKENS, useChrome, type ChromeToken } from "./chromeStrings";
import { tagToAnswerText, reasonsForProduct } from "../../lib/matchReasons";
import type { Quiz } from "../../lib/quizSchema";
import {
  resolveNextStep,
  recommendForResult,
  recommendForResultExplained,
  recommendForStage,
  recommendPreview,
  selectSecondaryRecs,
  resolveGlobalFallbackProducts,
  type BranchContext,
  type IndexedProduct,
  type RecommendedProduct,
} from "../../lib/recommendationEngine";
import {
  deciderFallbackProducts,
  resolveTarget,
  settingsForTarget,
} from "../../lib/recommendDecider";
import { resolveNodeOverride } from "../../lib/resultLayout";
import { hideDecorativeImagery } from "../../lib/styleBar";
import { formatMoney } from "../../lib/formatMoney";
import {
  resolveForBreakpoint,
  tokensToCssVars,
  type DesignTokensT,
} from "../../lib/designTokens";
import { createAnalyticsClient, newSessionId } from "../../lib/analytics";
import {
  buildMergeContext,
  resolveMergeTags,
  resolveCopyTokens,
  type PathStep,
} from "../../lib/mergeTags";
import { collectNextStepImages } from "../../lib/nextStepImages";
import { stylesFor, googleFontsUrl, useContainerBreakpoint } from "./runtimeStyles";
import { BlockRenderer, type BlockRenderCtx } from "./BlockRenderer";
import { screenBackgroundCss, screenOverlayAlpha, videoLayer } from "../../lib/screenBackground";
import {
  RuntimeChromeContext,
  RuntimeCurrencyContext,
  RuntimeDiscountContext,
  RuntimeLocaleContext,
  RuntimePlatformContext,
  RuntimePreviewContext,
  type ChromeVariant,
} from "./runtimeContexts";
import { inspectAttrs, type InspectTarget } from "./inspect";
import { ProgressBar, MinimalQuestionLabel, ProgressTrail } from "./bits/progress";
import { PreviewRail, PreviewChip } from "./bits/preview";
import { EducationCard } from "./bits/EducationCard";
import { QuestionView } from "./views/QuestionView";
import { RecapView, RevealView } from "./views/theater";
import {
  DeciderLoadingView,
  DeciderCaptureView,
  DeciderResultView,
} from "./views/DeciderViews";
import { ResultView } from "./views/ResultView";
import { MultiStageResultView } from "./views/MultiStageResultView";
import { EmailGateView } from "./views/EmailGateView";
import { AskAIView } from "./views/AskAIView";
import { IntegrationView } from "./views/IntegrationView";
import { ProductCardsView } from "./views/ProductCardsView";

// Inspect types are re-exported so existing importers (the builder workspace,
// Step5Preview) keep their `from "../runtime/QuizRuntime"` imports unchanged.
export type { InspectPart, InspectTarget } from "./inspect";

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
  // §5 — quiz↔rec-page design link. When designLinked is false, result/end nodes
  // resolve from recPageDesign instead of the quiz design. Default linked → today.
  designLinked?: boolean;
  recPageDesign?: DesignTokensT | null;
  quizId: string;
  version: number;
  shopDomain: string;
  // QD-7 — which commerce platform this published quiz belongs to. "shopify"
  // (the default for every pre-existing quiz) keeps add-to-cart + /products/
  // permalinks; "standalone" gates the Shopify cart off and links product
  // cards to the merchant's own `IndexedProduct.url` via a "Shop now" CTA.
  platform?: "shopify" | "standalone";
  // QB-8 — preview-only: paint the quiz's theme background + fill the frame, so
  // the standalone builder canvas shows the quiz full-bleed (no framing card).
  fillBackground?: boolean;
  mode?: QuizRuntimeMode;
  // Preview-only (ignored when mode==="live"). Preview always starts fresh at
  // the intro because the localStorage restore effect early-returns on isPreview.
  tokensOverride?: DesignTokensT | null;
  breakpoint?: "desktop" | "mobile";
  // Editor-only (preview): click-to-inspect editable elements. Never set on the
  // storefront — absent, the DOM and behavior are unchanged.
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  // Unified P3 — PREVIEW-ONLY selection sync with the workspace rail. Setting
  // focusNodeId jumps the preview to that step (path resets — a clean jump);
  // onNodeShown reports every step the runtime lands on (walkthrough advance)
  // so the rail can highlight it. Both are ignored entirely in live mode.
  focusNodeId?: string | null;
  onNodeShown?: (nodeId: string) => void;
  // Phase J — baked conversion weights from publishedJson.answer_weights
  // (absent on drafts/previews → neutral scoring).
  answerWeights?: Record<string, number> | null;
  // Phase K2 — the locale's chrome table (chromeFor output) + the resolved
  // locale code. Absent → English table via the context default.
  chrome?: Record<string, string> | null;
  locale?: string;
  // Phase L2 — the inviter's session id when this visit came from a buddy link.
  buddySessionId?: string | null;
  // LOGIC v2 (L2-9) — the publish-time decider bake: targetId → ORDERED member
  // product ids + each target's shape/name. Threaded from publishedJson by the
  // live loader (the answer_weights pattern); null on legacy docs and drafts,
  // in which case the engine inputs stay byte-identical to today.
  targetProductIdsMap?: Record<string, string[]> | null;
  targetIndex?: Record<
    string,
    { type: "product" | "collection" | "tag"; name?: string }
  > | null;
  // LOGIC v2 (L2-12b) — the per-shop runtime rec-copy kill switch, read live by
  // the /q loader (never baked). When false the runtime skips the rec-copy fetch
  // entirely; the endpoint re-checks the live column regardless. Default false so
  // preview/builder surfaces never spend (only the live loader sets it true).
  aiCopyEnabled?: boolean;
}

// Content-block types the storefront renders directly via BlockRenderer.
const RUNTIME_LITERAL_BLOCK_TYPES = new Set([
  "heading",
  "text",
  "image",
  "button",
  "spacer",
  "divider",
  // QZY-10 §7 — the v1 inventory additions (BlockRenderer literal cases).
  "video",
  "progress",
  "logo",
  "content",
]);
// BLD-7 — a smart block renders only on the node type whose interactive
// region exists (renderSmart mounts the region-mode view with the SAME
// wiring as the fixed template). A layout containing any other smart block
// falls back to the node's fixed template — never a silent blank region.
// (The pre-BLD-7 gate excluded "answers" entirely, so every QUESTION layout
// the builder's palette wrote was committed but never rendered.)
// ai_chat / product_grid regions are not yet extracted → not listed.
const RUNTIME_SMART_BLOCK_HOSTS: Record<string, string> = {
  recommendations: "result",
  answers: "question",
  email_input: "email_gate",
};

// BIC-2 B3 — is `shorter` a step-for-step prefix of `longer`? Used by the
// browser-history integration to decide whether a Forward press can safely
// re-enter the retained journey (a re-answer after going back diverges the
// path, invalidating the old forward positions).
function isPathPrefix(shorter: PathStep[], longer: PathStep[]): boolean {
  if (shorter.length > longer.length) return false;
  for (let i = 0; i < shorter.length; i++) {
    const a = shorter[i];
    const b = longer[i];
    if (!a || !b) return false;
    if (a.questionNodeId !== b.questionNodeId) return false;
    if (a.answerIds.length !== b.answerIds.length) return false;
    for (let k = 0; k < a.answerIds.length; k++) {
      if (a.answerIds[k] !== b.answerIds[k]) return false;
    }
  }
  return true;
}


export function QuizRuntime(props: QuizRuntimeProps) {
  const tc = useChrome();
  const {
    doc,
    productIndex,
    designTokens,
    designOverrides,
    breakpointOverrides,
    resultLayoutMode,
    designLinked,
    recPageDesign,
    quizId,
    version,
    shopDomain,
    platform = "shopify",
    fillBackground = false,
    mode = "live",
    tokensOverride = null,
    breakpoint: breakpointProp,
    onInspect,
    inspectedTarget = null,
    focusNodeId = null,
    onNodeShown,
    answerWeights = null,
    chrome = null,
    locale = "en",
    buddySessionId = null,
    targetProductIdsMap = null,
    targetIndex = null,
    aiCopyEnabled = false,
  } = props;
  const isPreview = mode === "preview";
  // LOGIC v2 — decider docs take the capture→loading→reveal result flow below.
  // Gated on a field NO legacy doc possesses, so everything else is unchanged.
  const isDecider = doc.logic_model === "decider";
  // Spread-ready engine fields: null → spread nothing, keeping every legacy
  // engine call's input object deep-equal to today's (byte-stability).
  const targetFields = {
    ...(targetProductIdsMap ? { targetProductIdsMap } : {}),
    ...(targetIndex ? { targetIndex } : {}),
  };
  // Shop currency baked into the published doc (USD fallback for quizzes
  // published before the field existed). Shared with the deep price/discount
  // formatters via RuntimeCurrencyContext, and used inline for discount labels.
  const currency = doc.currency ?? "USD";
  // Inspect mode is preview-only by construction (the storefront never passes
  // onInspect); the extra guard keeps a stray prop from ever hijacking live taps.
  const inspectFn = isPreview ? onInspect : undefined;
  const insp = (target: InspectTarget) => inspectAttrs(inspectFn, inspectedTarget, target);
  const introNode = useMemo(
    () => doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0],
    [doc.nodes],
  );
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(
    introNode ? introNode.id : null,
  );
  const [path, setPath] = useState<PathStep[]>([]);
  // Experiences E4 — theater gates before the result render. Reset on every
  // node change so a jump-back + new path replays them.
  const [recapConfirmed, setRecapConfirmed] = useState(false);
  const [revealDone, setRevealDone] = useState(false);
  // LOGIC v2 §7 — the decider flow's capture → loading gates (same reset
  // discipline as recap/reveal: a jump-back + new path replays them).
  const [captureDone, setCaptureDone] = useState(false);
  const [loadingDone, setLoadingDone] = useState(false);
  // L2-12b — the runtime AI rec-copy race. `beatsDone` = the interstitial's
  // animation finished; `aiSettled` = the AI fetch resolved/failed/timed out
  // (default TRUE so non-eligible paths flip loadingDone on beatsDone alone,
  // byte-identical to before this phase). loadingDone flips only when BOTH, so
  // the reveal never flashes template→AI. `aiWhyCopy` replaces the merchant
  // template for THIS paint; a late arrival is discarded (cache serves next).
  const [beatsDone, setBeatsDone] = useState(false);
  const [aiSettled, setAiSettled] = useState(true);
  const [aiWhyCopy, setAiWhyCopy] = useState<string | null>(null);
  const aiFiredRef = useRef(false);
  // Spec §2 urgency — product_id → live stock qty (only entries at/below the
  // result's threshold). Fetched fresh when a result page renders (never baked,
  // never cached) so "Only X left" reflects real-time Shopify inventory.
  const [lowStockByProduct, setLowStockByProduct] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    setRecapConfirmed(false);
    setRevealDone(false);
    setCaptureDone(false);
    setLoadingDone(false);
    // L2-12b — a jump-back + new path re-derives a (possibly different) target,
    // so reset the AI race too (the fetch re-fires for the new reveal).
    setBeatsDone(false);
    setAiSettled(true);
    setAiWhyCopy(null);
    aiFiredRef.current = false;
  }, [currentNodeId]);

  // Spec §2 urgency — when a result page with the urgency toggle renders, fetch
  // current stock for its products and keep only those at/below the threshold.
  // Skipped in preview (no live inventory there). Re-runs per result node.
  useEffect(() => {
    const node = doc.nodes.find((n) => n.id === currentNodeId);
    // isDecider: urgency is a legacy per-node feature the v2 reveal doesn't
    // render — skip the fetch entirely (legacy predicate unchanged).
    if (!node || node.type !== "result" || !node.data.urgency_enabled || isPreview || !quizId || isDecider) {
      setLowStockByProduct(null);
      return;
    }
    const selectedAnswerIds = path.flatMap((p) => p.answerIds);
    // Cover both the primary recs and the "you might also like" row (cap 12).
    const recs = recommendForResult(
      {
        quiz: doc,
        productIndex,
        selectedAnswerIds,
        resultNodeId: node.id,
        ...(answerWeights ? { answerWeights } : {}),
        ...targetFields,
      },
      12,
    );
    const ids = recs.map((r) => r.product_id);
    if (ids.length === 0) {
      setLowStockByProduct(null);
      return;
    }
    const threshold = node.data.urgency_threshold;
    let cancelled = false;
    void fetchLiveInventory(quizId, ids).then((qtyById) => {
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const [pid, qty] of Object.entries(qtyById)) {
        if (typeof qty === "number" && qty > 0 && qty <= threshold) m.set(pid, qty);
      }
      setLowStockByProduct(m);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentNodeId, quizId, isPreview]);

  // Unified P3 — preview-only selection sync (both effects no-op in live mode
  // by construction AND by guard). Jump: when the workspace selects a step that
  // isn't the one on screen, show it with a clean path. Report: every step the
  // runtime lands on (jump OR walkthrough advance) is surfaced so the rail can
  // follow. No loop: after a jump, focusNodeId === currentNodeId.
  useEffect(() => {
    if (!isPreview || !focusNodeId || focusNodeId === currentNodeId) return;
    if (!doc.nodes.some((n) => n.id === focusNodeId)) return;
    setPath([]);
    setCurrentNodeId(focusNodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeId, isPreview]);
  useEffect(() => {
    if (isPreview && onNodeShown && currentNodeId) onNodeShown(currentNodeId);
  }, [isPreview, onNodeShown, currentNodeId]);
  // Unified P1 (autoscale core): live mode measures the runtime root's OWN
  // container width — never the window — so the quiz formats correctly in a
  // full page, a narrow theme-section iframe, or the launcher popup alike.
  // Preview stays prop-driven: the DeviceFrame width is the merchant's
  // INTENTIONAL breakpoint while editing (a side panel opening must not flip
  // the layer they're styling). SSR default is mobile — most shopper traffic
  // and embeds are narrow, and a brief narrow-column paint on a wide desktop
  // beats 720px cards crammed into a phone.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const measuredBreakpoint = useContainerBreakpoint(rootRef);
  const breakpoint = isPreview
    ? (breakpointProp ?? "desktop")
    : (measuredBreakpoint ?? "mobile");

  // Resolve baked tokens + the current node's override on every render — this
  // is what implements the design cascade at the storefront layer. The
  // breakpoint layer is picked from breakpoint_overrides[nodeId][bp] and only
  // applied if the viewport matches.
  const { resolved, fluidSource } = useMemo(() => {
    const currentNodeType = currentNodeId
      ? (doc.nodes.find((n) => n.id === currentNodeId)?.type ?? "")
      : "";
    // §5 — a DE-LINKED rec page resolves its result/end nodes from rec_page_design
    // instead of the quiz design. Linked (default) / unset → the quiz design, so
    // every existing quiz stays byte-identical. A live theme try-on (tokensOverride)
    // still wins everywhere, so reskin swatches restyle every node consistently.
    const recNode = currentNodeType === "result" || currentNodeType === "end";
    const baked = (tokensOverride ??
      (recNode && designLinked === false && recPageDesign
        ? recPageDesign
        : designTokens)) as DesignTokensT | null;
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
    // Unified P7: resolve BOTH buckets too — they are the fluid-typography
    // endpoints (per-breakpoint base_size overrides included by construction).
    return {
      resolved: resolveForBreakpoint(null, baked, nodeOverride, bpLayer),
      fluidSource: {
        mobile: resolveForBreakpoint(null, baked, nodeOverride, bpRecord?.mobile ?? null),
        desktop: resolveForBreakpoint(null, baked, nodeOverride, bpRecord?.desktop ?? null),
      },
    };
  }, [
    designTokens,
    tokensOverride,
    designOverrides,
    breakpointOverrides,
    resultLayoutMode,
    designLinked,
    recPageDesign,
    currentNodeId,
    breakpoint,
    doc.nodes,
  ]);

  // MQ — resolve the runtime chrome once: explicit `chrome` token wins, else the
  // platform default (standalone → minimal Quizell look, shopify → classic). Deep
  // views read it via RuntimeChromeContext; styles read it directly below.
  const chromeVariant: ChromeVariant = useMemo(
    () => resolved.chrome ?? (platform === "standalone" ? "minimal" : "classic"),
    [resolved.chrome, platform],
  );
  const styles = useMemo(
    () => stylesFor(resolved, breakpoint, chromeVariant),
    [resolved, breakpoint, chromeVariant],
  );
  const cssVars = useMemo(
    () => tokensToCssVars(resolved, fluidSource) as React.CSSProperties,
    [resolved, fluidSource],
  );
  // §4 progress-bar config (enabled / style / position). Defaults reproduce
  // today's render exactly (shown · bar · top) when progress_bar is unset.
  const progressEnabled = resolved.progress_bar?.enabled !== false;
  const progressBarStyle = resolved.progress_bar?.style ?? "bar";
  const progressAtBottom = resolved.progress_bar?.position === "bottom";
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

  // ── L2-12b — runtime AI rec-copy eligibility + the fetch race ──────────────
  // Eligible iff: live (not preview), decider doc, shop switch on, the current
  // node is a result, the shopper's path resolves a target, and that target's
  // effective config has whyOn AND is NOT locked (a locked merchant paragraph
  // ships as-is). All of this mirrors the endpoint's own refusals so the client
  // doesn't waste a rate-limited request. Null → the whole feature is inert
  // (every legacy/preview/non-decider render, byte-identical to before).
  const aiRecCopy = useMemo(() => {
    if (isPreview || !isDecider || !aiCopyEnabled || !quizId) return null;
    const node = doc.nodes.find((n) => n.id === currentNodeId);
    if (!node || node.type !== "result") return null;
    const answerIds = path.flatMap((p) => p.answerIds);
    const resolved = resolveTarget(answerIds, doc);
    if (!resolved) return null;
    const cfg = settingsForTarget(doc.rec_page_settings, resolved.targetId);
    if (!cfg.whyOn || cfg.whyCopyLocked) return null;
    return {
      targetId: resolved.targetId,
      answerIds,
      captureNeeded: Boolean(cfg.captureEmail || cfg.captureName || cfg.capturePhone),
    };
  }, [isPreview, isDecider, aiCopyEnabled, quizId, currentNodeId, path, doc]);

  // Fire at capture-gate-clear (abandoners cost $0) — the loading interstitial
  // then absorbs the latency. Reduced-motion skips the interstitial, so there's
  // no buffer → skip the spend entirely (the reveal shows template copy). The
  // fetch is raced against a 5s client cap; the SERVER still completes + caches,
  // so a late arrival is only discarded for THIS paint (a reload serves cached).
  useEffect(() => {
    if (!aiRecCopy || aiFiredRef.current) return;
    const captureCleared = captureDone || !aiRecCopy.captureNeeded;
    if (!captureCleared) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    aiFiredRef.current = true;
    setAiSettled(false);
    const controller = new AbortController();
    let done = false;
    const settle = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setAiSettled(true);
    };
    const timer = setTimeout(() => {
      controller.abort();
      settle();
    }, 5000);
    fetch(`/q/${quizId}/rec-copy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        answerIds: aiRecCopy.answerIds,
      }),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.ok && typeof d.copy === "string" && d.copy.trim()) {
          setAiWhyCopy(d.copy);
        }
      })
      .catch(() => {})
      .finally(settle);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // sessionIdRef is stable; the reset effect clears aiFiredRef on node change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiRecCopy, captureDone, quizId]);

  // The reveal waits for BOTH the interstitial beats AND the AI to settle (or
  // its 5s cap) — so the copy never flashes template→AI. aiSettled defaults true,
  // so a render that never fired the fetch flips loadingDone on beatsDone alone.
  useEffect(() => {
    if (beatsDone && aiSettled && !loadingDone) setLoadingDone(true);
  }, [beatsDone, aiSettled, loadingDone]);

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
  // Unified P6: the root is also the size container — @container rules below
  // and the fluid type's cqw units both measure against it.
  const rootStyle: React.CSSProperties = {
    ...cssVars,
    containerType: "inline-size",
    position: "relative", // anchor the QB-5 "Build with" badge (standalone only)
    // E3 takeover: hosted /q fills the viewport in the theme background so
    // the quiz IS the page. QB-8: the standalone builder asks the preview to
    // paint that same background (fillBackground) so the canvas shows the quiz
    // full-bleed — "just the quiz", no framing card.
    // MQ — the minimal chrome is CARD-LESS, so the theme background must be
    // painted on the root or the content floats with no backdrop (a light-text
    // theme then vanishes on the builder's grey canvas). Paint it whenever the
    // chrome is minimal, in preview too — not only when fillBackground is asked.
    ...(!isPreview
      ? { background: "var(--qz-color-bg)", minHeight: "100vh" }
      : fillBackground || chromeVariant === "minimal"
        ? { background: "var(--qz-color-bg)", minHeight: 480 }
        : {}),
  };
  // K2: prop entries win over English defaults; identity-stable per locale.
  const chromeTable = useMemo(
    () => ({ ...CHROME_TOKENS, ...(chrome ?? {}) }) as Record<ChromeToken, string>,
    [chrome],
  );

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

  // A11y (BIC P5): after a real navigation (Start/answer/jump), move focus to
  // the content wrapper so keyboard + screen-reader users land on the new step.
  // hasNavigatedRef gates it to USER navigation — page load and resume-restore
  // (which also set currentNodeId) never steal focus.
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasNavigatedRef = useRef(false);
  useEffect(() => {
    if (!hasNavigatedRef.current) return;
    contentRef.current?.focus();
  }, [currentNodeId]);

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
    hasNavigatedRef.current = true;
    setPath(path.slice(0, stepIndex));
    setCurrentNodeId(target.questionNodeId);
    previewViewedRef.current = false;
    completedRef.current = false;
  }

  // ── BIC-2 B3 — browser Back/Forward inside the quiz ───────────────────────
  // Live mode only (the builder preview must never touch the host page's
  // history), everything effect/handler-scoped so SSR + hydration are
  // untouched. A position is (currentNodeId, path.length) — path.length alone
  // can't address a step because interstitials (intro/gate/message/…) don't
  // append to `path`, so the history state carries both: {qz: {n, p}}.
  //   • Every ADVANCE pushes an entry; mount/resume-restore and every
  //     jump-BACK (trail pill, in-quiz Back, Start over, popstate restore)
  //     REPLACE instead — the current entry always mirrors the current
  //     position, and a trail jump never creates double entries. Trade-off
  //     (reasoned): after a trail jump 3→1 the browser's back stack still
  //     holds positions 2,1,0 — Back walks the JOURNEY, not the click
  //     chronology. That keeps one invariant ("Back = one step shallower")
  //     instead of two mechanisms fighting.
  //   • popstate maps the entry back onto the SAME code path the trail jump
  //     uses: a target that is an answered question in the current path calls
  //     gotoStep() literally; intro/interstitial targets replay its exact
  //     statements (truncate + re-enter). Forward re-enters the retained
  //     journey (journeyPathRef, the deepest consistent path) only while the
  //     current path is still a prefix of it; anything else is ignored — and a
  //     re-answer after Back pushes, which clears the browser's forward stack
  //     anyway. Back from the first entry leaves the page (natural exit).
  //   • Existing history.state fields (React Router's usr/key/idx) are
  //     preserved by spread so router bookkeeping never breaks; all History
  //     calls sit in try/catch (sandboxed embeds / Safari rate limits).
  const historyPosRef = useRef<{ n: string | null; p: number } | null>(null);
  const journeyPathRef = useRef<PathStep[]>([]);
  const popRestoreRef = useRef(false);

  useEffect(() => {
    if (isPreview || typeof window === "undefined") return;
    // Retain the deepest journey this path is consistent with (for Forward).
    if (
      path.length >= journeyPathRef.current.length ||
      !isPathPrefix(path, journeyPathRef.current)
    ) {
      journeyPathRef.current = path;
    }
    const pos = { n: currentNodeId, p: path.length };
    const prev = historyPosRef.current;
    historyPosRef.current = pos;
    if (popRestoreRef.current) {
      // The browser already sits on the target entry — write nothing.
      popRestoreRef.current = false;
      return;
    }
    if (prev && prev.n === pos.n && prev.p === pos.p) return;
    try {
      const base = window.history.state as Record<string, unknown> | null;
      const state = { ...(base ?? {}), qz: pos };
      if (!prev || !hasNavigatedRef.current || pos.p < prev.p) {
        // Mount / resume-restore / jump-back — mirror, don't grow.
        window.history.replaceState(state, "");
      } else {
        window.history.pushState(state, "");
      }
    } catch {
      // History API unavailable or throttled — the quiz works without it.
    }
  }, [currentNodeId, path, isPreview]);

  useEffect(() => {
    if (isPreview || typeof window === "undefined") return;
    const onPop = (event: PopStateEvent) => {
      const raw = event.state as unknown;
      const qz =
        raw && typeof raw === "object" && "qz" in raw
          ? (raw as { qz?: unknown }).qz
          : null;
      if (!qz || typeof qz !== "object") return; // pre-quiz/foreign entry
      const n = (qz as { n?: unknown }).n;
      const pRaw = (qz as { p?: unknown }).p;
      if (typeof n !== "string" || typeof pRaw !== "number" || !Number.isFinite(pRaw)) return;
      const p = Math.floor(pRaw);
      if (p < 0) return;
      const targetNode = doc.nodes.find((x) => x.id === n);
      if (!targetNode) return; // republish removed it → ignore
      if (n === currentNodeId && p === path.length) return; // idempotent
      if (p <= path.length) {
        // BACK (or lateral) within the current journey.
        popRestoreRef.current = true;
        if (p < path.length && path[p]?.questionNodeId === n) {
          gotoStep(p); // literally the trail-jump code path
          return;
        }
        // Intro / interstitial target — gotoStep's exact statements, with the
        // node id taken from the entry instead of path[i].
        hasNavigatedRef.current = true;
        setPath(path.slice(0, p));
        setCurrentNodeId(n);
        previewViewedRef.current = false;
        completedRef.current = targetNode.type === "result";
        return;
      }
      // FORWARD re-entry into the retained journey.
      const journey = journeyPathRef.current;
      if (p <= journey.length && isPathPrefix(path, journey)) {
        popRestoreRef.current = true;
        hasNavigatedRef.current = true;
        setPath(journey.slice(0, p));
        setCurrentNodeId(n);
        previewViewedRef.current = false;
        // Re-entering a result you already saw: mirror the resume flow —
        // completed stays true so quiz_completed/abandoned can't double-fire.
        completedRef.current = targetNode.type === "result";
        return;
      }
      // Beyond anything visited (stale forward after divergence) → ignore.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // gotoStep is re-created each render but only reads path/currentNodeId,
    // which ARE deps — listing it would just re-register every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, doc, currentNodeId, path]);

  // ── BIC-2 B2e — preload the NEXT step's images while this one renders ─────
  // Straight-through target only (collectNextStepImages, pure + unit-tested),
  // ≤4 https URLs, injected as <link rel="preload" as="image"> via this
  // effect (client-only → zero SSR/hydration surface; preview skipped). Links
  // are removed on step change/unmount so the head never litters; the session
  // Set stops re-preloading URLs the browser already fetched (revisits after
  // Back, shared images across steps). The intro hero is untouched — it ships
  // via the B2b Link response header and is never a question image.
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isPreview || typeof document === "undefined" || !currentNodeId) return;
    const urls = collectNextStepImages(doc, currentNodeId).filter(
      (u) => !preloadedUrlsRef.current.has(u),
    );
    if (urls.length === 0) return;
    const links: HTMLLinkElement[] = [];
    for (const url of urls) {
      preloadedUrlsRef.current.add(url);
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = url;
      document.head.appendChild(link);
      links.push(link);
    }
    return () => {
      for (const link of links) link.remove();
    };
  }, [currentNodeId, doc, isPreview]);

  // `extraStep` is the answer the shopper JUST picked. setPath() is async, so a
  // branch that conditions on the current question would otherwise resolve
  // against the stale `path` (missing this answer) and mis-route. Append it here
  // so the context matches routeTrace's "add the answer, then resolve" order.
  function buildBranchContext(extraStep?: PathStep): BranchContext {
    const steps = extraStep ? [...path, extraStep] : path;
    const selectedAnswerIds = new Set<string>();
    const accumulatedTags = new Set<string>();
    for (const step of steps) {
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

  function gotoNextFrom(
    nodeId: string,
    handle: string | null,
    extraStep?: PathStep,
  ) {
    // Funnel stage "engaged" (BIC P2): fires the moment the shopper LEAVES the
    // intro — i.e. they clicked Start. quiz_started fires on render (a view),
    // so engaged is the first true interaction. Click-driven → no double-fire;
    // preview no-ops via the mock analytics client; resume restores past the
    // intro so it never re-enters here.
    const sourceNode = doc.nodes.find((n) => n.id === nodeId);
    if (sourceNode?.type === "intro") {
      analyticsRef.current?.track("quiz_engaged", {});
    }
    // Forward the just-picked answer so a branch conditioning on THIS question
    // (rules tag/answer_id, or points-winner plurality) resolves against the
    // up-to-date selections — setPath() is async, so `path` is still stale here.
    const ctx = buildBranchContext(extraStep);
    const next = resolveNextStep(doc, nodeId, handle, ctx);
    // A/B assignments mutated during branch traversal live in abRef and are
    // persisted by the save effect along with the path + current node.
    if (!next) return;
    hasNavigatedRef.current = true;
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
      ? dc.kind === "free_shipping"
        ? tc("free_shipping")
        : dc.kind === "percentage"
          ? `Save ${dc.value}%`
          : `${formatMoney(dc.value, currency, locale)} off`
      : undefined;
    const stages = node.data.stages;
    if (stages.length === 0) {
      const recs = recommendForResult({
        quiz: doc,
        productIndex,
        selectedAnswerIds,
        resultNodeId: node.id,
        ...(answerWeights ? { answerWeights } : {}),
        ...targetFields,
      });
      return (
        <ResultView
          headline=""
          subtext=""
          ctaLabel={node.data.cta_label}
          recs={recs}
          globalFallback={
            recs.length === 0
              ? {
                  heading: doc.global_fallback.heading,
                  products: resolveGlobalFallbackProducts(doc.global_fallback, productIndex),
                }
              : null
          }
          resultNodeId={node.id}
          shopDomain={shopDomain}
          discountCode={discountCode}
          discountLabel={discountLabel}
          styles={styles}
          startedAt={startedAtRef.current}
          completed={completedRef}
          analytics={analyticsRef.current}
          buddySessionId={buddySessionId}
          onReset={reset}
          showVariants={node.data.show_variants}
          showDescriptions={node.data.show_descriptions}
          lowStockByProduct={lowStockByProduct}
          resultsSummaryBar={node.data.results_summary_bar}
          answerSummary={pickedAnswerLabels(doc, selectedAnswerIds)}
          retakeLink={node.data.retake_link}
          shareResults={node.data.share_results}
          oosNotify={node.data.oos_behavior === "notify_me"}
          {...buildWhyCopy(node, doc, path, selectedAnswerIds, contactRef.current)}
          bare
        />
      );
    }
    const sections = stages.map((stage) => ({
      stage,
      recs: recommendForStage(doc, productIndex, selectedAnswerIds, node.id, stage, answerWeights ?? undefined),
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
          buddySessionId={buddySessionId}
        onReset={reset}
        bare
      />
    );
  }

  let content: React.ReactNode;

  if (!currentNodeId) {
    content = (
      <div style={styles.card}>
        <h1 style={styles.h1}>{tc("quiz_unavailable")}</h1>
        <p>{tc("quiz_no_nodes")}</p>
      </div>
    );
  } else {
    const currentNode = doc.nodes.find((n) => n.id === currentNodeId);
    const layout = currentNode ? doc.node_layouts[currentNode.id] : undefined;
    const canBlockRender =
      !!currentNode &&
      !!layout &&
      layout.length > 0 &&
      layout.every(
        (b) =>
          RUNTIME_LITERAL_BLOCK_TYPES.has(b.type) ||
          RUNTIME_SMART_BLOCK_HOSTS[b.type] === currentNode.type,
      );
    if (!currentNode) {
      content = (
        <div style={styles.card}>
          <h1 style={styles.h1}>{tc("lost_the_thread")}</h1>
          <p>{tc("unknown_node")}</p>
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
        // QZY-10 — the `progress` block: answered so far + total questions.
        progress: {
          index: Math.min(
            path.length + 1,
            doc.nodes.filter((x) => x.type === "question").length || 1,
          ),
          total: doc.nodes.filter((x) => x.type === "question").length || 1,
        },
        // BLD-7 — the smart regions mount the SAME views the fixed templates
        // use, in region mode (no card shell / heading — the layout's blocks
        // own those), with identical advance/analytics wiring.
        renderSmart: (block, n) => {
          if (block.type === "recommendations" && n.type === "result") {
            return renderRecommendations(n);
          }
          if (block.type === "answers" && n.type === "question") {
            return (
              <QuestionView
                region
                node={n}
                styles={styles}
                tokens={resolved}
                onBack={() => gotoStep(path.length - 1)}
                canBack={path.length > 0}
                onTooltipView={(answerId) =>
                  analyticsRef.current?.track("tooltip_viewed", {
                    question_id: n.id,
                    answer_id: answerId,
                  })
                }
                onInspect={inspectFn}
                inspectedTarget={inspectedTarget}
                onAdvance={(answerIds, handle) => {
                  analyticsRef.current?.track("question_answered", {
                    question_id: n.id,
                    answer_ids: answerIds,
                  });
                  const step = { questionNodeId: n.id, answerIds };
                  setPath((prev) => [...prev, step]);
                  gotoNextFrom(n.id, handle, step);
                }}
              />
            );
          }
          if (block.type === "email_input" && n.type === "email_gate") {
            return (
              <EmailGateView
                region
                node={n}
                styles={styles}
                quizId={quizId}
                inspect={(part) => insp({ nodeId: n.id, part })}
                sessionId={sessionIdRef.current}
                onBack={() => gotoStep(path.length - 1)}
                canBack={path.length > 0}
                onSubmit={(contact) => {
                  if (contact?.email) {
                    contactRef.current = contact;
                    analyticsRef.current?.track("email_captured", {});
                  }
                  gotoNextFrom(n.id, null);
                }}
              />
            );
          }
          return null;
        },
      };
      content = <BlockRenderer node={node} blocks={layout} ctx={blockCtx} />;
    } else if (currentNode.type === "intro") {
      // QB-9 — Quizell-style intro. With a hero image on desktop it's a
      // side-image 2-column card (copy left, image right); otherwise a spacious
      // centered hero. Mobile stacks the image on top. (Regression-safe: no
      // existing published quiz sets hero_image_url, so image-less intros render
      // exactly as before.)
      const introDesktop = breakpoint === "desktop";
      // Image-density renderer (owner-activated): a Minimal-leaning density
      // hides the DECORATIVE intro hero on this DEFAULT render; unset density
      // changes nothing. An explicit node_layouts composition takes the
      // BlockRenderer path above this branch and stays ungated — a
      // hand-composed layout is explicit merchant intent (styleBar.ts).
      const heroImg = hideDecorativeImagery(resolved.style_bar?.image_density)
        ? undefined
        : currentNode.data.hero_image_url;
      const sideImage = introDesktop && !!heroImg;
      const headlineEl = (
        <h1
          style={
            introDesktop
              ? {
                  ...styles.h1,
                  fontSize: "calc(var(--qz-h1-size) * 1.35)",
                  lineHeight: 1.1,
                  ...(sideImage ? { textAlign: "left" as const } : {}),
                }
              : styles.h1
          }
          {...insp({ nodeId: currentNode.id, part: "headline" })}
        >
          {currentNode.data.headline}
        </h1>
      );
      const subtextEl = currentNode.data.subtext ? (
        <p
          style={
            introDesktop
              ? {
                  ...styles.muted,
                  fontSize: "calc(var(--qz-base-size) * 1.2)",
                  marginTop: 16,
                  ...(sideImage
                    ? { textAlign: "left" as const, maxWidth: 480 }
                    : { maxWidth: 540, marginLeft: "auto", marginRight: "auto" }),
                }
              : styles.muted
          }
          {...insp({ nodeId: currentNode.id, part: "subtext" })}
        >
          {currentNode.data.subtext}
        </p>
      ) : null;
      const ctaEl = (
        <button
          style={
            introDesktop
              ? {
                  ...styles.primaryBtn,
                  fontSize: "calc(var(--qz-base-size) * 1.05)",
                  padding: "calc(var(--qz-pad) / 1.5) calc(var(--qz-pad) * 1.6)",
                  ...(sideImage ? { marginTop: 26, alignSelf: "flex-start" as const } : {}),
                }
              : styles.primaryBtn
          }
          onClick={() => gotoNextFrom(currentNode.id, null)}
          {...insp({ nodeId: currentNode.id, part: "cta" })}
        >
          {currentNode.data.button_label}
        </button>
      );

      content = sideImage ? (
        <div
          style={{
            ...styles.card,
            padding: 0,
            overflow: "hidden",
            maxWidth: 940,
            display: "flex",
            alignItems: "stretch",
            minHeight: 440,
          }}
        >
          <div
            style={{
              flex: "1 1 0",
              minWidth: 0,
              padding: "48px 44px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            {headlineEl}
            {subtextEl}
            {ctaEl}
          </div>
          <div style={{ flex: "1 1 0", minWidth: 0, position: "relative" }}>
            <img
              src={heroImg}
              alt=""
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        </div>
      ) : (
        <div
          style={
            introDesktop
              ? { ...styles.card, maxWidth: 760, textAlign: "center", padding: "56px 44px" }
              : styles.card
          }
        >
          {heroImg && !introDesktop ? (
            <img
              src={heroImg}
              alt=""
              style={{
                width: "100%",
                maxHeight: 220,
                objectFit: "cover",
                borderRadius: "var(--qz-radius)",
                marginBottom: 18,
                display: "block",
              }}
            />
          ) : null}
          {headlineEl}
          {subtextEl}
          {ctaEl}
        </div>
      );
    } else if (currentNode.type === "question") {
      content = (
        <>
          {currentNode.data.education_card_before ? (
            <EducationCard
              text={currentNode.data.education_card_before}
              styles={styles}
              inspectProps={insp({ nodeId: currentNode.id, part: "education_card" })}
            />
          ) : null}
          <QuestionView
          node={currentNode}
          styles={styles}
          tokens={resolved}
          onBack={() => gotoStep(path.length - 1)}
          canBack={path.length > 0}
          onTooltipView={(answerId) =>
            analyticsRef.current?.track("tooltip_viewed", {
              question_id: currentNode.id,
              answer_id: answerId,
            })
          }
          onInspect={inspectFn}
          inspectedTarget={inspectedTarget}
          onAdvance={(answerIds, handle) => {
            analyticsRef.current?.track("question_answered", {
              question_id: currentNode.id,
              answer_ids: answerIds,
            });
            const step = { questionNodeId: currentNode.id, answerIds };
            setPath((prev) => [...prev, step]);
            // Pass the just-picked step so a branch conditioning on THIS question
            // routes against the up-to-date answers (setPath is async).
            gotoNextFrom(currentNode.id, handle, step);
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
          inspect={(part) => insp({ nodeId: currentNode.id, part })}
          sessionId={sessionIdRef.current}
          onBack={() => gotoStep(path.length - 1)}
          canBack={path.length > 0}
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
          <p
            style={{ ...styles.muted, whiteSpace: "pre-wrap", margin: 0 }}
            {...insp({ nodeId: currentNode.id, part: "message_text" })}
          >
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
          <h2 style={styles.h2} {...insp({ nodeId: node.id, part: "end_headline" })}>
            {node.data.headline}
          </h2>
          {node.data.subtext && (
            <p
              style={{ ...styles.muted, marginTop: 8 }}
              {...insp({ nodeId: node.id, part: "end_subtext" })}
            >
              {node.data.subtext}
            </p>
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
              {node.data.cta_label ?? tc("continue")}
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
          inspect={(part) => insp({ nodeId: currentNode.id, part })}
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
          sessionId={sessionIdRef.current}
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
          inspect={(part) => insp({ nodeId: currentNode.id, part })}
          onContinue={() => gotoNextFrom(currentNode.id, null)}
        />
      );
    } else if (currentNode.type === "result") {
      const selectedAnswerIds = path.flatMap((p) => p.answerIds);
      // The legacy recap/reveal theater never runs on decider docs — the v2
      // flow owns its own capture → loading gates (rec-page-spec-V2 §7).
      const wantRecap =
        Boolean(doc.show_recap) && !recapConfirmed && path.length > 0 && !isDecider;
      const wantReveal =
        doc.results_reveal === "computing" &&
        !revealDone &&
        !isDecider &&
        !(typeof window !== "undefined" &&
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      // Phase 5: a result page shows + applies the quiz discount only when it
      // opts in (include_discount) and the discount is enabled + created.
      const dc = doc.discount_config;
      const showDiscount =
        currentNode.data.include_discount && dc.enabled && Boolean(dc.code);
      const discountCode = showDiscount ? dc.code : undefined;
      const discountLabel = showDiscount
        ? dc.kind === "free_shipping"
          ? tc("free_shipping")
          : dc.kind === "percentage"
            ? `Save ${dc.value}%`
            : `${formatMoney(dc.value, currency, locale)} off`
        : undefined;
      const stages = currentNode.data.stages;
      // A decider doc ALWAYS takes the single-section path (the v2 model has
      // exactly one reveal page; legacy multi-stage never applies to it).
      if (isDecider || stages.length === 0) {
        let explained = recommendForResultExplained({
          quiz: doc,
          productIndex,
          selectedAnswerIds,
          resultNodeId: currentNode.id,
          ...(answerWeights ? { answerWeights } : {}),
          ...targetFields,
        });
        // PREVIEW-ONLY (L2-10a): a rail jump lands on the result node with an
        // EMPTY path, and in v2 the result is computed AT the decider — so an
        // unanswered decider can never resolve a target and the merchant
        // would only ever see the no-match state. Resolve the FIRST mapped
        // answer's target instead (the v2 equivalent of what legacy previews
        // always did: the category rung resolves without answers). Live mode
        // is untouched — shoppers reach results only through the decider.
        if (isPreview && isDecider && !explained.decider) {
          const deciderNode = doc.nodes.find(
            (n) => n.type === "question" && n.data.role === "decides",
          );
          const firstMapped =
            deciderNode?.type === "question"
              ? deciderNode.data.answers.find((a) => a.target_id)
              : undefined;
          if (firstMapped) {
            explained = recommendForResultExplained({
              quiz: doc,
              productIndex,
              selectedAnswerIds: [...selectedAnswerIds, firstMapped.id],
              resultNodeId: currentNode.id,
              ...(answerWeights ? { answerWeights } : {}),
              ...targetFields,
            });
          }
        }
        if (explained.decider) {
          // ── LOGIC v2 reveal (rec-page-spec-V2 §4–§7) ────────────────────
          const cfg = explained.decider.config;
          // QZY-5 §2.4 — ONE fallback switch (default ON = pre-QZY behavior).
          // The logic-build chooser (global_fallback, QZY-1) is preferred when
          // it resolves products; the legacy emptyFallbackCol → safetyNetCol
          // chain stays as the last resort so pre-QZY docs are unchanged.
          const globalFallbackRecs =
            explained.products.length === 0 && cfg.fallbackOn !== false
              ? resolveGlobalFallbackProducts(doc.global_fallback, productIndex)
              : [];
          const fallback =
            explained.products.length === 0 && cfg.fallbackOn !== false
              ? globalFallbackRecs.length > 0
                ? { source: "global_fallback" as const, products: globalFallbackRecs }
                : deciderFallbackProducts(cfg, productIndex)
              : null;
          content = (
            <DeciderResultView
              decider={explained.decider}
              fallback={fallback}
              quizId={quizId}
              sessionId={sessionIdRef.current}
              answerIds={selectedAnswerIds}
              resultNodeId={currentNode.id}
              shopDomain={shopDomain}
              styles={styles}
              startedAt={startedAtRef.current}
              completed={completedRef}
              analytics={analyticsRef.current}
              buddySessionId={buddySessionId}
              aiWhyCopy={aiWhyCopy}
              onReset={reset}
            />
          );
          // §7 theater gates (the E4 pattern): the reveal above stays computed
          // (cheap, pure); loading/capture render INSTEAD until done. Assigned
          // in reverse priority so capture wins over loading. Reduced-motion
          // skips the interstitial (the legacy reveal's posture).
          const wantLoading =
            !loadingDone &&
            !(typeof window !== "undefined" &&
              window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
          if (wantLoading) {
            content = (
              <DeciderLoadingView
                poolSize={explained.poolSize}
                onDone={() => setBeatsDone(true)}
              />
            );
          }
          // §7.1 — email default-ON (mandatory when on); every option off →
          // the capture screen is skipped entirely.
          const wantCapture =
            !captureDone &&
            (cfg.captureEmail || cfg.captureName || cfg.capturePhone);
          if (wantCapture) {
            content = (
              <DeciderCaptureView
                config={cfg}
                styles={styles}
                quizId={quizId}
                sessionId={sessionIdRef.current}
                onDone={(contact) => {
                  if (contact && Object.keys(contact).length > 0) {
                    contactRef.current = { ...contactRef.current, ...contact };
                  }
                  setCaptureDone(true);
                }}
              />
            );
          }
        } else if (isDecider) {
          // A decider doc whose target didn't resolve — impossible once the
          // V1/V2 publish gates pass; render the graceful no-match state and
          // never fall into a legacy result path.
          content = (
            <div style={styles.card}>
              <p style={{ color: "var(--qz-color-muted)" }}>{tc("no_results_match")}</p>
            </div>
          );
        } else {
        const recs = explained.products;
        // E4 — "Because you chose:" per-product reasons (≤2 answer texts).
        const tagAnswers = doc.show_match_reasons
          ? tagToAnswerText(doc, selectedAnswerIds)
          : null;
        const reasonsByProduct = tagAnswers
          ? new Map(
              explained.products.map((p) => [
                p.product_id,
                reasonsForProduct(p.matched_tags, tagAnswers),
              ]),
            )
          : null;
        // Secondary "you might also like": the same ladder fetched deeper (cap 12),
        // then diversity-filtered against the primary picks.
        const secondary = selectSecondaryRecs(
          recs,
          recommendForResult(
            {
              quiz: doc,
              productIndex,
              selectedAnswerIds,
              resultNodeId: currentNode.id,
              ...(answerWeights ? { answerWeights } : {}),
            },
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
            globalFallback={
              recs.length === 0
                ? {
                    heading: doc.global_fallback.heading,
                    products: resolveGlobalFallbackProducts(doc.global_fallback, productIndex),
                  }
                : null
            }
            secondary={secondary}
            quizId={quizId}
            sessionId={sessionIdRef.current}
            collectEmail={doc.collect_email_on_result}
            answerIds={selectedAnswerIds}
            resultNodeId={currentNode.id}
            shopDomain={shopDomain}
            reasonsByProduct={reasonsByProduct}
            escapeHatch={currentNode.data.escape_hatch ?? null}
            discountCode={discountCode}
            discountLabel={discountLabel}
            showVariants={currentNode.data.show_variants}
            showDescriptions={currentNode.data.show_descriptions}
            lowStockByProduct={lowStockByProduct}
            resultsSummaryBar={currentNode.data.results_summary_bar}
            answerSummary={pickedAnswerLabels(doc, selectedAnswerIds)}
            retakeLink={currentNode.data.retake_link}
            shareResults={currentNode.data.share_results}
            oosNotify={currentNode.data.oos_behavior === "notify_me"}
            {...buildWhyCopy(currentNode, doc, path, selectedAnswerIds, contactRef.current)}
            styles={styles}
            startedAt={startedAtRef.current}
            completed={completedRef}
            analytics={analyticsRef.current}
          buddySessionId={buddySessionId}
            onReset={reset}
            inspect={(part) => insp({ nodeId: currentNode.id, part })}
            splitLayout={resolved.result_split === true && breakpoint === "desktop"}
            heroLogic={currentNode.data.hero_logic}
            heroOos={currentNode.data.hero_oos}
          />
        );
        }
      } else {
        const stageSections = stages.map((stage) => ({
          stage,
          recs: recommendForStage(
            doc,
            productIndex,
            selectedAnswerIds,
            currentNode.id,
            stage,
            answerWeights ?? undefined,
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
            answerIds={selectedAnswerIds}
            resultNodeId={currentNode.id}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            styles={styles}
            startedAt={startedAtRef.current}
            completed={completedRef}
            analytics={analyticsRef.current}
          buddySessionId={buddySessionId}
            onReset={reset}
            inspect={(part) => insp({ nodeId: currentNode.id, part })}
          />
        );
      }
      // Experiences E4 — theater gates: the result content above stays
      // computed (cheap, pure); recap/reveal simply render INSTEAD until
      // confirmed/done. Recap wins over reveal.
      if (wantReveal) {
        const revealData = recommendForResultExplained({
          quiz: doc,
          productIndex,
          selectedAnswerIds,
          resultNodeId: currentNode.id,
          ...(answerWeights ? { answerWeights } : {}),
        });
        content = (
          <RevealView
            tagBag={revealData.tagBag}
            poolSize={revealData.poolSize}
            onDone={() => setRevealDone(true)}
          />
        );
      }
      if (wantRecap) {
        content = (
          <RecapView
            doc={doc}
            path={path}
            styles={styles}
            onJump={gotoStep}
            onConfirm={() => setRecapConfirmed(true)}
          />
        );
      }
    }
  }

  const currentNode = currentNodeId
    ? doc.nodes.find((n) => n.id === currentNodeId)
    : null;
  const showPreview = previewActive && currentNode?.type !== "result";

  // R6 — the percentage ProductCard may render as a strikethrough. Only an
  // UNCONDITIONAL percentage discount maps honestly to a per-item struck price
  // (a fixed amount / free shipping is order-level; a min-subtotal/quantity or
  // collection/product scope means it may not apply to a given item at a given
  // cart size). Those cases keep the badge-only display (strike percent = null).
  const dcRoot = doc.discount_config;
  const strikethroughPercent =
    dcRoot.enabled &&
    dcRoot.kind === "percentage" &&
    dcRoot.applies_to === "all" &&
    dcRoot.minimum_subtotal == null &&
    dcRoot.minimum_quantity == null
      ? dcRoot.value
      : null;

  // QZY-11 — the current screen's background (absent = today's page markup).
  const screenBg = currentNodeId ? doc.node_backgrounds?.[currentNodeId] : undefined;
  const screenBgVideo = screenBg ? videoLayer(screenBg) : null;

  return (
    <RuntimePreviewContext.Provider value={isPreview}>
    <RuntimeDiscountContext.Provider value={strikethroughPercent}>
    <RuntimePlatformContext.Provider value={platform}>
    <RuntimeChromeContext.Provider value={chromeVariant}>
    <ChromeContext.Provider value={chromeTable}>
    <RuntimeLocaleContext.Provider value={locale}>
    <RuntimeCurrencyContext.Provider value={currency}>
    <div
      ref={rootRef}
      lang={locale}
      className={`${breakpoint === "desktop" ? "qz-bp-desktop" : "qz-bp-mobile"}${
        !isPreview && measuredBreakpoint === null ? " qz-unmeasured" : ""
      }`}
      style={rootStyle}
    >
      {fontUrl && <link rel="stylesheet" href={fontUrl} />}
      {inspectFn ? (
        <style>{`
          .qz-insp { cursor: pointer; }
          .qz-insp:hover { outline: 2px dashed var(--qz-color-accent, #999); outline-offset: 3px; border-radius: 4px; }
          .qz-insp-sel { outline: 2px solid var(--qz-color-accent, #999); outline-offset: 3px; border-radius: 4px; }
        `}</style>
      ) : null}
      {/* CSS must stay free of ' " < > & — React HTML-escapes text children of
          <style>, turning e.g. an apostrophe in a comment into &#x27; on the
          server (but ' on the client) → a #425 hydration mismatch that cascades
          into #418 on every quiz. Keep apostrophe-prone prose in JSX comments
          like this one, never in the CSS string below. */}
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
        /* §4 the side question image: full-width on mobile (same as top), float-right
           on desktop so the question text wraps beside it, answers clear below. */
        .qz-q-img-side { width: 100%; max-height: 280px; object-fit: cover; border-radius: var(--qz-radius); margin-bottom: 16px; display: block; }
        .qz-bp-desktop .qz-q-img-side { float: right; width: 38%; max-width: 300px; max-height: 240px; margin: 4px 0 14px 22px; }
        /* Experiences E3 — step enter: a quiet fade + 6px lift, replayed per
           node via the content key. The reduced-motion strip above zeroes it. */
        .qz-runtime-content { animation: qz-node-enter var(--qz-dur, 170ms) var(--qz-ease, ease) both; }
        @keyframes qz-node-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        /* RP1 — a quiet heartbeat on the urgency badge (opt-in via urgency_enabled).
           The reduced-motion strip above zeroes it automatically. */
        @keyframes qz-urgency-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        .qz-urgency-pulse { display: inline-block; animation: qz-urgency-pulse 1.8s var(--qz-ease, ease) infinite; }
        /* Unified P1: ONE layout mechanism for preview AND live — the qz-bp-*
           class on the root. Preview sets it from the DeviceFrame width prop;
           live sets it from the container-measured breakpoint. The old live
           @media(900px) fork carried these exact rules keyed to the WINDOW. */
        .qz-bp-desktop .qz-runtime-page { align-items: flex-start !important; justify-content: center !important; padding-top: var(--qz-pp-top, 64px) !important; }
        .qz-bp-desktop .qz-runtime-shell { flex-direction: row; align-items: flex-start; max-width: 1100px; gap: 40px; }
        .qz-bp-desktop .qz-runtime-content { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; }
        .qz-bp-desktop .qz-preview-rail { flex: 0 0 320px; position: sticky; top: 64px; }
        .qz-bp-desktop .qz-preview-chip { display: none !important; }
        .qz-bp-mobile .qz-preview-rail { display: none; }
        /* Unified P6 — pre-hydration container correctness. Before JS measures
           (the server-rendered qz-unmeasured class), container queries pick the desktop
           shell layout on wide containers, so the no-JS / pre-hydration first
           paint is already right. Scoped to qz-unmeasured so the MEASURED
           system owns everything after hydration (no dual-source conflicts —
           including the 16px hysteresis band). Browsers without @container
           keep the coherent mobile-first default. */
        @container (min-width: 900px) {
          .qz-unmeasured .qz-runtime-page { align-items: flex-start !important; justify-content: center !important; padding-top: var(--qz-pp-top, 64px) !important; }
          .qz-unmeasured .qz-runtime-shell { flex-direction: row; align-items: flex-start; max-width: 1100px; gap: 40px; }
          .qz-unmeasured .qz-runtime-content { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; }
          .qz-unmeasured .qz-preview-rail { flex: 0 0 320px; position: sticky; top: 64px; }
          .qz-unmeasured .qz-preview-chip { display: none !important; }
        }
      `}</style>
      <div
        className="qz-runtime-page"
        data-qz-screenbg={screenBg ? "" : undefined}
        style={
          screenBg
            ? {
                ...styles.page,
                ...screenBackgroundCss(screenBg),
                position: "relative",
                overflow: "hidden",
              }
            : styles.page
        }
      >
        {/* QZY-11 §8.2 — the video background layer: ALWAYS muted; mobile
            falls back to the poster by default (a per-instance style tag ships
            only when a video background exists). */}
        {screenBgVideo ? (
          <div className="qz-screenbg" aria-hidden data-mobile={screenBgVideo.mobilePlays ? "play" : "poster"}>
            <style>{`.qz-screenbg{position:absolute;inset:0;pointer-events:none}.qz-screenbg video,.qz-screenbg img{width:100%;height:100%;object-fit:cover;object-position:${(screenBg?.focal_x ?? 50)}% ${(screenBg?.focal_y ?? 50)}%}.qz-screenbg img{display:none}@media (max-width:640px){.qz-screenbg[data-mobile="poster"] video{display:none}.qz-screenbg[data-mobile="poster"] img{display:block}}`}</style>
            <video
              src={screenBgVideo.url}
              poster={screenBgVideo.poster}
              autoPlay
              loop
              muted
              playsInline
            />
            {screenBgVideo.poster ? <img src={screenBgVideo.poster} alt="" /> : null}
          </div>
        ) : null}
        {screenBg && screenOverlayAlpha(screenBg) > 0 ? (
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: `rgba(0,0,0,${screenOverlayAlpha(screenBg)})`,
              backdropFilter: screenBg.blur ? `blur(${screenBg.blur}px)` : undefined,
              pointerEvents: "none",
            }}
          />
        ) : null}
        <div
          className="qz-runtime-shell"
          style={screenBg ? { position: "relative", zIndex: 1 } : undefined}
        >
          <div key={currentNodeId ?? "none"} className="qz-runtime-content" ref={contentRef} tabIndex={-1} style={{ outline: "none" }}>
            {/* Design §1 — brand logo header. Renders once above the step when a
                logo is set; absent → no header (byte-stable). data: and https:
                urls render identically via <img>. */}
            {resolved.logo?.url ? (
              <div
                className="qz-brand-header"
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: resolved.logo.align === "left" ? "flex-start" : "center",
                  marginBottom: 16,
                }}
              >
                <img
                  src={resolved.logo.url}
                  alt=""
                  style={{
                    maxHeight:
                      resolved.logo.size === "sm" ? 24 : resolved.logo.size === "lg" ? 52 : 36,
                    maxWidth: "60%",
                    width: "auto",
                    objectFit: "contain",
                  }}
                />
              </div>
            ) : null}
            {/* Polite announcement of the current step for screen readers. */}
            <div
              aria-live="polite"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                overflow: "hidden",
                clipPath: "inset(50%)",
                whiteSpace: "nowrap",
              }}
            >
              {(() => {
                const n = doc.nodes.find((x) => x.id === currentNodeId);
                if (!n) return "";
                if (n.type === "question") return n.data.text;
                if (n.type === "intro") return n.data.headline;
                if (n.type === "result") return n.data.headline || tc("your_results");
                return "";
              })()}
            </div>
            {/* §4 progress: enabled gates ALL progress UI; position moves the
                bar (top default / bottom). The step label/trail stays at top. */}
            {progressEnabled && !progressAtBottom ? (
              <ProgressBar
                doc={doc}
                path={path}
                currentNodeId={currentNodeId}
                barStyle={progressBarStyle}
              />
            ) : null}
            {progressEnabled ? (
              chromeVariant === "minimal" ? (
                <MinimalQuestionLabel doc={doc} path={path} currentNodeId={currentNodeId} />
              ) : (
                <ProgressTrail
                  doc={doc}
                  path={path}
                  currentNodeId={currentNodeId}
                  onJump={gotoStep}
                />
              )
            ) : null}
            {content}
            {progressEnabled && progressAtBottom ? (
              <ProgressBar
                doc={doc}
                path={path}
                currentNodeId={currentNodeId}
                barStyle={progressBarStyle}
              />
            ) : null}
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
      {/* QB-5 — "Build with Quizocalypse" badge. Standalone quizzes only, so the
          embedded /app preview + every published Shopify /q stay pixel-identical
          (the regression guarantee). Preview: anchored to the runtime box; live:
          fixed bottom-right of the viewport, like Quizell's badge. */}
      {platform === "standalone" ? (
        <a
          href="https://quizocalypse-studio.fly.dev"
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => {
            if (isPreview) e.preventDefault();
          }}
          style={{
            position: isPreview ? "absolute" : "fixed",
            bottom: 14,
            right: 14,
            zIndex: 20,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 8,
            background: "rgba(17,17,19,0.88)",
            color: "#fff",
            fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
            fontSize: 12,
            fontWeight: 500,
            textDecoration: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
          }}
        >
          Build with
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
              borderRadius: 4,
              background: "#0B6BCB",
              color: "#fff",
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            Q
          </span>
          Quizocalypse
        </a>
      ) : null}
    </div>
    </RuntimeCurrencyContext.Provider>
    </RuntimeLocaleContext.Provider>
    </ChromeContext.Provider>
    </RuntimeChromeContext.Provider>
    </RuntimePlatformContext.Provider>
    </RuntimeDiscountContext.Provider>
    </RuntimePreviewContext.Provider>
  );
}

// Spec §2 urgency — fetch current stock for the given products at result-page
// load. Returns product_id → available quantity (only tracked products). Best
// effort: any failure resolves to an empty map so the page renders without the
// urgency line rather than erroring.
async function fetchLiveInventory(
  quizId: string,
  productIds: string[],
): Promise<Record<string, number>> {
  if (!quizId || productIds.length === 0) return {};
  try {
    const res = await fetch(`/q/${quizId}/inventory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ product_ids: productIds }),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { quantities?: Record<string, number> };
    return data.quantities ?? {};
  } catch {
    return {};
  }
}

// Spec §6 results-summary bar — the shopper's picked answer texts, in the order
// they were chosen. Pure; deduped so a tag selected twice doesn't repeat.
function pickedAnswerLabels(
  quiz: QuizDoc,
  selectedAnswerIds: string[],
): string[] {
  const labelById = new Map<string, string>();
  for (const node of quiz.nodes) {
    if (node.type !== "question") continue;
    for (const a of node.data.answers) labelById.set(a.id, a.text);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of selectedAnswerIds) {
    const label = labelById.get(id);
    if (label && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

// Spec §3 — resolve the result node's "Why we recommend" copy (Mode A intro +
// Mode B per-product blurbs) against the shopper's path. Returns undefined/null
// when each mode is off so ResultView simply skips it.
function buildWhyCopy(
  node: Extract<QuizDoc["nodes"][number], { type: "result" }>,
  doc: QuizDoc,
  path: PathStep[],
  selectedAnswerIds: string[],
  ambient: { name?: string; email?: string },
): { whyIntro?: string; blurbByProduct: Map<string, string> | null } {
  const data = node.data;
  if (!data.why_intro_enabled && !data.why_blurbs_enabled) {
    return { whyIntro: undefined, blurbByProduct: null };
  }
  const ctx = buildMergeContext(path, doc, ambient);
  const allAnswers = pickedAnswerLabels(doc, selectedAnswerIds);
  const whyIntro = data.why_intro_enabled
    ? resolveCopyTokens(data.why_intro, ctx, allAnswers)
    : undefined;
  const blurbByProduct = data.why_blurbs_enabled
    ? new Map(
        Object.entries(data.product_blurbs).map(([pid, txt]) => [
          pid,
          resolveCopyTokens(txt, ctx, allAnswers),
        ]),
      )
    : null;
  return { whyIntro, blurbByProduct };
}
