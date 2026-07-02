import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChromeContext, CHROME_TOKENS, useChrome, type ChromeToken } from "./chromeStrings";
import { tagToAnswerText, reasonsForProduct } from "../../lib/matchReasons";
import type { Quiz, ResultStage as ResultStageT } from "../../lib/quizSchema";
import { isFreeformType } from "../../lib/quizSchema";
import {
  resolveNextStep,
  recommendForResult,
  recommendForResultExplained,
  recommendForStage,
  recommendPreview,
  selectSecondaryRecs,
  resolveGlobalFallbackProducts,
  type BranchContext,
  type ExplainedRecommendation,
  type IndexedProduct,
  type RecommendedProduct,
} from "../../lib/recommendationEngine";
import {
  deciderFallbackProducts,
  type DeciderFallback,
  type ResolvedRecPageConfig,
} from "../../lib/recommendDecider";
import { resolveNodeOverride } from "../../lib/resultLayout";
import { selectHeroAndGrid } from "../../lib/heroProduct";
import { hideDecorativeImagery, questionImagePosition } from "../../lib/styleBar";
import { cartPermalink, numericId, cartPermalinkMulti } from "../../lib/cartLink";
import { productHref, type QuizPlatform } from "../../lib/productHref";
import { progressPct, reachableQuestionCount } from "../../lib/progress";
import { formatMoney } from "../../lib/formatMoney";
import { discountedItemPrice } from "../../lib/discountMath";
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
import { stylesFor, googleFontsUrl, useContainerBreakpoint } from "./runtimeStyles";
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

// Editor inspect mode (Dev plan "editor revamp"): in the builder preview, the
// content elements a merchant would edit (headlines, question text, answers,
// education cards, result copy) become click-to-inspect — hover outline + click
// reports WHICH element was clicked instead of performing its normal action.
// The storefront never passes `onInspect`, in which case `inspectAttrs` returns
// {} and the rendered DOM/behavior is unchanged.
export type InspectPart =
  | "headline"
  | "subtext"
  | "cta"
  | "question_text"
  | "answer"
  | "education_card"
  | "result_headline"
  | "result_subtext"
  // Unified P3 — click-to-edit covers every visible node type.
  | "message_text"
  | "end_headline"
  | "end_subtext"
  | "email_headline"
  | "email_subtext"
  | "askai_persona"
  | "pc_headline"
  | "pc_subtext";

export interface InspectTarget {
  nodeId: string;
  part: InspectPart;
  answerId?: string;
}

function inspectAttrs(
  onInspect: ((t: InspectTarget) => void) | undefined,
  selected: InspectTarget | null | undefined,
  target: InspectTarget,
): React.HTMLAttributes<HTMLElement> {
  if (!onInspect) return {};
  const isSelected =
    !!selected &&
    selected.nodeId === target.nodeId &&
    selected.part === target.part &&
    (selected.answerId ?? null) === (target.answerId ?? null);
  return {
    onClickCapture: (e) => {
      // Capture phase: beat the element's own handler (advance/select/toggle)
      // so inspecting never mutates quiz state.
      e.preventDefault();
      e.stopPropagation();
      onInspect(target);
    },
    className: isSelected ? "qz-insp qz-insp-sel" : "qz-insp",
  };
}

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
// K2 — the resolved serving locale ("en" default). Consumed by the
// save-results link (locale-sticky URLs) and the AskAI POST (reply language).
const RuntimeLocaleContext = createContext("en");
// The shop's ISO 4217 currency (baked into the published doc at publish time;
// "USD" default for pre-existing quizzes). Deep product-card leaves read it via
// context (same seam as locale) to format prices with the right symbol +
// decimals (¥886, not "$886") without threading a prop through every component.
const RuntimeCurrencyContext = createContext("USD");
// QD-7 — the commerce platform ("shopify" default). The deep product-card
// leaves read this (same pattern as the preview/locale contexts) to decide
// PDP href + cart vs "Shop now", without threading a prop through every
// intermediate result/preview component. `productHref` (pure, lib) centralizes
// the link rule both platforms share.
const RuntimePlatformContext = createContext<QuizPlatform>("shopify");
// MQ — the resolved shopper-runtime CHROME. "classic" = today's card + pill-trail
// + auto-advance; "minimal" = the Quizell-style top bar + card-less grey-chip
// question + Back/Next + vertical result. Resolved once at the root from the
// quiz's `chrome` token, defaulting by platform (standalone → minimal). Deep views
// read it via context (same seam as platform/preview/locale) — no prop drilling.
type ChromeVariant = "classic" | "minimal";
const RuntimeChromeContext = createContext<ChromeVariant>("classic");
// R6 (Rec-Page §2) — the quiz-level PERCENTAGE that ProductCard may render as a
// struck original + accent discounted price. Set only for an unconditional
// percentage discount (kind=percentage · applies_to=all · no minimums); null for
// fixed/free-shipping/conditional discounts (those keep the badge-only display).
// The PER-RESULT gate stays on the card's `discountLabel` prop (which is set iff
// that node's include_discount + the live code resolve), so the strikethrough
// only shows when BOTH the node opts in AND the discount is percentage-eligible.
const RuntimeDiscountContext = createContext<number | null>(null);

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
  // Spec §2 urgency — product_id → live stock qty (only entries at/below the
  // result's threshold). Fetched fresh when a result page renders (never baked,
  // never cached) so "Only X left" reflects real-time Shopify inventory.
  const [lowStockByProduct, setLowStockByProduct] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    setRecapConfirmed(false);
    setRevealDone(false);
    setCaptureDone(false);
    setLoadingDone(false);
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
      layout.every((b) => RUNTIME_BLOCK_TYPES.has(b.type));
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
        renderSmart: (block, n) =>
          block.type === "recommendations" && n.type === "result"
            ? renderRecommendations(n)
            : null,
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
          const fallback =
            explained.products.length === 0
              ? deciderFallbackProducts(cfg, productIndex)
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
                onDone={() => setLoadingDone(true)}
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
      <div className="qz-runtime-page" style={styles.page}>
        <div className="qz-runtime-shell">
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

// Clickable progress trail — one pill per answered question (jump back to
// re-answer) + the current question. Lets the shopper move around the quiz
// Thin percent-complete bar above the step trail (Phase 5). Denominator =
// reachable question steps; numerator = answered + the one in progress.
// §4 per-quiz question image. position none → hidden; top (default) → today's
// full-width image above the question (BYTE-IDENTICAL to the prior inline render);
// side → desktop float-right (content wraps left; the answer grid clears below),
// mobile falls back to the top layout via the breakpoint CSS classes.
function QuestionImage({
  url,
  position,
}: {
  url?: string;
  position?: "none" | "top" | "side";
}) {
  if (!url || position === "none") return null;
  if (position === "side") {
    return <img src={url} alt="" className="qz-q-img-side" />;
  }
  return (
    <img
      src={url}
      alt=""
      style={{
        width: "100%",
        maxHeight: 280,
        objectFit: "cover",
        borderRadius: "var(--qz-radius)",
        marginBottom: 16,
        display: "block",
      }}
    />
  );
}

function ProgressBar({
  doc,
  path,
  currentNodeId,
  barStyle = "bar",
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
  // §4 progress style. "bar" (default) is today's thin %-fill bar — byte-stable.
  barStyle?: "bar" | "dots" | "steps";
}) {
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const total = useMemo(() => reachableQuestionCount(doc), [doc]);
  if (total <= 0) return null;
  const node = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  const onResult = node?.type === "result" || node?.type === "end";
  const onQuestion = node?.type === "question";
  const answered = path.length + (onQuestion ? 1 : 0);
  const pct = onResult ? 100 : progressPct(total, answered);

  // §4 dots / steps — N markers, filled up to the current question. Caps at a
  // reasonable count so a long quiz doesn't overflow (falls back to the bar).
  if ((barStyle === "dots" || barStyle === "steps") && total <= 12) {
    const filled = onResult ? total : Math.min(answered, total);
    const on = minimal ? "var(--qz-color-text)" : "var(--qz-color-primary)";
    const off = minimal ? "var(--qz-color-surface)" : "#00000010";
    const isSteps = barStyle === "steps";
    return (
      <div
        aria-hidden
        style={{
          display: "flex",
          gap: isSteps ? 6 : 8,
          width: isSteps ? "100%" : undefined,
          justifyContent: "center",
          marginBottom: minimal ? 26 : 12,
        }}
      >
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              ...(isSteps ? { flex: 1, height: minimal ? 8 : 6 } : { width: 9, height: 9 }),
              borderRadius: 999,
              background: i < filled ? on : off,
              transition: "background var(--qz-dur, 170ms) var(--qz-ease, ease)",
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      style={
        minimal
          ? {
              // Quizell: a thick black bar pinned across the top of the quiz.
              height: 9,
              borderRadius: 999,
              background: "var(--qz-color-surface)",
              overflow: "hidden",
              marginBottom: 26,
              width: "100%",
            }
          : {
              height: 6,
              borderRadius: 999,
              background: "#00000010",
              overflow: "hidden",
              marginBottom: 12,
            }
      }
      aria-hidden
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          ...(minimal ? { borderRadius: 999 } : {}),
          background: minimal ? "var(--qz-color-text)" : "var(--qz-color-primary)",
          transition: "width var(--qz-dur, 170ms) var(--qz-ease, ease)",
        }}
      />
    </div>
  );
}

