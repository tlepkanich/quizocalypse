// BIC-2 C2 — Stage 1 (Recommendation Buckets) extracted from Step1Funnel.tsx as
// a PURE MOVE: identical JSX/props/hooks, plus this stage's private overlays
// (intercept modal, tab-lock/remove/bulk warns, the results-preview drawer, the
// AI banner). Only the imports are new.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { Box, Check, FolderOpen, Play, RotateCcw, Tag, X } from "lucide-react";
import { QzCard, QzBadge, QzInput } from "../../qz";
import { QzModal, QzDrawer } from "../../qz-overlays";
import { DeviceFrame } from "../../builder/preview/DeviceFrame";
import { useFunnelBar, type FunnelBarOverride } from "../funnelChrome";
import type { DesignTokens } from "../../../lib/quizSchema";
import { resolveDesignTokens, tokensToCssVars, suggestContrastText } from "../../../lib/designTokens";
import { googleFontsUrl } from "../../runtime/runtimeStyles";
import {
  type ActionResult,
  type BucketType,
  type FunnelData,
} from "./stagesShared";

// ── Stage 1 — Recommendation Buckets (the quiz's possible OUTCOMES) ───────────
// The brand defines what the quiz can recommend: each bucket is an individual
// product, a tag, or a collection. An AI pre-analysis (bucketDetect) suggests
// the best bucketing strategy; selections continuously auto-save (each toggle is
// one server write, optimistically reflected). Desktop-first; Shopify data is
// read-only.
type BucketCard = {
  key: string;
  type: BucketType;
  name: string;
  count: number;
  thumbnailUrl: string | null;
};

const idOf = (type: BucketType, key: string) => `${type}:${key}`;

// Mock tab labels (step1-final-page): terse — "Products", not "Individual
// products". SUB_LABEL is the per-row type line the mock shows under the name
// on the non-leaf tabs.
const TAB_META: Array<{ type: BucketType; label: string }> = [
  { type: "product", label: "Products" },
  { type: "tag", label: "Tags" },
  { type: "collection", label: "Collections" },
];
const SUB_LABEL: Record<BucketType, string | null> = {
  product: null,
  tag: "Tag",
  collection: "Collection",
};

const TYPE_BADGE: Record<BucketType, "draft" | "ok" | "warn"> = {
  product: "draft",
  tag: "ok",
  collection: "warn",
};

function BucketGlyph({ type, size = 18 }: { type: BucketType; size?: number }) {
  const Icon = type === "product" ? Box : type === "tag" ? Tag : FolderOpen;
  return <Icon size={size} strokeWidth={1.8} aria-hidden />;
}

// Merchant-facing nouns for the switch-confirm copy ("You have 4 collections
// selected…") — the tab labels are display-cased/pluralized, so counts need
// their own singular/plural forms.
const TYPE_NOUN: Record<BucketType, [string, string]> = {
  product: ["product", "products"],
  tag: ["tag", "tags"],
  collection: ["collection", "collections"],
};