// MQ — the Quizell "Question # N" eyebrow shown above the question under the
// minimal chrome (replaces the classic pill trail). N = 1-indexed position among
// the answered questions + the current one.
function MinimalQuestionLabel({
  doc,
  path,
  currentNodeId,
}: {
  doc: QuizDoc;
  path: PathStep[];
  currentNodeId: string | null;
}) {
  const tc = useChrome();
  const node = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  if (node?.type !== "question") return null;
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 640,
        textAlign: "left",
        fontSize: "1em",
        fontWeight: 500,
        color: "var(--qz-color-text)",
        marginBottom: 22,
        fontFamily: "var(--qz-font-body)",
      }}
    >
      {tc("question_counter", { n: path.length + 1 })}
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
  const tc = useChrome();
  const current = currentNodeId ? doc.nodes.find((n) => n.id === currentNodeId) : null;
  const currentIsQuestion = current?.type === "question";
  if (path.length === 0 && !currentIsQuestion) return null;

  const label = (qid: string, i: number): string => {
    const node = doc.nodes.find((n) => n.id === qid);
    const text = node && node.type === "question" ? node.data.text : `Step ${i + 1}`;
    return text.length > 22 ? `${text.slice(0, 21)}…` : text;
  };
  // E3 chapters: the CURRENT question's section_label renders as a chapter
  // eyebrow over the trail ("SKIN PROFILE · step 4 of 9" feel). Pills keep
  // their exact DOM (e2e contract); absent labels = no eyebrow.
  const sectionOf = (qid: string | null): string | null => {
    if (!qid) return null;
    const node = doc.nodes.find((n) => n.id === qid);
    return node && node.type === "question" ? (node.data.section_label ?? null) : null;
  };
  const currentSection = sectionOf(currentNodeId);
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
    <>
    {currentSection ? (
      <div
        style={{
          fontSize: "0.7em",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--qz-color-muted, #888)",
          fontFamily: "var(--qz-font-body)",
          marginBottom: 6,
          maxWidth: 560,
          width: "100%",
        }}
      >
        {currentSection}
      </div>
    ) : null}
    <div
      aria-label={tc("aria_quiz_progress")}
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        // Pin wrapped rows to the top so a pill can never stretch vertically
        // (which, in a stretched flex parent, turned them into tall ovals).
        alignContent: "flex-start",
        marginBottom: 16,
        maxWidth: 560,
        width: "100%",
      }}
    >
      {path.map((s, i) => (
        <button
          key={`${s.questionNodeId}-${i}`}
          onClick={() => onJump(i)}
          title="Jump back to this question"
          aria-label={tc("aria_go_back_to", { n: i + 1, label: label(s.questionNodeId, i) })}
          style={pill(false, true)}
        >
          {i + 1}. {label(s.questionNodeId, i)}
        </button>
      ))}
      {currentIsQuestion && current ? (
        <span style={pill(true, false)} aria-current="step">
          {path.length + 1}. {label(current.id, path.length)}
        </span>
      ) : null}
    </div>
    </>
  );
}

// Experiences E4 — "Just making sure we're on the right track": the answer
// recap before the first result render. Edit buttons reuse the trail's jump
// (which resets the path from that point, so the theater replays after).
function RecapView({
  doc,
  path,
  styles,
  onJump,
  onConfirm,
}: {
  doc: QuizDoc;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onJump: (i: number) => void;
  onConfirm: () => void;
}) {
  const tc = useChrome();
  const answerText = (step: PathStep): string => {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    if (!q || q.type !== "question") return "";
    return step.answerIds
      .map((id) => q.data.answers.find((a) => a.id === id)?.text ?? "")
      .filter(Boolean)
      .join(", ");
  };
  const questionText = (step: PathStep): string => {
    const q = doc.nodes.find((n) => n.id === step.questionNodeId);
    return q && q.type === "question" ? q.data.text : "";
  };
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{tc("recap_heading")}</h2>
      <p style={{ ...styles.muted, marginTop: 4 }}>{tc("recap_subtext")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "18px 0" }}>
        {path.map((step, i) => (
          <div
            key={`${step.questionNodeId}-${i}`}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              borderBottom: "1px solid color-mix(in srgb, var(--qz-color-muted, #aaa) 30%, transparent)",
              paddingBottom: 8,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ ...styles.muted, fontSize: "0.78em" }}>{questionText(step)}</div>
              <div style={{ fontFamily: "var(--qz-font-body)", fontWeight: 600 }}>{answerText(step)}</div>
            </div>
            <button
              type="button"
              onClick={() => onJump(i)}
              style={{
                font: "inherit",
                fontSize: "0.8em",
                background: "transparent",
                border: "none",
                color: "var(--qz-color-accent, var(--qz-color-primary))",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {tc("recap_edit")}
            </button>
          </div>
        ))}
      </div>
      <button type="button" style={styles.primaryBtn} onClick={onConfirm}>
        {tc("recap_confirm")}
      </button>
    </div>
  );
}