export function RecommendationBucketsStage({
  data,
  fetcher,
  pendingIntent,
  result,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
  result: ActionResult | null;
}) {
  const [activeTab, setActiveTab] = useState<BucketType>(data.activeTab);
  // One-line-chrome §2.3 — the tip's ✕ dismisses for THIS SESSION only
  // (sessionStorage, no server write); a legacy persisted dismissal is still
  // honored. Dismiss is the tip's only control.
  const [dismissed, setDismissed] = useState(data.bannerDismissed);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(`qz-rb-nb-${data.quizId}`)) setDismissed(true);
  }, [data.quizId]);
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search).trim().toLowerCase();
  // Overlays: the switch-confirm (a type change with selections) + the §5
  // results-page preview drawer + the §6 referenced-removal warnings (single
  // toggle + the bulk paths — review-caught: Use-this / Clear-visible could
  // otherwise silently remove referenced selections).
  const [lockTarget, setLockTarget] = useState<BucketType | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [removeWarn, setRemoveWarn] = useState<BucketCard | null>(null);
  const [bulkWarn, setBulkWarn] = useState<{ count: number; run: () => void } | null>(null);
  const [bucketPreview, setBucketPreview] = useState<BucketCard | null>(null);
  // Start-routing spec §1 — Continue opens the "How do you want to start?"
  // intercept (decider drafts only; legacy Continue submits directly as today).
  // Dismissal returns here unchanged; it re-opens on the next Continue.
  const [interceptOpen, setInterceptOpen] = useState(false);
  const isDecider = data.logicModel === "decider";
  // FLOW-1 — the goal-first flow: the merchant already wrote their goal at the
  // front door, so Continue confirms straight into the headless build
  // (flow1-confirm) with NO start pop-up; the pre-pick banner narrates the AI
  // selection's lifecycle instead of the generic AI tip.
  const goalFirst = data.goalFirst;
  const prepickBusy = goalFirst?.prepick === "picking";
  // FLOW-3 — the template-first flow: the merchant already picked a card on
  // /studio/templates, so Continue confirms straight into the build
  // (flow3-confirm) with NO start pop-up; a quiet banner names the pick.
  const templateFirst = data.templateFirst;
  const referencedSet = useMemo(() => new Set(data.referencedKeys), [data.referencedKeys]);

  // Optimistic overlay over the server's selection: id → card (added) | null
  // (removed). Cleared once the fetcher settles (the loader is then fresh).
  const [overlay, setOverlay] = useState<Map<string, BucketCard | null>>(() => new Map());
  useEffect(() => {
    if (fetcher.state === "idle") setOverlay(new Map());
  }, [fetcher.state, data.buckets]);

  const selected = useMemo(() => {
    const m = new Map<string, BucketCard>();
    for (const b of data.buckets) m.set(idOf(b.type, b.key), b);
    for (const [id, card] of overlay) {
      if (card === null) m.delete(id);
      else m.set(id, card);
    }
    return m;
  }, [data.buckets, overlay]);

  const isOn = (type: BucketType, key: string) => selected.has(idOf(type, key));
  const overlaySet = (id: string, val: BucketCard | null) =>
    setOverlay((prev) => new Map(prev).set(id, val));

  // One toggle = one optimistic overlay write + one server write. The grid row
  // and the rail row share this, so removing in either place is the same op.
  const doToggle = (card: BucketCard) => {
    const on = !isOn(card.type, card.key);
    overlaySet(idOf(card.type, card.key), on ? card : null);
    fetcher.submit(
      { intent: "toggle-bucket", type: card.type, key: card.key, on: String(on) },
      { method: "post" },
    );
  };

  // §6 downstream integrity — removing a selection the draft's questions/rules
  // already reference gets a warn-first confirm (Step 3's V5/V6 still catch
  // anything broken; this is the courtesy at the source).
  const toggle = (card: BucketCard) => {
    const removing = isOn(card.type, card.key);
    if (removing && referencedSet.has(idOf(card.type, card.key))) {
      setRemoveWarn(card);
      return;
    }
    doToggle(card);
  };

  // Tab switch persists active_tab. Selections are homogeneous to one type, so
  // switching with ≥1 selection prompts the switch-confirm modal first
  // (confirm → clear all, then switch). Per §4, tab clicks no longer dismiss
  // the AI banner — only "Not now" does.
  const doSwitchTab = (type: BucketType, clear: boolean) => {
    setActiveTab(type);
    setSearch("");
    if (clear) {
      setApplied(null); // a manual restart invalidates the Applied/Undo state
      // Optimistically empty the selection (mark every current id removed).
      setOverlay(() => {
        const next = new Map<string, BucketCard | null>();
        for (const c of selected.values()) next.set(idOf(c.type, c.key), null);
        return next;
      });
    }
    fetcher.submit(
      { intent: "switch-tab", type, ...(clear ? { clear: "true" } : {}) },
      { method: "post" },
    );
  };

  const dismissTip = () => {
    setDismissed(true);
    if (typeof window !== "undefined") sessionStorage.setItem(`qz-rb-nb-${data.quizId}`, "1");
  };

  // Owner correction (2026-08-01) — the tip KEEPS its apply action: "Use
  // this" applies the concrete recommended set in one click (referenced
  // selections still warn first); the pill morphs to Applied + Undo.
  // Optimistic cards resolve names/counts from the already-loaded catalog.
  const [applied, setApplied] = useState<{
    prior: { type: BucketType | null; keys: string[]; tab: BucketType };
  } | null>(null);
  const cardFor = (type: BucketType, key: string): BucketCard => {
    if (type === "product") {
      const p = data.catalog.products.find((x) => x.id === key);
      return { key, type, name: p?.title ?? key, count: 1, thumbnailUrl: p?.imageUrl ?? null };
    }
    const src = type === "tag" ? data.catalog.tags : data.catalog.collections;
    const g = src.find((x) => x.key === key);
    return { key, type, name: g?.label ?? key, count: g?.count ?? 0, thumbnailUrl: null };
  };
  const setSelection = (type: BucketType, keys: string[]) => {
    setSearch("");
    setActiveTab(type);
    setOverlay(() => {
      const next = new Map<string, BucketCard | null>();
      for (const c of selected.values()) next.set(idOf(c.type, c.key), null);
      for (const k of keys) next.set(idOf(type, k), cardFor(type, k));
      return next;
    });
    fetcher.submit({ intent: "set-buckets", type, keys: keys.join(",") }, { method: "post" });
  };
  const useThis = () => {
    const apply = data.suggestion.apply;
    if (!apply) return;
    const current = [...selected.values()];
    const run = () => {
      setApplied({
        prior: { type: current[0]?.type ?? null, keys: current.map((c) => c.key), tab: activeTab },
      });
      setSelection(apply.type, apply.keys);
    };
    // Applying removes every current selection NOT in the recommended set —
    // warn first when any of those are referenced by the draft's questions
    // (the server keeps ids for keys present in BOTH sets, so those survive).
    const applySet = new Set(apply.keys.map((k) => idOf(apply.type, k)));
    const leavingReferenced = current.filter(
      (c) => referencedSet.has(idOf(c.type, c.key)) && !applySet.has(idOf(c.type, c.key)),
    );
    if (leavingReferenced.length > 0) setBulkWarn({ count: leavingReferenced.length, run });
    else run();
  };
  const undoApply = () => {
    const prior = applied?.prior;
    setApplied(null);
    if (!prior) return;
    if (prior.type) setSelection(prior.type, prior.keys);
    else setSelection(prior.tab, []); // empty prior: clear + land back on the pre-apply tab
  };

  const switchTab = (type: BucketType) => {
    if (type === activeTab) return;
    if (selected.size > 0) {
      setLockTarget(type); // confirm via the modal
      return;
    }
    doSwitchTab(type, false);
  };

  // H4 a11y — roving-tabindex arrow-key navigation for the bucket-source tablist
  // (the ARIA tablist keyboard pattern). MANUAL activation: ←/→/Home/End move
  // focus only; the tab's native Enter/Space click activates — so arrowing never
  // trips the switch-tab confirm modal.
  const tablistRef = useRef<HTMLDivElement>(null);
  const onTabKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const tabs = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    if (tabs.length === 0) return;
    const currentIdx = tabs.findIndex((el) => el === document.activeElement);
    const base = currentIdx < 0 ? 0 : currentIdx;
    const nextIdx =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? tabs.length - 1
          : (base + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[nextIdx]?.focus();
  };

  const priceById = useMemo(
    () => new Map(data.catalog.products.map((p) => [p.id, p.price])),
    [data.catalog.products],
  );

  const cardsForTab = (type: BucketType): BucketCard[] => {
    if (type === "product")
      return data.catalog.products.map((p) => ({
        key: p.id,
        type,
        name: p.title,
        count: 1,
        thumbnailUrl: p.imageUrl,
      }));
    const src = type === "tag" ? data.catalog.tags : data.catalog.collections;
    return src.map((t) => ({ key: t.key, type, name: t.label, count: t.count, thumbnailUrl: null }));
  };

  const visible = useMemo(() => {
    const all = cardsForTab(activeTab);
    return q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, q, data.catalog]);

  const visibleKeys = visible.map((c) => c.key);
  const allVisibleOn = visibleKeys.length > 0 && visibleKeys.every((k) => isOn(activeTab, k));

  const selectAllVisible = () => {
    setOverlay((prev) => {
      const next = new Map(prev);
      for (const c of visible) next.set(idOf(c.type, c.key), c);
      return next;
    });
    fetcher.submit(
      { intent: "select-all", type: activeTab, keys: visibleKeys.join(",") },
      { method: "post" },
    );
  };

  const clearVisible = () => {
    const run = () => {
      setOverlay((prev) => {
        const next = new Map(prev);
        for (const k of visibleKeys) next.set(idOf(activeTab, k), null);
        return next;
      });
      fetcher.submit(
        { intent: "clear-visible", type: activeTab, keys: visibleKeys.join(",") },
        { method: "post" },
      );
    };
    // §6 — a filtered bulk clear can remove referenced selections a single
    // toggle would have warned about; gate it the same way.
    const referencedCleared = visibleKeys.filter(
      (k) => isOn(activeTab, k) && referencedSet.has(idOf(activeTab, k)),
    );
    if (referencedCleared.length > 0) setBulkWarn({ count: referencedCleared.length, run });
    else run();
  };

  const selectedList = [...selected.values()];
  const count = selectedList.length;
  const continuing = pendingIntent === "continue-buckets";
  const resyncing = pendingIntent === "resync";
  const resyncResult = result && result.intent === "resync" ? result : null;
  const tabCounts: Record<BucketType, number> = {
    product: data.catalog.products.length,
    tag: data.catalog.tags.length,
    collection: data.catalog.collections.length,
  };
  const activeLabel = TAB_META.find((t) => t.type === activeTab)?.label ?? "";

  const lockedType = count > 0 ? selectedList[0]?.type ?? null : null;
  const typeChip = lockedType ? TAB_META.find((t) => t.type === lockedType)?.label ?? null : null;

  // One-line-chrome §1.3 — the step's Continue lives in the bar; publish the
  // gate (≥1 recommendation), the flow-specific label, and the intercept
  // behavior through the funnel-chrome bridge. Handlers ride a ref so they
  // stay referentially stable (the bridge's publish contract); the OPTIMISTIC
  // count drives the gate, so the button enables on the first pick.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const hasGoalFirst = Boolean(goalFirst);
  const hasTemplateFirst = Boolean(templateFirst);
  const barContinue = useCallback(() => {
    if (hasGoalFirst) fetcherRef.current.submit({ intent: "flow1-confirm" }, { method: "post" });
    else if (hasTemplateFirst) fetcherRef.current.submit({ intent: "flow3-confirm" }, { method: "post" });
    else if (isDecider) setInterceptOpen(true);
    else fetcherRef.current.submit({ intent: "continue-buckets" }, { method: "post" });
  }, [hasGoalFirst, hasTemplateFirst, isDecider]);
  const continueBusy =
    continuing ||
    prepickBusy ||
    pendingIntent === "flow1-confirm" ||
    pendingIntent === "flow3-confirm" ||
    pendingIntent === "shape-goal-build" ||
    pendingIntent === "manual-build";
  // Owner edit (2026-08-18) — one label for every flow; the goal/template
  // flows no longer say "Generate my quiz".
  const continueLabel =
    continuing || pendingIntent === "flow1-confirm" || pendingIntent === "flow3-confirm"
      ? "Saving…"
      : "Continue →";
  const barOverride = useMemo<FunnelBarOverride>(
    () => ({
      continueSpec: {
        label: continueLabel,
        onClick: barContinue,
        disabled: count === 0 || continueBusy,
        title: count === 0 ? "Add at least one recommendation to continue." : undefined,
      },
    }),
    [continueLabel, barContinue, count, continueBusy],
  );
  useFunnelBar(barOverride);

  // QRTZ-G1 — speculative question-gen prefetch: once the chosen pool SETTLES
  // (≥1 recommendation, the shared mutation fetcher idle, and no pool change
  // for 5s), ping the server's `speculate` intent. Fire-and-forget: the server
  // owns every decision (signature, budget, one-at-a-time, supersede) and
  // nothing about it is visible here — Continue simply lands faster when the
  // speculation hit. A SEPARATE fetcher so a settle ping can never cancel an
  // in-flight bucket write (one Remix fetcher = one in-flight submission).
  // Decider-only, and only on flows whose Continue chain is deterministic at
  // settle time: goal-first (pre-pick ready) and the plain flow (whose pop-up
  // "Generate with AI" runs the derived-goal chain). FLOW-3 keeps the normal
  // path. Re-arms only when the pool identity changes, so an idle merchant
  // never generates repeat pings (the server would skip them anyway).
  const specFetcher = useFetcher();
  const specFetcherRef = useRef(specFetcher);
  specFetcherRef.current = specFetcher;
  const specEligible =
    isDecider && !templateFirst && (!goalFirst || goalFirst.prepick === "ready");
  const poolKey = useMemo(() => [...selected.keys()].sort().join("|"), [selected]);
  const poolCount = selected.size;
  const mutationState = fetcher.state;
  useEffect(() => {
    if (!specEligible || poolCount === 0 || mutationState !== "idle") return;
    const t = window.setTimeout(() => {
      specFetcherRef.current.submit({ intent: "speculate" }, { method: "post" });
    }, 5000);
    return () => window.clearTimeout(t);
  }, [poolKey, poolCount, mutationState, specEligible]);

  // One-line-chrome §2.3 — the tip earns its place only when the grouping
  // choice is genuinely ambiguous: ≥20 products AND more than one viable
  // grouping (≥2 collections or ≥5 tags). For a small store it states the
  // obvious and costs trust — render the title row alone.
  const tipEligible =
    data.catalog.products.length >= 20 &&
    (data.catalog.collections.length >= 2 || data.catalog.tags.length >= 5);
  const showTip =
    tipEligible && !dismissed && !goalFirst && !templateFirst && Boolean(data.suggestion.message);

  return (
    <div className="qz-rb">
      {/* Owner edit (2026-08-02) — the tip moved OUT of the title row to its
          own row directly under the heading; the title stands alone. */}
      <div className="qz-rb-titlerow">
        {/* QRTZ-S5 — mock s10 step title, verbatim. */}
        <h2 className="qz-h2" style={{ margin: 0 }}>
          What should this quiz recommend?
        </h2>
      </div>
      {showTip ? (
        <div className="qz-rb-tiprow">
          {applied ? (
            <div className="qz-rb-tip is-applied" role="status">
              <span className="qz-rb-tip-star" aria-hidden><Check size={13} strokeWidth={2.8} /></span>
              <span className="qz-rb-tip-label">Tip</span>
              <strong className="qz-rb-tip-sug">
                Applied — {data.suggestion.message.replace(/^Use |^Start with /, "using ")}
              </strong>
              <button type="button" className="qz-rb-tip-use" onClick={undoApply}>
                Undo
              </button>
              <button
                type="button"
                className="qz-rb-tip-x"
                aria-label="Dismiss tip"
                onClick={dismissTip}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          ) : (
            <div className="qz-rb-tip">
              <span className="qz-rb-tip-star" aria-hidden>✦</span>
              <span className="qz-rb-tip-label">Tip</span>
              <strong className="qz-rb-tip-sug">{data.suggestion.message}</strong>
              {data.suggestion.apply ? (
                <button type="button" className="qz-rb-tip-use" onClick={useThis}>
                  Use this
                </button>
              ) : null}
              <button
                type="button"
                className="qz-rb-tip-x"
                aria-label="Dismiss tip"
                onClick={dismissTip}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* FLOW-1/FLOW-3 lifecycle banners — functional status (the pre-pick /
          template narration), not advice; they stay. */}
      {goalFirst ? (
        <GoalFirstBanner
          state={goalFirst}
          stalled={data.genStalled}
          goalText={data.goal?.goal_text ?? ""}
          count={count}
          retrying={pendingIntent === "retry-gen"}
          onRetry={() => fetcher.submit({ intent: "retry-gen" }, { method: "post" })}
        />
      ) : templateFirst ? (
        <div className="qz-rb-banner is-applied qz-gf-banner" role="status">
          <span className="qz-rb-banner-icon" aria-hidden><Check size={17} strokeWidth={2.6} /></span>
          <div className="qz-rb-banner-body">
            <div className="qz-rb-banner-head">
              <strong>Building from &ldquo;{templateFirst.name}&rdquo;</strong>
            </div>
            <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
              Refine what your quiz should recommend below, then generate your quiz — the
              questions come pre-shaped by your pick.
            </p>
          </div>
        </div>
      ) : null}

      <div className="qz-rb-split">
        <div className="qz-rb-main">
          {/* §2.1 — the picker */}
          <QzCard flush className="qz-rb-browser">
        <div
          className="qz-rb-tabs"
          role="tablist"
          aria-label="Recommendation type"
          ref={tablistRef}
          onKeyDown={onTabKeyDown}
        >
          {TAB_META.map((t) => {
            const n = tabCounts[t.type];
            const on = t.type === activeTab;
            // §3 — selecting anything locks the type: the other tabs MUTE (no
            // lock icon) but stay CLICKABLE — the click opens the switch-confirm
            // modal, which is the path to switching, not a dead end.
            const muted = count > 0 && !on;
            return (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={on}
                // Roving tabindex: only the selected tab is in the Tab order; ←/→
                // move between tabs (onTabKeyDown focuses the others programmatically).
                tabIndex={on ? 0 : -1}
                className={`qz-rb-tab${on ? " is-active" : ""}${muted ? " is-muted" : ""}`}
                disabled={n === 0 && t.type !== "product"}
                onClick={() => switchTab(t.type)}
              >
                {t.label}
                <span className="qz-rb-tab-n">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="qz-rb-toolbar">
          <QzInput
            type="search"
            placeholder={`Search ${activeLabel.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            aria-label="Search the catalog"
          />
          <button
            type="button"
            className="qz-rb-selall"
            onClick={allVisibleOn ? clearVisible : selectAllVisible}
            disabled={visible.length === 0}
          >
            {allVisibleOn ? "Clear visible" : "Select all"}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="qz-rb-empty qz-dim">
            {q ? "No matches." : "Nothing here yet — sync your catalog to populate this tab."}
          </div>
        ) : (
          <div className={`qz-rb-grid${activeTab === "product" ? " is-products" : ""}`}>
            {visible.map((c) => {
              const on = isOn(c.type, c.key);
              const price = activeTab === "product" ? priceById.get(c.key) ?? null : null;
              return (
                // §2.4 markup note — a picker row is role="checkbox", NOT a
                // <button>: it contains the "N products →" button, and nested
                // interactive elements break the parser and screen readers.
                <div
                  key={c.key}
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={on}
                  className={`qz-rb-card${on ? " is-on" : ""}`}
                  onClick={() => toggle(c)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    toggle(c);
                  }}
                >
                  <span className={`qz-rb-thumb${c.thumbnailUrl ? "" : " is-placeholder"}`}>
                    {c.thumbnailUrl ? (
                      <img src={c.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <BucketGlyph type={c.type} />
                    )}
                  </span>
                  <span className="qz-rb-card-body">
                    <span className="qz-rb-card-name">{c.name}</span>
                    {SUB_LABEL[activeTab] ? (
                      <span className="qz-rb-card-sub">{SUB_LABEL[activeTab]}</span>
                    ) : null}
                  </span>
                  {/* Mock row order: name · spacer · selcheck · count-pill/price. */}
                  <span className={`qz-rb-check${on ? " is-on" : ""}`} aria-hidden>
                    {on ? <Check size={12} strokeWidth={2.8} /> : null}
                  </span>
                  {activeTab === "product" ? (
                    <span className="qz-rb-pricetag">
                      {price != null ? `$${price.toFixed(2)}` : "—"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="qz-rb-count-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        setBucketPreview(c);
                      }}
                    >
                      {c.count} product{c.count === 1 ? "" : "s"} <span aria-hidden>→</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </QzCard>

          {/* Mock underrow: quiet accent-ink text link (↻ Refresh catalog).
              §1.5 — the step-level ← Back is gone; the bar's ‹ owns it. */}
          <div className="qz-rb-underrow">
            <button
              type="button"
              className="qz-rb-underlink"
              onClick={() => fetcher.submit({ intent: "resync" }, { method: "post" })}
              disabled={resyncing}
            >
              {resyncing ? "Refreshing…" : <><RotateCcw size={13} aria-hidden /> Refresh catalog</>}
            </button>
            {resyncResult ? (
              <span className="qz-dim" style={{ fontSize: 12 }}>
                {resyncResult.ok
                  ? "Catalog refreshed."
                  : resyncResult.error ?? "Couldn't refresh from here."}
              </span>
            ) : null}
          </div>
        </div>

        {/* §2.2 — "Your recommendations" rail (sticky) */}
        <aside className="qz-rb-rail" aria-label="Your recommendations">
          <div className="qz-rb-rail-head">
            <strong>Your recommendations</strong>
            <span className="qz-row" style={{ gap: 6 }}>
              {typeChip && lockedType ? (
                <QzBadge tone={TYPE_BADGE[lockedType]}>{typeChip}</QzBadge>
              ) : null}
              <span className="qz-rb-count">{count}</span>
            </span>
          </div>
          {count === 0 ? (
            <div className="qz-rb-rail-empty">
              <div className="qz-rb-rail-empty-ic" aria-hidden>🗂️</div>
              <p>
                Nothing added yet — click{" "}
                {activeTab === "product" ? "a product" : activeTab === "tag" ? "a tag" : "a collection"}{" "}
                to add it.
              </p>
            </div>
          ) : (
            <div className="qz-rb-rail-list">
              {selectedList.map((c) => (
                <div key={idOf(c.type, c.key)} className="qz-rb-rail-row">
                  <span className="qz-rb-chip-thumb">
                    {c.thumbnailUrl ? (
                      <img src={c.thumbnailUrl} alt="" loading="lazy" />
                    ) : (
                      <BucketGlyph type={c.type} size={14} />
                    )}
                  </span>
                  <span className="qz-rb-chip-body">
                    <span className="qz-rb-chip-name">{c.name}</span>
                    <span className="qz-rb-card-meta qz-dim">
                      {c.type === "product" ? "product" : `${c.count} product${c.count === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="qz-rb-chip-x"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => toggle(c)}
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          {count === 1 ? (
            <p className="qz-rb-warn">
              One recommendation means every shopper sees the same products. Add a few more so
              the quiz can actually differentiate.
            </p>
          ) : null}
          {/* §2.4 — the rail foot keeps Preview; Continue moved to the bar. */}
          <div className="qz-rb-rail-foot">
            <button
              type="button"
              className="qz-btn qz-btn-ghost"
              disabled={count === 0}
              onClick={() => setPreviewOpen(true)}
            >
              <Play size={14} aria-hidden /> Preview results page
            </button>
          </div>
        </aside>
      </div>

      {/* overlays */}
      {lockTarget ? (
        <TabLockModal
          targetLabel={TAB_META.find((t) => t.type === lockTarget)?.label ?? ""}
          currentNoun={TYPE_NOUN[lockedType ?? activeTab][count === 1 ? 0 : 1]}
          count={count}
          onConfirm={() => {
            doSwitchTab(lockTarget, true);
            setLockTarget(null);
          }}
          onCancel={() => setLockTarget(null)}
        />
      ) : null}
      {removeWarn ? (
        <RemoveWarnModal
          name={removeWarn.name}
          onConfirm={() => {
            doToggle(removeWarn);
            setRemoveWarn(null);
          }}
          onCancel={() => setRemoveWarn(null)}
        />
      ) : null}
      {bulkWarn ? (
        <BulkWarnModal
          count={bulkWarn.count}
          onConfirm={() => {
            bulkWarn.run();
            setBulkWarn(null);
          }}
          onCancel={() => setBulkWarn(null)}
        />
      ) : null}
      {previewOpen && count > 0 ? (
        <ResultsPreviewDrawer
          selections={selectedList}
          products={data.catalog.products}
          designTokens={data.designTokens ?? null}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {interceptOpen ? (
        <StartInterceptModal
          onAiTemplates={() => {
            setInterceptOpen(false);
            fetcher.submit({ intent: "continue-buckets" }, { method: "post" });
          }}
          onManual={() => {
            setInterceptOpen(false);
            fetcher.submit({ intent: "manual-build" }, { method: "post" });
          }}
          onClose={() => setInterceptOpen(false)}
        />
      ) : null}
      {bucketPreview ? (
        <BucketProductsModal
          bucket={bucketPreview}
          products={data.catalog.products}
          onClose={() => setBucketPreview(null)}
        />
      ) : null}
    </div>
  );
}

function BucketProductsModal({
  bucket,
  products,
  onClose,
}: {
  bucket: BucketCard;
  products: FunnelData["catalog"]["products"];
  onClose: () => void;
}) {
  const members = bucket.type === "tag"
    ? products.filter((product) => product.tagKeys.includes(bucket.key))
    : bucket.type === "collection"
      ? products.filter((product) => product.collectionIds.includes(bucket.key))
      : products.filter((product) => product.id === bucket.key);
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title={
        // Mock mhead (EXACT): icon tile · name over a "N products in this
        // collection/tag" meta line. No count badge.
        <span className="qz-rb-modal-title">
          <span className="qz-rb-modal-icon"><BucketGlyph type={bucket.type} size={17} /></span>
          <span className="qz-rb-modal-copy">
            <span>{bucket.name}</span>
            <span className="qz-rb-modal-meta">
              {members.length} product{members.length === 1 ? "" : "s"} in this{" "}
              {bucket.type === "collection" ? "collection" : "tag"}
            </span>
          </span>
        </span>
      }
      footer={<button type="button" className="qz-btn qz-btn-accent" onClick={onClose}>Done</button>}
    >
      <div className="qz-rb-product-list">
        {members.length ? members.map((product) => (
          <div key={product.id} className="qz-rb-product-row">
            <span className={`qz-rb-product-image${product.imageUrl ? "" : " is-placeholder"}`}>
              {product.imageUrl ? <img src={product.imageUrl} alt="" loading="lazy" /> : <Box size={18} aria-hidden />}
            </span>
            <span className="qz-rb-product-copy">
              <strong>{product.title}</strong>
              <span className="qz-dim">{product.price != null ? `$${product.price.toFixed(2)}` : "Price unavailable"}</span>
            </span>
          </div>
        )) : <p className="qz-dim" style={{ margin: 0 }}>No matching products are currently available.</p>}
      </div>
    </QzModal>
  );
}

// Step-1 start modal (start-modal-flow.html mock screen 1, EXACT). FLOW-2
// (funnel-reconfig): this pop-up survives ONLY in the manual flow — goal-first
// and template-first drafts confirm straight through flow1/flow3-confirm and
// never see it. Three stacked TITLE-ONLY rows, each with a trailing arrow:
//  • Generate with AI (primary: accent border + tint, pulsing ✦ tile, mono
//    RECOMMENDED tag) → continue-buckets, whose decider branch runs the
//    HEADLESS typing→templating→build chain and lands on Questions (Shape is
//    unreachable for new drafts).
//  • Write your goal (✎) → the Flow-1 /studio/goal front door (the old
//    in-modal goal-brief second screen is retired in favor of that page —
//    reuse, not duplication; the goal flow re-claims this pristine draft).
//  • Start from blank (▢) → manual-build → the blank Questions canvas.
// Esc/scrim closes with nothing changed.
function StartInterceptModal({
  onAiTemplates,
  onManual,
  onClose,
}: {
  onAiTemplates: () => void;
  onManual: () => void;
  onClose: () => void;
}) {
  return (
    // Mock modal envelope: min(560px, 100%) — narrower than the DS md (640).
    <QzModal open onClose={onClose} size="md" width={560}>
      {/* Owner edit (2026-08-02) — wording. */}
      <h2 className="qz-sm-title">What is your goal for the quiz?</h2>
      <div className="qz-sm-rows">
        <button type="button" className="qz-sm-row is-pri" onClick={onAiTemplates}>
          <span className="qz-sm-ico" aria-hidden><i>✦</i></span>
          <h3>Generate with AI</h3>
          <span className="qz-sm-rec">Recommended</span>
          <span className="qz-sm-spacer" />
          <span className="qz-sm-arr" aria-hidden>→</span>
        </button>
        <Link to="/studio/goal" className="qz-sm-row">
          <span className="qz-sm-ico is-neutral" aria-hidden><i>✎</i></span>
          <h3>Write your goal</h3>
          <span className="qz-sm-spacer" />
          <span className="qz-sm-arr" aria-hidden>→</span>
        </Link>
        <button type="button" className="qz-sm-row" onClick={onManual}>
          <span className="qz-sm-ico is-neutral" aria-hidden><i>▢</i></span>
          <h3>Start from blank</h3>
          <span className="qz-sm-spacer" />
          <span className="qz-sm-arr" aria-hidden>→</span>
        </button>
      </div>
    </QzModal>
  );
}

// Confirm switching the bucket source when buckets already exist (they're tied to
// the current source, so switching clears them).
function TabLockModal({
  targetLabel,
  currentNoun,
  count,
  onConfirm,
  onCancel,
}: {
  targetLabel: string;
  currentNoun: string;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // §3 — a modal, not a toast: it names the cost (your selections are removed)
  // and offers the path to yes in one gesture. Destructive-and-final → modal.
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={<>Switch to {targetLabel}?</>}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Switch types
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
        You have {count} {currentNoun} selected. Switching will remove{" "}
        {count === 1 ? "it" : "them all"} and let you pick {targetLabel.toLowerCase()} instead.
      </p>
    </QzModal>
  );
}

// §6 for the bulk paths (Use-this / Clear-visible) — same consequence, plural
// framing. Confirming runs the deferred bulk action.
function BulkWarnModal({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={<>Remove {count} referenced recommendation{count === 1 ? "" : "s"}?</>}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Continue
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
        Your questions already point at {count === 1 ? "one of these" : "some of these"}{" "}
        recommendations. Continuing can leave broken mappings — the Questions step will flag
        anything that breaks so you can fix it there.
      </p>
    </QzModal>
  );
}

// §6 downstream integrity — removing a selection the draft's questions already
// reference gets a warn-first confirm (Step 3's validation catches anything
// broken on the next visit; this names the consequence at the source).
function RemoveWarnModal({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={<>Remove &ldquo;{name}&rdquo;?</>}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            Remove
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
        Your questions already point at this recommendation. Removing it can leave broken
        mappings — the Questions step will flag anything that breaks so you can fix it there.
      </p>
    </QzModal>
  );
}

// §5 — the results-page preview drawer: a brand-themed phone preview of what a
// shopper would see for each selected recommendation. The point is to make the
// DIFFERENCE between recommendation types felt: an individual product previews
// as a focused single-product screen; a collection/tag previews as a grid (no
// hero — hero selection is a Results-page decision the merchant hasn't made
// yet, so implying one here would be dishonest). Members resolve client-side
// from the catalog; the theme is the draft's resolved design tokens (the same
// tokens the eventual quiz renders with) — never admin styling.
function ResultsPreviewDrawer({
  selections,
  products,
  designTokens,
  onClose,
}: {
  selections: BucketCard[];
  products: FunnelData["catalog"]["products"];
  designTokens: DesignTokens | null;
  onClose: () => void;
}) {
  const [tabIdx, setTabIdx] = useState(0);
  const sel = selections[Math.min(tabIdx, selections.length - 1)];

  const resolved = useMemo(() => resolveDesignTokens(designTokens ?? undefined), [designTokens]);
  const cssVars = useMemo(() => tokensToCssVars(resolved) as CSSProperties, [resolved]);
  const fontUrl = useMemo(
    () =>
      googleFontsUrl([
        resolved.typography?.heading?.family ?? "",
        resolved.typography?.body?.family ?? "",
      ]),
    [resolved],
  );

  const members = useMemo(() => {
    if (!sel) return [];
    if (sel.type === "tag") return products.filter((p) => p.tagKeys.includes(sel.key));
    if (sel.type === "collection") return products.filter((p) => p.collectionIds.includes(sel.key));
    return products.filter((p) => p.id === sel.key);
  }, [sel, products]);

  if (!sel) return null;
  const isProduct = sel.type === "product";
  const hero = members[0] ?? null;
  const shown = members.slice(0, 6);
  const overflow = members.length - shown.length;
  const descriptor = isProduct
    ? "Single-product layout — one focused product screen"
    : `Multi-product layout — ${members.length} product${members.length === 1 ? "" : "s"} from this ${sel.type === "tag" ? "tag" : "collection"}`;
  // The CTA sits on the brand primary — pick a contrast-safe text color (the
  // runtime does the same; a hardcoded white fails on light brand primaries).
  const ctaText = suggestContrastText(resolved.colors?.primary ?? "#5563DE");

  return (
    <QzDrawer open onClose={onClose} title="Results page preview" width="min(496px, 94vw)">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          height: "100%",
          overflow: "hidden",
        }}
      >
        {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
        {selections.length > 1 ? (
          <div className="qz-rb-pvtabs" role="tablist" aria-label="Previewed recommendation">
            {selections.map((s, i) => (
              <button
                key={idOf(s.type, s.key)}
                type="button"
                role="tab"
                aria-selected={i === tabIdx}
                className={`qz-rb-pvtab${i === tabIdx ? " is-active" : ""}`}
                onClick={() => setTabIdx(i)}
              >
                <BucketGlyph type={s.type} size={13} /> {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
          Themed with your brand identity · real product data.
        </p>

        {/* viewport/2026-08 — the canonical DeviceFrame phone (390×745, always
            whole, scaled to fit), replacing this drawer's old bespoke 300×500
            frame. showFold={false} per QRTZ-G45 (Results surfaces hide the
            fold marker); resetKey resets scroll when the previewed pick
            changes. The screen skin (.qz-rb-pvscreen) paints the brand vars —
            the devframe owns geometry, radius and elevation. */}
        <DeviceFrame
          tier="phone"
          resetKey={idOf(sel.type, sel.key)}
          paneHeight="min(745px, calc(100vh - 260px))"
          showFold={false}
        >
          <div className="qz-rb-pvscreen" style={cssVars}>
            {isProduct ? (
              hero ? (
                <div className="qz-rb-pv-single">
                  {hero.imageUrl ? (
                    <img className="qz-rb-pv-heroimg" src={hero.imageUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="qz-rb-pv-heroimg qz-rb-pv-noimg" aria-hidden>
                      📦
                    </div>
                  )}
                  <strong className="qz-rb-pv-name">{hero.title}</strong>
                  {hero.description ? (
                    <p className="qz-rb-pv-desc">{hero.description}</p>
                  ) : null}
                  <p className="qz-rb-ghost">✦ AI personalizes at quiz time</p>
                  <div className="qz-rb-pv-buyrow">
                    <span className="qz-rb-pv-price">
                      {hero.price != null ? `$${hero.price.toFixed(2)}` : ""}
                    </span>
                    <span className="qz-rb-pv-cta" style={{ color: ctaText }}>
                      Add to cart
                    </span>
                  </div>
                </div>
              ) : (
                // The product left the catalog since selection — say so honestly
                // instead of rendering an empty grid.
                <div className="qz-rb-pv-single">
                  <p className="qz-rb-ghost">
                    This product is no longer in your synced catalog — refresh the catalog or
                    remove the selection.
                  </p>
                </div>
              )
            ) : (
              <div className="qz-rb-pv-multi">
                <strong className="qz-rb-pv-name">
                  {members.length} product{members.length === 1 ? "" : "s"} in {sel.name}
                </strong>
                <p className="qz-rb-ghost">✦ AI personalizes at quiz time</p>
                <div className="qz-rb-pvgrid">
                  {shown.map((p) => (
                    <div key={p.id} className="qz-rb-pvtile">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <div className="qz-rb-pv-noimg" aria-hidden>
                          📦
                        </div>
                      )}
                      <span className="qz-rb-pvtile-name">{p.title}</span>
                      <span className="qz-rb-pvtile-price">
                        {p.price != null ? `$${p.price.toFixed(2)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
                {overflow > 0 ? <p className="qz-rb-pv-more">+ {overflow} more →</p> : null}
              </div>
            )}
          </div>
        </DeviceFrame>

        <div className="qz-rb-pvfoot">
          <span className="qz-dim" style={{ fontSize: 12, minWidth: 0 }}>
            <strong style={{ fontWeight: 600 }}>{sel.name}</strong> · {descriptor}
          </span>
          <button type="button" className="qz-btn qz-btn-accent qz-btn-sm" onClick={onClose}>
            Looks good
          </button>
        </div>
      </div>
    </QzDrawer>
  );
}

// §4 — the AI recommendation banner: an ACTION, not advice. "Use this" applies
// the concrete recommended set in one click; "Not now" dismisses for the
// session. The why-line carries real catalog numbers.
// FLOW-1 — the goal pre-pick's lifecycle banner (replaces the generic AI tip on
// goal-first drafts). Four states: picking (the detached job runs; the page
// polls), stalled (the shared 200s backstop → Retry), ready (the pick landed —
// refine + continue), failed (four-outcome copy + Retry; the browser below is
// always the manual way forward).
function GoalFirstBanner({
  state,
  stalled,
  goalText,
  count,
  retrying,
  onRetry,
}: {
  state: NonNullable<FunnelData["goalFirst"]>;
  stalled: boolean;
  goalText: string;
  count: number;
  retrying: boolean;
  onRetry: () => void;
}) {
  const goalLine = goalText.split("\n")[0] ?? "";
  const excerpt = goalLine.length > 110 ? `${goalLine.slice(0, 110)}…` : goalLine;
  // QRTZ-S5 (mock s10 "Why these?") — the AI rationale is on-demand, not
  // ambient: a quiet button reveals it (ready state only).
  const [showWhy, setShowWhy] = useState(false);

  if (state.prepick === "picking" && stalled) {
    return (
      <div className="qz-rb-banner is-weak qz-gf-banner" role="status">
        <span className="qz-rb-banner-icon" aria-hidden>◷</span>
        <div className="qz-rb-banner-body">
          <div className="qz-rb-banner-head">
            <strong>This is taking longer than it should</strong>
          </div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            The product pick seems to have stalled. Re-run it, or choose your products below.
          </p>
        </div>
        <div className="qz-rb-banner-actions">
          <button type="button" className="qz-btn qz-btn-accent qz-btn-sm" disabled={retrying} onClick={onRetry}>
            {retrying ? "Restarting…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  if (state.prepick === "picking") {
    return (
      <div className="qz-rb-banner is-strong qz-gf-banner" role="status" aria-live="polite">
        <span className="qz-rb-banner-icon qz-gf-spark" aria-hidden>✦</span>
        <div className="qz-rb-banner-body">
          <div className="qz-rb-banner-head">
            <strong>Choosing the best products for your goal…</strong>
          </div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            {excerpt ? <>“{excerpt}” — </> : null}
            they&rsquo;ll appear here in a moment, ready to refine.
          </p>
        </div>
      </div>
    );
  }

  if (state.prepick === "failed") {
    return (
      <div className="qz-rb-banner is-weak qz-gf-banner" role="status">
        <span className="qz-rb-banner-icon" aria-hidden>!</span>
        <div className="qz-rb-banner-body">
          <div className="qz-rb-banner-head">
            <strong>Products weren&rsquo;t picked automatically</strong>
          </div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            {state.error ?? "We couldn't pick products for that goal — try again, or choose them below."}
          </p>
        </div>
        <div className="qz-rb-banner-actions">
          <button type="button" className="qz-btn qz-btn-accent qz-btn-sm" disabled={retrying} onClick={onRetry}>
            {retrying ? "Retrying…" : "Try again"}
          </button>
        </div>
      </div>
    );
  }

  // ready
  return (
    <div className="qz-rb-banner is-applied qz-gf-banner" role="status">
      <span className="qz-rb-banner-icon" aria-hidden><Check size={17} strokeWidth={2.6} /></span>
      <div className="qz-rb-banner-body">
        <div className="qz-rb-banner-head">
          <strong>
            {count > 0
              ? `AI picked ${count} recommendation${count === 1 ? "" : "s"} for your goal`
              : "AI picked recommendations for your goal"}
          </strong>
          {state.rationale ? (
            <button
              type="button"
              className="qz-rb-why"
              aria-expanded={showWhy}
              onClick={() => setShowWhy((v) => !v)}
            >
              Why these?
            </button>
          ) : null}
        </div>
        {showWhy && state.rationale ? (
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>{state.rationale}</p>
        ) : null}
        <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
          Refine the selection below, then generate your quiz.
        </p>
      </div>
    </div>
  );
}