// Experiences E4 — the visible-computation reveal: three timed beats fed by
// the REAL explained-engine output (the path's tag bag + candidate pool size),
// not theater copy. Reduced-motion paths skip this entirely (gated upstream).
function RevealView({
  tagBag,
  poolSize,
  onDone,
}: {
  tagBag: Record<string, number>;
  poolSize: number;
  onDone: () => void;
}) {
  const tc = useChrome();
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    const beats = [1100, 1500, 1100];
    if (beat >= beats.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => setBeat((b) => b + 1), beats[beat]);
    return () => clearTimeout(t);
  }, [beat, onDone]);
  const factors = Object.entries(tagBag)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag, w]) => (w !== 1 ? `${tag} ×${w}` : tag))
    .join(" · ");
  const lines = [
    tc("reveal_weighing"),
    factors ? tc("reveal_factors", { factors }) : tc("reveal_weighing"),
    tc("reveal_matching", { n: poolSize }),
  ];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "56px 24px",
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-color-text)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "3px solid color-mix(in srgb, var(--qz-color-primary) 25%, transparent)",
          borderTopColor: "var(--qz-color-primary)",
          animation: "qz-spin 0.9s linear infinite",
        }}
      />
      <div style={{ fontSize: "1.05em", fontWeight: 600 }}>{lines[Math.min(beat, lines.length - 1)]}</div>
      <style>{`@keyframes qz-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-9) — the decider flow's capture → loading → reveal views.
// Deliberately their OWN components (NOT extensions of EmailGateView/
// RevealView/ResultView) so the superseded legacy mechanisms — node-driven
// gate copy, hero_logic="match", per-node result knobs — can never collide
// with the v2 semantics. Only docs with logic_model==="decider" mount these.
// ════════════════════════════════════════════════════════════════════════════

// §7 — the loading interstitial between capture and reveal. The reveal content
// itself is computed synchronously (cheap, pure), so this is the pacing device:
// two beats totalling ~1.6s (spec: min ~1.5s, cap ~5s). Reduced-motion paths
// skip it entirely (gated upstream, the legacy reveal's posture). Copy reuses
// the K1 reveal tokens so existing translations carry over unchanged.
function DeciderLoadingView({
  poolSize,
  onDone,
}: {
  poolSize: number;
  onDone: () => void;
}) {
  const tc = useChrome();
  const [beat, setBeat] = useState(0);
  // onDone is an inline arrow at the call site (new identity per parent
  // render) — hold it in a ref so a mid-beat parent re-render can't reset
  // the running beat timer and stretch the interstitial.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const beats = [900, 700];
    if (beat >= beats.length) {
      onDoneRef.current();
      return;
    }
    const t = setTimeout(() => setBeat((b) => b + 1), beats[beat]);
    return () => clearTimeout(t);
  }, [beat]);
  const lines = [
    tc("reveal_weighing"),
    poolSize > 0 ? tc("reveal_matching", { n: poolSize }) : tc("reveal_weighing"),
  ];
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        padding: "56px 24px",
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-color-text)",
        textAlign: "center",
      }}
    >
      <div
        aria-hidden
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "3px solid color-mix(in srgb, var(--qz-color-primary) 25%, transparent)",
          borderTopColor: "var(--qz-color-primary)",
          animation: "qz-spin 0.9s linear infinite",
        }}
      />
      <div style={{ fontSize: "1.05em", fontWeight: 600 }}>
        {lines[Math.min(beat, lines.length - 1)]}
      </div>
      <style>{`@keyframes qz-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// §7.1 — the pre-reveal capture screen. Renders only the fields the merchant
// enabled (email is default-ON via REC_PAGE_DEFAULTS and MANDATORY when on —
// no skip link, the spec's deliberate delta from the legacy gate). All-off
// never mounts this (the caller skips the screen). Preview never POSTs; the
// finally block always reveals, so a capture failure can't strand the shopper.
function DeciderCaptureView({
  config,
  styles,
  quizId,
  sessionId,
  onDone,
}: {
  config: ResolvedRecPageConfig;
  styles: ReturnType<typeof stylesFor>;
  quizId: string;
  sessionId: string;
  onDone: (contact?: { email?: string; name?: string; phone?: string }) => void;
}) {
  const tc = useChrome();
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const emailValid = /^\S+@\S+\.\S+$/.test(email);
  const canSubmit = (config.captureEmail ? emailValid : true) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // /captures requires an email; a name/phone-only config (email off) has
      // nothing to persist server-side. Preview never POSTs.
      if (!isPreviewMode && emailValid) {
        await fetch("/captures", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quiz_id: quizId,
            session_id: sessionId,
            email,
            ...(name.trim() ? { first_name: name.trim() } : {}),
            ...(phone.trim() ? { phone: phone.trim() } : {}),
          }),
          keepalive: true,
        });
      }
    } catch {
      // Don't hold the reveal hostage to a capture failure.
    } finally {
      // Only PRESENT keys — an explicit-undefined spread would clobber
      // contact fields an earlier email_gate node already captured.
      onDone({
        ...(email ? { email } : {}),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
    }
  }
  const submitOnEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleSubmit();
  };
  const inputStyle: React.CSSProperties = {
    padding: minimal ? "15px 16px" : "12px 14px",
    borderRadius: "var(--qz-radius)",
    border: minimal
      ? "1.5px solid color-mix(in srgb, var(--qz-color-text) 22%, transparent)"
      : "1px solid #00000022",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    ...(minimal ? { textAlign: "left" as const, background: "var(--qz-color-bg)" } : {}),
  };
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{tc("capture_headline")}</h2>
      <p style={{ ...styles.muted, marginTop: 8 }}>{tc("capture_subtext")}</p>
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {config.captureEmail && (
          <input
            type="email"
            aria-label={tc("gate_email_placeholder")}
            placeholder={tc("gate_email_placeholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={submitOnEnter}
            style={inputStyle}
          />
        )}
        {config.captureName && (
          <input
            type="text"
            aria-label={tc("gate_name_placeholder")}
            placeholder={tc("gate_name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={submitOnEnter}
            style={inputStyle}
          />
        )}
        {config.capturePhone && (
          <input
            type="tel"
            aria-label={tc("gate_phone_placeholder")}
            placeholder={tc("gate_phone_placeholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={submitOnEnter}
            style={inputStyle}
          />
        )}
      </div>
      <button
        style={{ ...styles.primaryBtn, opacity: canSubmit ? 1 : 0.5, marginTop: 20 }}
        disabled={!canSubmit}
        onClick={handleSubmit}
      >
        {submitting ? "…" : tc("continue")}
      </button>
    </div>
  );
}

// §4–§6 — the target-based reveal page: headline + why-copy from the effective
// (override-merged) config, the hero card, the grid, the incentive chip, and
// the §6 fallback section when the resolved target has nothing showable.
function DeciderResultView({
  decider,
  fallback,
  quizId,
  sessionId,
  answerIds,
  resultNodeId,
  shopDomain,
  styles,
  startedAt,
  completed,
  analytics,
  buddySessionId,
  onReset,
}: {
  decider: NonNullable<ExplainedRecommendation["decider"]>;
  fallback: DeciderFallback | null;
  quizId?: string;
  sessionId?: string;
  answerIds: string[];
  resultNodeId: string;
  shopDomain?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  buddySessionId?: string | null;
  onReset: () => void;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const cfg = decider.config;
  const hero = decider.hero;
  const grid = decider.grid;
  const showFallback =
    !hero && grid.length === 0 && (fallback?.products.length ?? 0) > 0;
  const fallbackRecs: RecommendedProduct[] = showFallback
    ? fallback!.products.map((p) => ({ ...p, score: 0 }))
    : [];

  // Completion + view analytics, once (the legacy ResultView contract). The v2
  // payload additively carries the resolved target + matched rule — it rides
  // Event.payload Json, no migration.
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    const shownIds = [
      ...(hero ? [hero.product_id] : []),
      ...grid.map((p) => p.product_id),
      ...fallbackRecs.map((p) => p.product_id),
    ];
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: shownIds,
      secondary_product_ids: [],
      resolved_target_id: decider.targetId,
      matched_rule_id: decider.matchedRuleId,
      ...(showFallback ? { fallback_source: fallback?.source } : {}),
    });
    if (!isPreviewMode) {
      postQuizSession({
        quizId,
        sessionId,
        outcomeId: resultNodeId,
        answerIds,
        productIds: shownIds,
      });
    }
    // The guard ref makes this fire exactly once; array identities may churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, completed, resultNodeId, startedAt, isPreviewMode, quizId, sessionId]);

  // §9.3 — display + auto-apply an EXISTING merchant-created code. Auto-apply
  // rides the cart permalink's discount param; manual codes display only.
  const incentiveActive = Boolean(cfg.incentiveOn && cfg.incentiveCode);
  const discountCode =
    incentiveActive && cfg.incentiveAutoApply ? cfg.incentiveCode : undefined;
  const incentiveChip = incentiveActive ? (
    <div
      style={{
        marginTop: 16,
        padding: "10px 14px",
        borderRadius: "var(--qz-radius)",
        background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
        color: "var(--qz-color-text)",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {tc(cfg.incentiveAutoApply ? "incentive_code_auto" : "incentive_code_manual", {
        code: cfg.incentiveCode!,
      })}
    </div>
  ) : null;

  const gridStyle: React.CSSProperties = minimal
    ? {
        marginTop: 20,
        display: "grid",
        gap: 16,
        gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
      }
    : { marginTop: 20, ...styles.productGrid };

  const card = (p: RecommendedProduct, position: number, extra?: Record<string, unknown>) => (
    <ProductCard
      key={p.product_id}
      product={p}
      position={position}
      vertical={minimal}
      ctaLabel={tc("shop_now")}
      href={productHref(p, shopDomain, platform)}
      shopDomain={shopDomain}
      discountCode={discountCode}
      showDescriptions={cfg.showDesc}
      quizId={quizId}
      sessionId={sessionId}
      styles={styles}
      onClick={() =>
        analytics?.track("recommendation_clicked", {
          product_id: p.product_id,
          position,
          ...extra,
        })
      }
      onAdd={() =>
        analytics?.track("add_to_cart", {
          product_id: p.product_id,
          position,
          ...extra,
        })
      }
    />
  );

  return (
    <div style={styles.card}>
      {cfg.incentivePos === "banner" ? incentiveChip : null}
      <h2 style={styles.h2}>{cfg.headline}</h2>
      {cfg.whyOn && cfg.whyCopy.trim() ? (
        <p style={{ ...styles.muted, marginTop: 8 }}>{cfg.whyCopy}</p>
      ) : null}
      {cfg.incentivePos === "below-headline" ? incentiveChip : null}
      {decider.allOutOfStock ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--qz-color-muted)" }}>
          {tc("all_out_of_stock")}
        </p>
      ) : null}
      {showFallback ? (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--qz-color-muted)" }}>
          {tc("decider_fallback_heading")}
        </p>
      ) : null}
      {!hero && grid.length === 0 && !showFallback ? (
        <p style={{ marginTop: 16, color: "var(--qz-color-muted)" }}>
          {tc("no_results_match")}
        </p>
      ) : null}
      {hero ? (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: "inline-block",
              marginBottom: 8,
              padding: "3px 12px",
              borderRadius: 999,
              background: "var(--qz-color-primary)",
              color: "var(--qz-color-bg)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {tc("decider_hero_badge")}
          </div>
          {card(hero, 0, { hero: true })}
        </div>
      ) : null}
      {grid.length > 0 ? (
        <div style={gridStyle}>{grid.map((p, i) => card(p, i + (hero ? 1 : 0)))}</div>
      ) : null}
      {showFallback ? (
        <div style={gridStyle}>
          {fallbackRecs.map((p, i) => card(p, i, { source: fallback!.source }))}
        </div>
      ) : null}
      {cfg.incentivePos === "bottom" ? incentiveChip : null}
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
        {tc("start_over")}
      </button>
      <SaveResultsLink quizId={quizId} sessionId={sessionId} />
      <BuddyRow
        quizId={quizId}
        sessionId={sessionId}
        buddySessionId={buddySessionId}
        analytics={analytics}
      />
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
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  if (recs.length === 0) {
    return (
      <p
        style={{
          color: "var(--qz-color-muted)",
          fontSize: 13,
          margin: 0,
        }}
      >
        {tc("pick_more_answers")}
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {recs.map((r, idx) => {
        const href = productHref(r, shopDomain, platform);
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
                  {formatMoney(r.price, currency, locale)}
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
        // QD-7 — standalone has no Shopify cart; the mid-quiz "Add" chip is
        // gated off (the card still links to the merchant PDP via `href`).
        // Also gate off when sold out: a /cart permalink for an OOS variant adds
        // nothing under Shopify's default continue-selling=off.
        const cartUrl =
          platform === "standalone" || r.inventory_in_stock === false
            ? null
            : cartPermalink(shopDomain, r.default_variant_id, 1);
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
  onInspect,
  inspectedTarget,
  qImgPos,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  qImgPos?: "none" | "top" | "side";
}) {
  const tc = useChrome();
  const insp = (part: InspectPart, answerId?: string) =>
    inspectAttrs(onInspect, inspectedTarget, {
      nodeId: node.id,
      part,
      ...(answerId ? { answerId } : {}),
    });
  const [sel, setSel] = useState("");
  const answer = node.data.answers.find((a) => a.id === sel);
  return (
    <div style={styles.card}>
      <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          aria-label={node.data.text}
          style={styles.selectInput}
        >
          <option value="">{tc("choose")}</option>
          {node.data.answers.map((a) => (
            <option key={a.id} value={a.id}>
              {answerLabel(a)}
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
  inspectProps,
}: {
  text: string;
  styles: ReturnType<typeof stylesFor>;
  inspectProps?: React.HTMLAttributes<HTMLElement>;
}) {
  return (
    <div
      style={{
        ...styles.card,
        borderLeft: "4px solid var(--qz-color-primary)",
        marginBottom: 12,
      }}
      {...(inspectProps ?? {})}
    >
      <div className="qz-dim" style={{ fontSize: 13, lineHeight: 1.5 }}>💡 {text}</div>
    </div>
  );
}

// "Save my results" (BIC P6): links to the public My Results page keyed by the
// unguessable session token — cross-device, survives the tab closing. Live
// only: preview sessions never write a QuizSession row, so the page would 404.
function SaveResultsLink({ quizId, sessionId }: { quizId?: string; sessionId?: string }) {
  const tc = useChrome();
  const locale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  if (isPreviewMode || !quizId || !sessionId) return null;
  return (
    <a
      href={`/q/${quizId}/results?session_id=${encodeURIComponent(sessionId)}${locale !== "en" ? `&locale=${encodeURIComponent(locale)}` : ""}`}
      style={{
        display: "inline-block",
        marginTop: 14,
        fontSize: 13,
        color: "var(--qz-color-muted)",
        textDecorationLine: "underline",
        textUnderlineOffset: 3,
      }}
    >
      {tc("save_results_link")}
    </a>
  );
}

// Spec §6 "Share results button" — native share where available, copy-link
// everywhere else, of the shopper's persistent results URL (reconstructed
// server-side from the saved session). Live-only, like SaveResultsLink.
function ShareResultsButton({ quizId, sessionId }: { quizId?: string; sessionId?: string }) {
  const tc = useChrome();
  const locale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [copied, setCopied] = useState(false);
  if (isPreviewMode || !quizId || !sessionId) return null;
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/q/${quizId}/results?session_id=${encodeURIComponent(sessionId)}${locale !== "en" ? `&locale=${encodeURIComponent(locale)}` : ""}`;
  return (
    <button
      type="button"
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ url });
            return;
          } catch {
            // dismissed — fall through to copy
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard blocked — no-op
        }
      }}
      style={{
        display: "block",
        margin: "12px auto 0",
        font: "inherit",
        fontSize: 13,
        padding: "6px 14px",
        borderRadius: "var(--qz-radius)",
        border: "1px solid var(--qz-color-primary)",
        background: "transparent",
        color: "var(--qz-color-primary)",
        cursor: "pointer",
      }}
    >
      {copied ? tc("share_copied") : tc("share_results_cta")}
    </button>
  );
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Spec §5 "Notify Me" — inline back-in-stock email capture shown in place of
// the add-to-cart CTA on an out-of-stock card (and as a section-level prompt
// when everything is sold out). Posts to /q/:id/notify. Preview = no POST.
function NotifyMeForm({
  quizId,
  sessionId,
  productId,
  compact = false,
}: {
  quizId?: string;
  sessionId?: string;
  productId?: string | null;
  compact?: boolean;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  if (state === "done") {
    return (
      <div style={{ fontSize: 13, color: "var(--qz-color-muted)" }}>{tc("notify_done")}</div>
    );
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!EMAIL_RE.test(email)) return;
        setState("sending");
        if (isPreviewMode || !quizId) {
          setState("done");
          return;
        }
        try {
          await fetch(`/q/${quizId}/notify`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, product_id: productId ?? null, session_id: sessionId ?? null }),
          });
        } catch {
          // best-effort — still confirm so the shopper isn't stuck
        }
        setState("done");
      }}
      style={{ display: "flex", gap: 6, flexDirection: compact ? "column" : "row", alignItems: "stretch" }}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(ev) => setEmail(ev.target.value)}
        placeholder={tc("notify_email_placeholder")}
        aria-label={tc("notify_email_placeholder")}
        style={{
          font: "inherit",
          fontSize: 13,
          padding: "6px 10px",
          borderRadius: "var(--qz-radius)",
          border: "1px solid #00000022",
          minWidth: 0,
          flex: 1,
        }}
      />
      <button
        type="submit"
        disabled={state === "sending"}
        style={{
          font: "inherit",
          fontSize: 13,
          padding: "6px 14px",
          borderRadius: "var(--qz-radius)",
          border: "1px solid var(--qz-color-primary)",
          background: "var(--qz-color-primary)",
          color: "#fff",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {tc("notify_me")}
      </button>
    </form>
  );
}

// Answer label with the optional emoji icon prefix (editor revamp P3 —
// Answer.icon, set via the InspectorPanel's icon picker or the AI's
// set_answer_icon op). Absent icon → just the text, unchanged.
// Buddy mode (Phase L2): invite a friend (share/copy a ?buddy= link carrying
// MY session) and, when I arrived via someone's link, the comparison CTA.
// Live-only, like SaveResultsLink. buddy_completed fires once on render of
// the compare link (the friend finished an invited run).
function BuddyRow({
  quizId,
  sessionId,
  buddySessionId,
  analytics,
}: {
  quizId?: string;
  sessionId?: string;
  buddySessionId?: string | null;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
}) {
  const tc = useChrome();
  const locale = useContext(RuntimeLocaleContext);
  const isPreviewMode = useContext(RuntimePreviewContext);
  const [copied, setCopied] = useState(false);
  const completedFired = useRef(false);
  useEffect(() => {
    if (buddySessionId && sessionId && !isPreviewMode && !completedFired.current) {
      completedFired.current = true;
      analytics?.track("buddy_completed", { inviter_session: buddySessionId });
    }
  }, [buddySessionId, sessionId, isPreviewMode, analytics]);
  if (isPreviewMode || !quizId || !sessionId) return null;
  const localeQ = locale !== "en" ? `&locale=${encodeURIComponent(locale)}` : "";
  const inviteUrl = `${window.location.origin}/q/${quizId}?buddy=${encodeURIComponent(sessionId)}${localeQ.replace("&", "&")}`;
  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      {buddySessionId ? (
        <a
          href={`/q/${quizId}/compare?a=${encodeURIComponent(buddySessionId)}&b=${encodeURIComponent(sessionId)}${localeQ}`}
          style={{ fontSize: 14, fontWeight: 600, color: "inherit" }}
        >
          {tc("see_comparison")}
        </a>
      ) : null}
      <button
        type="button"
        onClick={async () => {
          analytics?.track("buddy_invited", {});
          if (navigator.share) {
            try {
              await navigator.share({ url: inviteUrl });
              return;
            } catch {
              // dismissed — fall through to copy
            }
          }
          try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            // clipboard blocked — nothing else to do
          }
        }}
        style={{
          font: "inherit",
          fontSize: 13,
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid currentColor",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          opacity: 0.85,
        }}
      >
        {copied ? tc("invite_copied") : tc("invite_friend")}
      </button>
    </div>
  );
}

function answerLabel(a: { icon?: string; text: string }): string {
  return a.icon ? `${a.icon} ${a.text}` : a.text;
}

// An answer's label plus an optional always-visible helper caption
// (Answer.tooltip_text, baked at publish — Dev Spec §4.1) that explains the
// option's tradeoff in plain English. Always-visible rather than a hover/click
// popover because answer options are themselves <button>/<label> elements: a
// nested interactive tooltip would be invalid markup and unreliable on touch.
// A revealable info tooltip for an answer option (Answer.tooltip_text, baked at
// publish — Dev Spec §4.1/§8). The ⓘ chip is a SIBLING of the answer control,
// never nested inside the <button>/<label> (which would be invalid markup and
// unreliable on touch); it's absolutely positioned in the card corner, and its
// onClick stops propagation so revealing the tooltip never selects the answer.
// Fires tooltip_viewed once, on first reveal.
function TooltipChip({ text, onReveal }: { text: string; onReveal: () => void }) {
  const tc = useChrome();
  const [open, setOpen] = useState(false);
  const seenRef = useRef(false);
  return (
    <span style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
      <button
        type="button"
        aria-label={tc("aria_more_info")}
        aria-expanded={open}
        onKeyDown={(e) => {
          // WAI-ARIA tooltip pattern: Escape dismisses (focus stays on the chip).
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => {
            if (!o && !seenRef.current) {
              seenRef.current = true;
              onReveal();
            }
            return !o;
          });
        }}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "1px solid #00000033",
          background: "var(--qz-color-bg, #fff)",
          color: "var(--qz-color-muted, #777)",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: "italic",
          fontSize: 13,
          lineHeight: 1,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        i
      </button>
      {open ? (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: 27,
            right: 0,
            width: 220,
            maxWidth: "70vw",
            zIndex: 5,
            background: "var(--qz-color-text, #1b1a17)",
            color: "var(--qz-color-bg, #fff)",
            fontSize: 12.5,
            fontWeight: 400,
            lineHeight: 1.4,
            padding: "8px 11px",
            borderRadius: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
            textAlign: "left",
          }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

// MQ — the minimal chrome's bottom Back/Next nav row (Quizell). Back is an
// outline pill (hidden, not removed, on the first question so layout is stable);
// Next is a solid pill that commits the pending selection.
// B6 — a "Skip" affordance for OPTIONAL questions (node.data.required === false).
// Mirrors the email-gate's two chrome styles; advances via the default next step
// with no answer recorded (onAdvance([], null)), which the engine resolves to the
// unconditional fallback edge (empty selectedAnswerIds contribute no tags).
function SkipLink({ minimal, onSkip, label }: { minimal: boolean; onSkip: () => void; label: string }) {
  return (
    <div style={{ textAlign: "center", marginTop: minimal ? 20 : 0 }}>
      <button
        type="button"
        onClick={onSkip}
        style={
          minimal
            ? {
                background: "none",
                border: "none",
                color: "var(--qz-color-text)",
                fontWeight: 700,
                fontSize: "var(--qz-base-size)",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
                fontFamily: "var(--qz-font-body)",
              }
            : {
                background: "none",
                border: "none",
                color: "var(--qz-color-muted)",
                fontSize: 14,
                cursor: "pointer",
                marginTop: 12,
                padding: 0,
              }
        }
      >
        {label}
      </button>
    </div>
  );
}

function MinimalNav({
  onBack,
  canBack,
  onNext,
  nextEnabled,
}: {
  onBack?: () => void;
  canBack?: boolean;
  onNext: () => void;
  nextEnabled: boolean;
}) {
  const tc = useChrome();
  return (
    <div
      style={{
        marginTop: 34,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
      }}
    >
      <button
        type="button"
        onClick={onBack}
        disabled={!canBack}
        style={{
          visibility: canBack ? "visible" : "hidden",
          background: "transparent",
          border: "1.5px solid var(--qz-color-text)",
          color: "var(--qz-color-text)",
          borderRadius: "var(--qz-radius)",
          padding: "calc(var(--qz-pad) * 0.5) calc(var(--qz-pad) * 1.1)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          fontWeight: 600,
          cursor: canBack ? "pointer" : "default",
        }}
      >
        {tc("back")}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!nextEnabled}
        style={{
          background: "var(--qz-color-text)",
          color: "var(--qz-color-bg)",
          border: "1.5px solid var(--qz-color-text)",
          borderRadius: "var(--qz-radius)",
          padding: "calc(var(--qz-pad) * 0.5) calc(var(--qz-pad) * 1.5)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          fontWeight: 600,
          cursor: nextEnabled ? "pointer" : "default",
          opacity: nextEnabled ? 1 : 0.45,
        }}
      >
        {tc("next")}
      </button>
    </div>
  );
}

function QuestionView({
  node,
  onAdvance,
  onBack,
  canBack,
  styles,
  tokens,
  onTooltipView,
  onInspect,
  inspectedTarget,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  onBack?: () => void;
  canBack?: boolean;
  styles: ReturnType<typeof stylesFor>;
  tokens: DesignTokensT;
  onTooltipView?: (answerId: string) => void;
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
}) {
  // MQ — minimal chrome turns single-select into select-then-Next (a pending
  // pick highlights; an explicit Next commits) + a Back/Next nav row. Classic
  // keeps tap-to-advance. `minimal` gates every branch below.
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  const tc = useChrome();
  // B6 — optional questions get a "Skip" affordance (advances with no answer).
  const skipLink =
    node.data.required === false ? (
      <SkipLink minimal={minimal} onSkip={() => onAdvance([], null)} label={tc("skip")} />
    ) : null;
  const [picked, setPicked] = useState<string | null>(null);
  const insp = (part: InspectPart, answerId?: string) =>
    inspectAttrs(onInspect, inspectedTarget, {
      nodeId: node.id,
      part,
      ...(answerId ? { answerId } : {}),
    });
  // Explicit answer-column override (editor revamp P3). Unset keeps the
  // responsive default from stylesFor (2-up desktop, 1-up mobile).
  // §4 question image position (top default / side / none) — drives QuestionImage.
  // Image-density renderer (owner-activated): a Minimal-leaning density hides
  // decorative question header images across all 8 question renderers; answer
  // images (image_tile/image_picker/swatch) are FUNCTIONAL and never gated,
  // and an EXPLICIT position token beats the gate (questionImagePosition).
  const qImgPos = questionImagePosition(
    tokens.style_bar?.image_density,
    tokens.question_image_position,
  );
  const answerGrid = {
    ...(node.data.answer_columns
      ? {
          ...styles.answerGrid,
          gridTemplateColumns: `repeat(${node.data.answer_columns}, minmax(0, 1fr))`,
        }
      : styles.answerGrid),
    // §4 side image: the answer grid is a BFC, so clear the float and sit below
    // the floated image (the question text wraps beside it). No-op otherwise.
    ...(qImgPos === "side" ? { clear: "both" as const } : {}),
  };
  // B6 — scale config (range + endpoint labels). Falls back to today's defaults
  // so an unset quiz renders byte-identically.
  const sc = node.data.scale_config;
  const sliderMin = sc?.min ?? 0;
  const sliderMax = sc?.max ?? 100;
  const sliderMid = String(Math.round((sliderMin + sliderMax) / 2));
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // Slider defaults to its midpoint so it's immediately submittable + shows a value.
  const [freeform, setFreeform] = useState(
    node.data.question_type === "slider" ? sliderMid : "",
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
        <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
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
                aria-label={node.data.text}
                min={sliderMin}
                max={sliderMax}
                step={sc?.step}
                value={freeform || sliderMid}
                onChange={(e) => setFreeform(e.target.value)}
                style={{ width: "100%", cursor: "pointer", accentColor: "var(--qz-color-primary)" }}
              />
              {sc?.endpoint_label_min || sc?.endpoint_label_max ? (
                <div style={{ ...styles.muted, display: "flex", justifyContent: "space-between", fontSize: "0.8em" }}>
                  <span>{sc?.endpoint_label_min ?? sliderMin}</span>
                  <span>{sc?.endpoint_label_max ?? sliderMax}</span>
                </div>
              ) : null}
              <div style={{ textAlign: "center", fontWeight: 600, fontSize: 18 }}>
                {freeform || sliderMid}
              </div>
            </div>
          ) : (
            <input
              type={inputType}
              aria-label={node.data.text}
              value={freeform}
              onChange={(e) => setFreeform(e.target.value.slice(0, maxLength))}
              placeholder={placeholder}
              maxLength={maxLength}
              {...(node.data.question_type === "numeric"
                ? { min: sc?.min, max: sc?.max, step: sc?.step }
                : {})}
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
        <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
        <div style={answerGrid}>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ position: "relative" }}>
              <label
                style={{
                  ...styles.answerBtn,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  borderColor: checked[a.id]
                    ? "var(--qz-color-primary)"
                    : "#00000022",
                }}
                {...insp("answer", a.id)}
              >
                <input
                  type="checkbox"
                  checked={!!checked[a.id]}
                  onChange={(e) =>
                    setChecked({ ...checked, [a.id]: e.target.checked })
                  }
                />
                {answerLabel(a)}
              </label>
              {a.tooltip_text ? (
                <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
              ) : null}
            </div>
          ))}
        </div>
        {minimal ? (
          <MinimalNav
            onBack={onBack}
            canBack={canBack}
            onNext={() => {
              const first = node.data.answers.find((a) => checked[a.id]);
              onAdvance(selectedIds, first ? first.edge_handle_id : null);
            }}
            nextEnabled={selectedIds.length > 0 && !tooMany && !tooFew}
          />
        ) : (
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
        )}
        {skipLink}
      </div>
    );
  }

  // Searchable: same single-select semantics, but with a top search input
  // that substring-filters the answer list. Useful for long pickers (brand,
  // country, etc.) where scrolling 50+ buttons would be annoying.
  if (node.data.question_type === "searchable") {
    return (
      <SearchableQuestion
        node={node}
        onAdvance={onAdvance}
        styles={styles}
        onInspect={onInspect}
        inspectedTarget={inspectedTarget}
        qImgPos={qImgPos}
      />
    );
  }

  // ImagePicker: dense thumbnail grid. Each answer's image dominates with a
  // small caption underneath. Visual-first picking — like "which of these
  // styles feels right?".
  if (node.data.question_type === "image_picker") {
    return (
      <div style={styles.card}>
        <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
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
              {...insp("answer", a.id)}
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
              <span style={{ fontSize: 12 }}>{answerLabel(a)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Dropdown: a compact <select> for long single-choice lists.
  if (node.data.question_type === "dropdown") {
    return (
      <DropdownQuestion
        node={node}
        onAdvance={onAdvance}
        styles={styles}
        onInspect={onInspect}
        inspectedTarget={inspectedTarget}
        qImgPos={qImgPos}
      />
    );
  }

  // Rating / Likert scale: a single-select rendered as a compact horizontal row.
  if (node.data.question_type === "rating") {
    return (
      <div style={styles.card}>
        <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
        <div
          role="group"
          aria-label={node.data.text}
          style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {sc?.endpoint_label_min ? (
            <span style={{ ...styles.muted, fontSize: "0.8em", alignSelf: "center", flex: "0 0 auto" }}>
              {sc.endpoint_label_min}
            </span>
          ) : null}
          {node.data.answers.map((a) => (
            <div
              key={a.id}
              style={{ position: "relative", flex: "1 1 auto", minWidth: 56, display: "flex" }}
            >
              <button
                title={a.tooltip_text ?? a.text}
                style={{ ...styles.answerBtn, flex: 1, minWidth: 0, textAlign: "center" }}
                {...insp("answer", a.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--qz-color-primary)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#00000022";
                }}
                onClick={() => onAdvance([a.id], a.edge_handle_id)}
              >
                {answerLabel(a)}
              </button>
              {a.tooltip_text ? (
                <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Swatch picker: single-select rendered as circular colour / material swatches.
  if (node.data.question_type === "swatch") {
    return (
      <div style={styles.card}>
        <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
        <div style={{ marginTop: 20, display: "flex", gap: 14, flexWrap: "wrap" }}>
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ position: "relative" }}>
              <button
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
                {...insp("answer", a.id)}
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
                <span style={{ fontSize: 12, textAlign: "center" }}>{answerLabel(a)}</span>
              </button>
              {a.tooltip_text ? (
                <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // single_select / image_tile (default fall-through)
  const commitPicked = () => {
    const a = node.data.answers.find((x) => x.id === picked);
    if (a) onAdvance([a.id], a.edge_handle_id);
  };
  return (
    <div style={styles.card}>
      <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
      <div style={answerGrid}>
        {node.data.answers.map((a) => {
          const isPicked = minimal && picked === a.id;
          return (
          <div key={a.id} style={{ position: "relative" }}>
          <button
            style={
              isPicked
                ? { ...styles.answerBtn, boxShadow: "inset 0 0 0 2px var(--qz-color-text)" }
                : styles.answerBtn
            }
            {...insp("answer", a.id)}
            onMouseEnter={
              minimal
                ? undefined
                : (e) => {
                    e.currentTarget.style.borderColor = "var(--qz-color-primary)";
                  }
            }
            onMouseLeave={
              minimal
                ? undefined
                : (e) => {
                    e.currentTarget.style.borderColor = "#00000022";
                  }
            }
            // Minimal: tap selects (pending) then Next commits; classic auto-advances.
            onClick={() => (minimal ? setPicked(a.id) : onAdvance([a.id], a.edge_handle_id))}
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
            {answerLabel(a)}
          </button>
          {a.tooltip_text ? (
            <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
          ) : null}
          </div>
          );
        })}
      </div>
      {minimal ? (
        <MinimalNav
          onBack={onBack}
          canBack={canBack}
          onNext={commitPicked}
          nextEnabled={picked !== null}
        />
      ) : null}
      {skipLink}
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
  onInspect,
  inspectedTarget,
  qImgPos,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "question" }>;
  onAdvance: (answerIds: string[], handle: string | null) => void;
  styles: ReturnType<typeof stylesFor>;
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  qImgPos?: "none" | "top" | "side";
}) {
  const tc = useChrome();
  const insp = (part: InspectPart, answerId?: string) =>
    inspectAttrs(onInspect, inspectedTarget, {
      nodeId: node.id,
      part,
      ...(answerId ? { answerId } : {}),
    });
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? node.data.answers.filter((a) => a.text.toLowerCase().includes(needle))
    : node.data.answers;
  return (
    <div style={styles.card}>
      <QuestionImage url={node.data.image_url} position={qImgPos} />
      <h2 style={styles.h2} {...insp("question_text")}>{node.data.text}</h2>
      {node.data.helper_text ? (
        <p style={{ ...styles.muted, fontSize: "0.85em", marginTop: -6 }}>{node.data.helper_text}</p>
      ) : null}
      <input
        type="text"
        aria-label={node.data.text}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={tc("search_placeholder")}
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
              {answerLabel(a)}
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
  onBack,
  canBack,
  inspect,
}: {
  node: Extract<QuizDoc["nodes"][number], { type: "email_gate" }>;
  styles: ReturnType<typeof stylesFor>;
  quizId: string;
  sessionId: string;
  onSubmit: (contact?: { email?: string; name?: string; phone?: string }) => void;
  onBack?: () => void;
  canBack?: boolean;
  inspect?: (part: InspectPart) => React.HTMLAttributes<HTMLElement>;
}) {
  const tc = useChrome();
  const minimal = useContext(RuntimeChromeContext) === "minimal";
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
    padding: minimal ? "15px 16px" : "12px 14px",
    borderRadius: "var(--qz-radius)",
    border: minimal
      ? "1.5px solid color-mix(in srgb, var(--qz-color-text) 22%, transparent)"
      : "1px solid #00000022",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    ...(minimal ? { textAlign: "left" as const, background: "var(--qz-color-bg)" } : {}),
  };
  return (
    <div style={styles.card}>
      <h2 style={styles.h2} {...(inspect?.("email_headline") ?? {})}>{node.data.headline}</h2>
      {node.data.subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("email_subtext") ?? {})}>
          {node.data.subtext}
        </p>
      )}
      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        <input
          type="email"
          aria-label={tc("gate_email_placeholder")}
          placeholder={tc("gate_email_placeholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        {node.data.name_optional && (
          <input
            type="text"
            aria-label={tc("gate_name_placeholder")}
            placeholder={tc("gate_name_placeholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        {node.data.collect_phone && (
          <input
            type="tel"
            aria-label={tc("gate_phone_placeholder")}
            placeholder={tc("gate_phone_placeholder")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={inputStyle}
          />
        )}
      </div>
      {minimal ? (
        <>
          {node.data.skip_allowed && (
            <div style={{ textAlign: "center", marginTop: 24 }}>
              <button
                onClick={() => onSubmit()}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--qz-color-text)",
                  fontWeight: 700,
                  fontSize: "var(--qz-base-size)",
                  textDecoration: "underline",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "var(--qz-font-body)",
                }}
              >
                {tc("skip")}
              </button>
            </div>
          )}
          <MinimalNav
            onBack={onBack}
            canBack={canBack}
            onNext={handleSubmit}
            nextEnabled={valid && !submitting}
          />
        </>
      ) : (
        <>
          <button
            style={{ ...styles.primaryBtn, opacity: valid && !submitting ? 1 : 0.5 }}
            disabled={!valid || submitting}
            onClick={handleSubmit}
          >
            {submitting ? "…" : tc("continue")}
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
              {tc("skip")}
            </button>
          )}
        </>
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
  inspect,
}: {
  node: Extract<
    QuizDoc["nodes"][number],
    { type: "ask_ai" }
  >;
  quizId: string;
  path: PathStep[];
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
  inspect?: (part: InspectPart) => React.HTMLAttributes<HTMLElement>;
}) {
  const tc = useChrome();
  const chatLocale = useContext(RuntimeLocaleContext);
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
          content: tc("chat_preview_stub"),
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
          locale: chatLocale,
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
      setError(err instanceof Error ? err.message : tc("network_error"));
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
        <h2 style={{ ...styles.h2, margin: 0 }} {...(inspect?.("askai_persona") ?? {})}>
          {node.data.persona_name}
        </h2>
        <span
          style={{
            fontSize: 11,
            color: "var(--qz-color-muted)",
            fontFamily: "monospace",
          }}
        >
          {turnsRemaining > 0
            ? `${turnsRemaining} turn${turnsRemaining === 1 ? "" : "s"} left`
            : tc("chat_ended")}
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
          aria-label={tc("chat_placeholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={sending || turnsRemaining <= 0}
          placeholder={turnsRemaining > 0 ? tc("chat_placeholder") : tc("chat_ended")}
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
          {tc("send")}
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
  sessionId,
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
  sessionId?: string;
  path: PathStep[];
  contact?: { email?: string; name?: string; phone?: string };
  styles: ReturnType<typeof stylesFor>;
  onDone: () => void;
}) {
  const tc = useChrome();
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
            ...(sessionId ? { session_id: sessionId } : {}),
            ...(contact?.email ? { email: contact.email } : {}),
            ...(contact?.name ? { name: contact.name } : {}),
            ...(contact?.phone ? { phone: contact.phone } : {}),
          }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          if (!node.data.continue_on_error) {
            setError(body.error ?? tc("integration_failed"));
            return;
          }
        }
        onDone();
      } catch (err) {
        if (cancelled) return;
        if (!node.data.continue_on_error) {
          setError(err instanceof Error ? err.message : tc("network_error"));
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
      <h2 style={styles.h2}>{error ? tc("something_went_wrong") : tc("saving")}</h2>
      {error ? (
        <>
          <p style={styles.muted}>{error}</p>
          <button style={styles.primaryBtn} onClick={onDone}>
            Continue anyway
          </button>
        </>
      ) : (
        <p style={styles.muted}>{tc("sending_answers")}</p>
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
  inspect,
}: {
  node: Extract<
    QuizDoc["nodes"][number],
    { type: "product_cards" }
  >;
  productIndex: IndexedProduct[];
  shopDomain: string;
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
  inspect?: (part: InspectPart) => React.HTMLAttributes<HTMLElement>;
}) {
  const tc = useChrome();
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  const products = node.data.product_ids
    .map((id) => productIndex.find((p) => p.product_id === id))
    .filter((p): p is IndexedProduct => !!p);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2} {...(inspect?.("pc_headline") ?? {})}>{node.data.headline}</h2>
      {node.data.subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("pc_subtext") ?? {})}>
          {node.data.subtext}
        </p>
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
            href={productHref(p, shopDomain, platform) ?? `#${p.handle}`}
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
                {formatMoney(p.price, currency, locale)}
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
            {tc("no_products_configured")}
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

// Persist a server-side QuizSession on completion (Dev Spec §7.2). Fire-and-
// forget; a failure never affects the shopper. The caller preview-gates this.
function postQuizSession(args: {
  quizId?: string;
  sessionId?: string;
  outcomeId: string;
  answerIds: string[];
  productIds: string[];
}) {
  if (!args.quizId || !args.sessionId) return;
  void fetch("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quiz_id: args.quizId,
      session_id: args.sessionId,
      outcome_id: args.outcomeId,
      answer_ids: args.answerIds,
      matched_product_ids: args.productIds,
    }),
    keepalive: true,
  }).catch(() => {});
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
  const tc = useChrome();
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
        {tc("email_capture_thanks")}
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
      <div style={{ fontWeight: 600, marginBottom: 10 }}>{tc("email_capture_heading")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          type="email"
          aria-label={tc("email_placeholder")}
          placeholder={tc("email_placeholder")}
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
          {submitting ? tc("email_capture_sending") : tc("email_capture_button")}
        </button>
      </div>
    </form>
  );
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

function ResultView({
  headline,
  subtext,
  ctaLabel,
  recs,
  secondary,
  quizId,
  sessionId,
  collectEmail,
  answerIds,
  resultNodeId,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  startedAt,
  completed,
  analytics,
  buddySessionId,
  onReset,
  bare,
  whyBullets,
  inspect,
  splitLayout,
  reasonsByProduct,
  escapeHatch,
  showVariants = false,
  showDescriptions = false,
  lowStockByProduct,
  resultsSummaryBar = false,
  answerSummary,
  retakeLink = false,
  shareResults = false,
  oosNotify = false,
  whyIntro,
  blurbByProduct,
  globalFallback,
  heroLogic,
  heroOos,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  // Spec §5 — result page's OOS behavior is "notify_me": sold-out cards get a
  // back-in-stock capture, and a section prompt shows when ALL recs are OOS.
  oosNotify?: boolean;
  // Spec §3 Mode A — token-resolved page-intro copy, rendered above sections.
  whyIntro?: string;
  // Spec §3 Mode B — product_id → token-resolved per-product blurb.
  blurbByProduct?: Map<string, string> | null;
  // Rec-Page spec §2/§6 display + structure toggles, threaded from the result node.
  showVariants?: boolean;
  showDescriptions?: boolean;
  // product_id → live stock qty (≤ threshold), populated by the urgency fetch.
  lowStockByProduct?: Map<string, number> | null;
  resultsSummaryBar?: boolean;
  // Shopper's picked answer labels for the summary bar ("Oily skin · Sensitive").
  answerSummary?: string[];
  retakeLink?: boolean;
  // Spec §6 share button (uses the persistent results URL).
  shareResults?: boolean;
  inspect?: (part: "result_headline" | "result_subtext") => React.HTMLAttributes<HTMLElement>;
  // BIC P8: 2-column desktop layout (pitch left, vertical cards right). The
  // call site gates it on tokens.result_split && desktop; absent = stacked.
  splitLayout?: boolean;
  recs: RecommendedProduct[];
  secondary?: RecommendedProduct[];
  quizId?: string;
  sessionId?: string;
  collectEmail?: boolean;
  answerIds?: string[];
  resultNodeId: string;
  shopDomain?: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  buddySessionId?: string | null;
  onReset: () => void;
  // When true, render just the products + "Start over" (no card / heading) so a
  // `recommendations` content-block can place it inside a custom layout.
  bare?: boolean;
  whyBullets?: string[];
  reasonsByProduct?: Map<string, string[]> | null;
  escapeHatch?: { label: string; url: string } | null;
  // Rec-Page spec §7 — quiz-level no-bucket-match fallback, computed at the call
  // site (resolveGlobalFallbackProducts). Rendered ONLY when recs is empty.
  globalFallback?: { heading: string; products: RecommendedProduct[] } | null;
  // step4-dev-handoff §6 — feature the top product as a HERO card above the grid.
  // Unset (the default) = no hero = today's grid (byte-stable). Only "match" renders
  // for now (reviewed/seller are config-gated until review/sales data exists).
  heroLogic?: "match" | "reviewed" | "seller";
  heroOos?: "next" | "grid";
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  // MQ — minimal chrome shows recommendations as a row of vertical cards
  // (Quizell): auto-fit fills 1–3 columns by available width.
  const minimal = useContext(RuntimeChromeContext) === "minimal";
  // Fire completion + view events once when the result first renders, and
  // persist the server-side session (Dev Spec §7.2) — but never in preview.
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
    if (!isPreviewMode) {
      postQuizSession({
        quizId,
        sessionId,
        outcomeId: resultNodeId,
        answerIds: answerIds ?? [],
        productIds: [...recs, ...(secondary ?? [])].map((r) => r.product_id),
      });
    }
  }, [
    analytics,
    completed,
    resultNodeId,
    startedAt,
    recs,
    secondary,
    isPreviewMode,
    quizId,
    sessionId,
    answerIds,
  ]);

  // step4-dev-handoff §6 — when hero_logic is set, feature the top product as a
  // hero card above the grid. Scoped to the STANDARD single-section grid (not the
  // split/minimal layouts, which own their structure) so the change is bounded;
  // unset → heroActive false → recs renders exactly as today (byte-stable).
  const heroActive = !!heroLogic && !splitLayout && !minimal;
  const heroSplit = heroActive ? selectHeroAndGrid(recs, heroOos ?? "next") : null;
  const heroProduct = heroSplit?.hero ?? null;
  const gridRecs = heroProduct ? heroSplit!.grid : recs;

  const inner = (
    <>
      {resultsSummaryBar && answerSummary && answerSummary.length > 0 ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--qz-color-muted, #888)" }}>
            {tc("your_answers")}:
          </span>
          {answerSummary.map((label, i) => (
            <span
              key={`${label}-${i}`}
              style={{
                fontSize: 12,
                padding: "2px 10px",
                borderRadius: 999,
                background: "color-mix(in srgb, var(--qz-color-primary) 10%, transparent)",
              }}
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}
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
      {whyIntro && whyIntro.trim() ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            padding: "12px 14px",
            borderRadius: "var(--qz-radius)",
            background: "color-mix(in srgb, var(--qz-color-primary) 6%, transparent)",
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {whyIntro}
        </div>
      ) : null}
      {oosNotify && recs.length > 0 && recs.every((r) => !r.inventory_in_stock) ? (
        <div
          style={{
            marginTop: bare ? 0 : 16,
            padding: "12px 14px",
            borderRadius: "var(--qz-radius)",
            background: "color-mix(in srgb, var(--qz-color-primary) 8%, transparent)",
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 8 }}>{tc("notify_section_prompt")}</div>
          <NotifyMeForm quizId={quizId} sessionId={sessionId} productId={null} />
        </div>
      ) : null}
      {heroProduct ? (
        <div style={{ marginTop: bare && !discountLabel ? 0 : 20 }}>
          <div style={{ marginBottom: 8 }}>
            <span
              style={{
                display: "inline-block",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--qz-color-primary)",
                background: "color-mix(in srgb, var(--qz-color-primary) 12%, transparent)",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              ⭐ {tc("hero_badge")}
            </span>
          </div>
          <ProductCard
            product={heroProduct}
            position={0}
            ctaLabel={ctaLabel}
            href={productHref(heroProduct, shopDomain, platform)}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            showVariants={showVariants}
            showDescriptions={showDescriptions}
            lowStockQty={lowStockByProduct?.get(heroProduct.product_id) ?? null}
            oosNotify={oosNotify}
            quizId={quizId}
            sessionId={sessionId}
            blurb={blurbByProduct?.get(heroProduct.product_id)}
            reasons={reasonsByProduct?.get(heroProduct.product_id) ?? undefined}
            styles={styles}
            onClick={() =>
              analytics?.track("recommendation_clicked", {
                product_id: heroProduct.product_id,
                position: 0,
                hero: true,
              })
            }
            onAdd={() =>
              analytics?.track("add_to_cart", {
                product_id: heroProduct.product_id,
                position: 0,
                hero: true,
              })
            }
          />
        </div>
      ) : null}
      <div
        style={{
          marginTop: bare && !discountLabel ? 0 : 20,
          ...(splitLayout
            ? { display: "flex", flexDirection: "column", gap: 14 }
            : minimal
              ? {
                  display: "grid",
                  gap: 16,
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                }
              : styles.productGrid),
        }}
      >
        {/* The bucket MATCH still returns "no fit → no products" (the rule holds).
            Rec-Page §7 adds an OPT-IN quiz-level fallback: when the merchant
            enabled it, an empty result shows a curated "Our most-loved products"
            section instead of the bare no-match message. */}
        {recs.length === 0 &&
          (globalFallback && globalFallback.products.length > 0 ? (
            <div style={{ display: "contents" }}>
              <h3 style={{ ...styles.h2, gridColumn: "1 / -1", margin: "0 0 4px" }}>
                {globalFallback.heading}
              </h3>
              {globalFallback.products.map((r, idx) => (
                <ProductCard
                  key={r.product_id}
                  product={r}
                  position={idx}
                  vertical={splitLayout || minimal}
                  ctaLabel={ctaLabel}
                  href={productHref(r, shopDomain, platform)}
                  shopDomain={shopDomain}
                  showVariants={showVariants}
                  showDescriptions={showDescriptions}
                  quizId={quizId}
                  sessionId={sessionId}
                  styles={styles}
                  onClick={() =>
                    analytics?.track("recommendation_clicked", {
                      product_id: r.product_id,
                      quiz_id: quizId,
                      source: "global_fallback",
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--qz-color-muted)" }}>{tc("no_results_match")}</p>
          ))}
        {gridRecs.map((r, idx) => (
          <ProductCard
            reasons={reasonsByProduct?.get(r.product_id) ?? undefined}
            key={r.product_id}
            product={r}
            position={idx}
            vertical={splitLayout || minimal}
            ctaLabel={ctaLabel}
            href={productHref(r, shopDomain, platform)}
            shopDomain={shopDomain}
            discountCode={discountCode}
            discountLabel={discountLabel}
            showVariants={showVariants}
            showDescriptions={showDescriptions}
            lowStockQty={lowStockByProduct?.get(r.product_id) ?? null}
            oosNotify={oosNotify}
            quizId={quizId}
            sessionId={sessionId}
            blurb={blurbByProduct?.get(r.product_id)}
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
            {tc("you_might_also_like")}
          </h3>
          <div style={styles.productGrid}>
            {secondary.map((r, idx) => (
              <ProductCard
            reasons={reasonsByProduct?.get(r.product_id) ?? undefined}
                key={r.product_id}
                product={r}
                position={recs.length + idx}
                ctaLabel={ctaLabel}
                href={productHref(r, shopDomain, platform)}
                shopDomain={shopDomain}
                showVariants={showVariants}
                showDescriptions={showDescriptions}
                lowStockQty={lowStockByProduct?.get(r.product_id) ?? null}
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
        {tc("start_over")}
      </button>
      {retakeLink ? (
        <button
          type="button"
          onClick={onReset}
          style={{
            display: "block",
            margin: "10px auto 0",
            background: "none",
            border: "none",
            font: "inherit",
            fontSize: "0.85em",
            fontFamily: "var(--qz-font-body)",
            color: "var(--qz-color-muted, #888)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {tc("retake_quiz")}
        </button>
      ) : null}
      {shareResults ? <ShareResultsButton quizId={quizId} sessionId={sessionId} /> : null}
      <SaveResultsLink quizId={quizId} sessionId={sessionId} />
      <BuddyRow quizId={quizId} sessionId={sessionId} buddySessionId={buddySessionId} analytics={analytics} />
      {escapeHatch && escapeHatch.label && escapeHatch.url ? (
        <a
          href={escapeHatch.url}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "block",
            textAlign: "center",
            marginTop: 10,
            fontSize: "0.85em",
            fontFamily: "var(--qz-font-body)",
            color: "var(--qz-color-muted, #888)",
            textDecoration: "underline",
          }}
        >
          {escapeHatch.label}
        </a>
      ) : null}
    </>
  );

  if (bare) return inner;

  const pitch = (
    <>
      <h2 style={styles.resultHeadline} {...(inspect?.("result_headline") ?? {})}>{headline}</h2>
      {subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("result_subtext") ?? {})}>
          {subtext}
        </p>
      )}
      <WhyBullets bullets={whyBullets} styles={styles} />
    </>
  );
  const email =
    collectEmail && quizId && sessionId ? (
      <ResultEmailCapture
        quizId={quizId}
        sessionId={sessionId}
        styles={styles}
        analytics={analytics}
      />
    ) : null;

  // BIC P8 (opt-in via tokens.result_split, desktop only): editorial split —
  // the pitch reads like a sticky magazine column while vertical cards scroll.
  if (splitLayout) {
    return (
      <div style={{ ...styles.card, maxWidth: 1020, width: "100%" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)",
            gap: 40,
            alignItems: "start",
          }}
        >
          <div style={{ position: "sticky", top: 24 }}>
            {pitch}
            {email}
          </div>
          <div>{inner}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      {pitch}
      {inner}
      {email}
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
  answerIds,
  resultNodeId,
  shopDomain,
  discountCode,
  discountLabel,
  styles,
  startedAt,
  completed,
  analytics,
  buddySessionId,
  onReset,
  bare,
  whyBullets,
  inspect,
}: {
  headline: string;
  subtext: string;
  ctaLabel: string;
  inspect?: (part: "result_headline" | "result_subtext") => React.HTMLAttributes<HTMLElement>;
  sections: { stage: ResultStageT; recs: RecommendedProduct[] }[];
  quizId?: string;
  sessionId?: string;
  collectEmail?: boolean;
  answerIds?: string[];
  resultNodeId: string;
  shopDomain: string;
  discountCode?: string;
  discountLabel?: string;
  styles: ReturnType<typeof stylesFor>;
  startedAt: number;
  completed: React.MutableRefObject<boolean>;
  analytics: ReturnType<typeof createAnalyticsClient> | null;
  buddySessionId?: string | null;
  onReset: () => void;
  bare?: boolean;
  whyBullets?: string[];
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  useEffect(() => {
    if (completed.current || !analytics) return;
    completed.current = true;
    analytics.track("quiz_completed", {
      duration_ms: Date.now() - (startedAt || Date.now()),
    });
    const productIds = sections.flatMap((s) => s.recs.map((r) => r.product_id));
    analytics.track("recommendation_viewed", {
      result_node_id: resultNodeId,
      product_ids: productIds,
    });
    if (!isPreviewMode) {
      postQuizSession({
        quizId,
        sessionId,
        outcomeId: resultNodeId,
        answerIds: answerIds ?? [],
        productIds,
      });
    }
  }, [
    analytics,
    completed,
    resultNodeId,
    startedAt,
    sections,
    isPreviewMode,
    quizId,
    sessionId,
    answerIds,
  ]);

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
      {(() => {
        // E5 — "Add the full routine": each section's TOP pick, one tap.
        // Hosted: a single multi-pair cart permalink. Embedded (TAE iframe):
        // a sequential single-item postMessage loop for back-compat, falling
        // back to the permalink if the parent doesn't answer.
        const topVariants = sections
          // Each section's first IN-STOCK pick — never add a sold-out variant to
          // the multi-pair cart permalink (it would add nothing on Shopify).
          .map(({ recs }) => recs.find((r) => r.inventory_in_stock !== false)?.default_variant_id)
          .filter((v): v is string => Boolean(v));
        if (topVariants.length < 2 || isPreviewMode) return null;
        const multiUrl = cartPermalinkMulti(shopDomain, topVariants, discountCode);
        if (!multiUrl) return null;
        return (
          <button
            onClick={() => {
              analytics?.track("add_to_cart", {
                routine: true,
                item_count: topVariants.length,
              });
              window.open(multiUrl, "_top");
            }}
            style={{ ...styles.primaryBtn, marginTop: 24 }}
          >
            {tc("add_routine", { n: topVariants.length })}
          </button>
        );
      })()}
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
        {tc("start_over")}
      </button>
      <SaveResultsLink quizId={quizId} sessionId={sessionId} />
      <BuddyRow quizId={quizId} sessionId={sessionId} buddySessionId={buddySessionId} analytics={analytics} />
    </>
  );

  if (bare) return inner;
  return (
    <div style={styles.card}>
      <h2 style={styles.resultHeadline} {...(inspect?.("result_headline") ?? {})}>{headline}</h2>
      {subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("result_subtext") ?? {})}>
          {subtext}
        </p>
      )}
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
  const platform = useContext(RuntimePlatformContext);
  const tc = useChrome();
  return (
    <section>
      {stage.headline && (
        <h2
          style={{
            ...styles.h2,
            // E5 editorial: a quiet eyebrow rule above each routine section.
            fontSize: "calc(var(--qz-h2-size) * 1.08)",
            paddingTop: 14,
            borderTop: "1px solid color-mix(in srgb, var(--qz-color-muted, #aaa) 28%, transparent)",
          }}
        >
          {stage.headline}
        </h2>
      )}
      {stage.subtext && (
        <p style={{ ...styles.muted, marginTop: 6 }}>{stage.subtext}</p>
      )}
      <div style={{ marginTop: 12, ...styles.productGrid }}>
        {recs.length === 0 && (
          <p style={{ color: "var(--qz-color-muted)" }}>
            {tc("no_results_match")}
          </p>
        )}
        {recs.map((r, idx) => {
          const href = productHref(r, shopDomain, platform);
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
  vertical = false,
  reasons,
  showVariants = false,
  showDescriptions = false,
  lowStockQty,
  oosNotify = false,
  quizId,
  sessionId,
  blurb,
}: {
  product: RecommendedProduct;
  position: number;
  ctaLabel: string;
  // Spec §3 Mode B — token-resolved "why we recommend this" blurb.
  blurb?: string;
  // Spec §2 product-display toggles. showVariants gates the inline variant
  // picker; showDescriptions renders the baked description; lowStockQty (when a
  // number) renders the live "Only X left" urgency line.
  showVariants?: boolean;
  showDescriptions?: boolean;
  lowStockQty?: number | null;
  // Spec §5 — when this card is sold out and the page's OOS behavior is
  // "notify_me", the CTA becomes an inline back-in-stock email capture.
  oosNotify?: boolean;
  quizId?: string;
  sessionId?: string;
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
  // BIC P8: vertical card for the 2-column result's right rail — full-width
  // square image, text below, CTA at the bottom. Default horizontal everywhere
  // else, so nothing changes unless the split layout asks for it.
  vertical?: boolean;
  reasons?: string[];
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  const strikethroughPercent = useContext(RuntimeDiscountContext);
  void position;
  // Selectable variant (Dev Spec §5). Defaults to the baked default variant;
  // the shopper can switch before adding to cart.
  const [selectedVariantId, setSelectedVariantId] = useState(
    product.default_variant_id ?? product.variants?.[0]?.id,
  );
  // Sold-out gate for the CURRENTLY-selected variant (recomputed per render so it
  // tracks the variant <select>). A priced OOS product stays VISIBLE under
  // oos_behavior=show_with_badge, but its cart CTA must not fire: a /cart
  // permalink for a sold-out variant adds nothing under Shopify's default
  // continue-selling=off. Per-variant when known, else product-level.
  const selectedVariant = product.variants?.find((v) => v.id === selectedVariantId);
  const soldOut = selectedVariant
    ? selectedVariant.available === false
    : product.inventory_in_stock === false;
  // QD-7 — standalone quizzes have no Shopify cart; gate the permalink off so
  // the CTA below becomes "Shop now" → the merchant's own product URL (`href`).
  const cartUrl =
    platform === "standalone" || soldOut
      ? null
      : cartPermalink(shopDomain, selectedVariantId, 1, discountCode);

  const infoStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: vertical ? "column" : "row",
    gap: 12,
    alignItems: vertical ? "stretch" : "center",
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
          style={
            vertical
              ? { width: "100%", height: "auto", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: "var(--qz-radius)" }
              : { width: 80, height: 80, objectFit: "cover", borderRadius: "var(--qz-radius)", flexShrink: 0 }
          }
        />
      ) : (
        <div
          style={
            vertical
              ? { width: "100%", aspectRatio: "1 / 1", background: "#00000010", borderRadius: "var(--qz-radius)" }
              : { width: 80, height: 80, background: "#00000010", borderRadius: "var(--qz-radius)", flexShrink: 0 }
          }
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{product.title}</div>
        {blurb && blurb.trim() ? (
          <div style={{ fontSize: 13, color: "var(--qz-color-muted)", marginTop: 3, lineHeight: 1.4 }}>
            {blurb}
          </div>
        ) : null}
        {reasons && reasons.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            <span style={{ fontSize: "0.7em", color: "var(--qz-color-muted, #888)", fontFamily: "var(--qz-font-body)" }}>
              {tc("because_you_chose")}
            </span>
            {reasons.map((r) => (
              <span
                key={r}
                style={{
                  fontSize: "0.7em",
                  fontFamily: "var(--qz-font-body)",
                  padding: "1px 8px",
                  borderRadius: 999,
                  background: "color-mix(in srgb, var(--qz-color-primary) 10%, transparent)",
                  whiteSpace: "nowrap",
                }}
              >
                {r}
              </span>
            ))}
          </div>
        ) : null}
        {product.price &&
          (() => {
            // Per-item struck price only for an unconditional percentage discount
            // that THIS result opts into (discountLabel set) AND that the quiz
            // marks strikethrough-eligible (RuntimeDiscountContext). Otherwise the
            // render is byte-identical to before: just the price + optional badge.
            const discounted =
              discountLabel && strikethroughPercent != null
                ? discountedItemPrice(Number(product.price), strikethroughPercent)
                : null;
            return (
              <div style={{ color: "var(--qz-color-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {discounted != null ? (
                  <>
                    <span style={{ textDecoration: "line-through", opacity: 0.65 }}>
                      {formatMoney(product.price, currency, locale)}
                    </span>
                    <span style={{ color: "var(--qz-color-primary)", fontWeight: 700 }}>
                      {formatMoney(discounted, currency, locale)}
                    </span>
                  </>
                ) : (
                  <span>{formatMoney(product.price, currency, locale)}</span>
                )}
                {discountLabel ? (
                  <span style={{ background: "var(--qz-color-primary)", color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 600 }}>
                    {discountLabel}
                  </span>
                ) : null}
              </div>
            );
          })()}
        {typeof lowStockQty === "number" && lowStockQty > 0 && product.inventory_in_stock ? (
          <div style={{ color: "#B25E00", marginTop: 4, fontSize: 12, fontWeight: 600 }}>
            <span className="qz-urgency-pulse">{tc("only_x_left", { count: lowStockQty })}</span>
          </div>
        ) : null}
        {showDescriptions && product.description ? (
          <div
            style={{
              color: "var(--qz-color-muted)",
              marginTop: 6,
              fontSize: 13,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.description}
          </div>
        ) : null}
        {!product.inventory_in_stock && (
          <div style={{ color: "#D72C0D", marginTop: 4, fontSize: 12 }}>{tc("out_of_stock")}</div>
        )}
      </div>
    </>
  );

  return (
    <div
      style={{
        ...styles.productCard,
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        gap: 12,
        alignItems: vertical ? "stretch" : "center",
      }}
    >
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
        {/* Only show the variant picker on the cart path: selectedVariantId is
            consumed by add-to-cart (cartUrl) only. On standalone there's no
            cart and "Shop now" links to the variant-agnostic PDP, so the picker
            would be a dead, misleading control. */}
        {showVariants && cartUrl && product.variants && product.variants.length > 1 ? (
          <select
            aria-label={tc("aria_choose_variant")}
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
            {tc("add_to_cart")}
          </button>
        ) : soldOut && oosNotify ? (
          // Spec §5 — sold out + notify_me: capture an email for back-in-stock
          // instead of a dead add-to-cart.
          <NotifyMeForm quizId={quizId} sessionId={sessionId} productId={product.product_id} compact />
        ) : soldOut && platform !== "standalone" ? (
          // Shopify + sold out: the add-to-cart would build a doomed permalink,
          // so show a disabled state instead (the OOS note above already explains).
          <button
            type="button"
            disabled
            style={{ ...ctaStyle, cursor: "not-allowed", opacity: 0.55 }}
          >
            {tc("out_of_stock")}
          </button>
        ) : platform === "standalone" && href ? (
          // QD-7 — standalone: a real "Shop now" link to the merchant's PDP
          // (the index `url`). Preview no-ops navigation like add-to-cart does.
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (isPreviewMode) e.preventDefault();
              else onAdd?.();
            }}
            style={{ ...ctaStyle, cursor: "pointer", textDecoration: "none", textAlign: "center" }}
          >
            {tc("shop_now")}
          </a>
        ) : (
          <span style={{ ...ctaStyle, cursor: "default" }}>{ctaLabel}</span>
        )}
      </div>
    </div>
  );
}
