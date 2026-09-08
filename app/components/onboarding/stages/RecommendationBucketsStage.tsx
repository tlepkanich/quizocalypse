// Stage 1 (Recommendation Buckets) — the picker + the Results rail + the AI
// Picks pill, rebuilt to the Step-1 tweaks handoff (rev 2, verified against
// eaa4000; behaviour reference docs/design/step1/step1-tweaks.artifact.html).
//
// What changed, in one breath: four tabs (Products · Tags · Collections ·
// Custom) that print their OWN picks; a tab is a view, not a mode (switching
// never touches the selection — TabLockModal is gone); one-line rows with the
// count as the control; selected-first FROZEN order; a 25-row window that
// loads on scroll; a status filter on Products; a footer ledger; the rail is
// "Results" with a composition sub-line, Groups/Products sections, the
// deliverable count, a flash on add and a measured five-row fade; the AI
// (both the heuristic tip and the goal pre-pick) is ONE pill in the tab
// strip's corner opening the AI Picks dialog, whose Apply/Undo/Revert are
// scoped to the suggested TYPE; and the Custom tab creates groups through
// the shared group wizard.
//
// Every write is still one server intent (membership re-resolved server-side);
// the optimistic overlay mirrors it until the fetcher settles.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useFetcher } from "@remix-run/react";
import { Box, Check, FolderOpen, Play, Tag, Users, X } from "lucide-react";
import { QzCard, QzInput } from "../../qz";
import { QzModal, QzDrawer } from "../../qz-overlays";
import { DeviceFrame } from "../../builder/preview/DeviceFrame";
import { GroupWizard, type GroupWizardSubmit, type WizProduct } from "../../studio/GroupWizard";
import { useFunnelBar, type FunnelBarOverride } from "../funnelChrome";
import type { DesignTokens } from "../../../lib/quizSchema";
import { resolveDesignTokens, tokensToCssVars, suggestContrastText } from "../../../lib/designTokens";
import { googleFontsUrl } from "../../runtime/runtimeStyles";
import {
  SORT_LABEL,
  STATUS_LABEL,
  applyTyped,
  buildOrder,
  bulkPlan,
  defaultSortFor,
  deliverableCopy,
  idOf,
  ledgerHidden,
  noun,
  railComposition,
  revertTyped,
  sortsFor,
  statusKeeps,
  typedSelectionIs,
  visibleCards,
  type SortMode,
  type StatusFilter,
} from "../../../lib/bucketSelection";
import { type ActionResult, type BucketType, type FunnelData } from "./stagesShared";

// ── Stage 1 — Recommendation Buckets (the quiz's possible OUTCOMES) ───────────
type CatalogProduct = FunnelData["catalog"]["products"][number];

type BucketCard = {
  key: string;
  type: BucketType;
  name: string;
  count: number;
  thumbnailUrl: string | null;
  /** Products only — lower-cased Shopify status; null on a manual catalog. */
  status?: CatalogProduct["status"];
  /** Products only — the variant list on the first real option. */
  variants?: CatalogProduct["variants"];
  variantOption?: string | null;
  /** §02 item 6 — what the quiz will return; only known for server buckets. */
  deliverableCount?: number;
};

// Tab labels (§03): the Custom rename is tab-label ONLY — sentences keep
// saying "group" (TYPE_NOUN in bucketSelection).
const TAB_META: Array<{ type: BucketType; label: string }> = [
  { type: "product", label: "Products" },
  { type: "tag", label: "Tags" },
  { type: "collection", label: "Collections" },
  { type: "group", label: "Custom" },
];

// Window size (§03): 25 rows load; reaching the bottom loads 25 more.
const WINDOW = 25;
// The 5 s Undo (decision 2 — five ships unless the owner says otherwise).
const UNDO_MS = 5000;
// The rail cuts at the FIFTH real row (measured, not calculated).
const RAIL_ROWS = 5;

// The one-recommendation notice is OFF this screen (§08 advisories removed);
// its copy is preserved verbatim for the per-page AI surface.
export const ONE_RECOMMENDATION_NOTICE =
  "One recommendation means every shopper sees the same products. Add a few more so the quiz can actually differentiate.";

function BucketGlyph({ type, size = 18 }: { type: BucketType; size?: number }) {
  const Icon =
    type === "product" ? Box : type === "tag" ? Tag : type === "collection" ? FolderOpen : Users;
  return <Icon size={size} strokeWidth={1.8} aria-hidden />;
}

function useMoney(currency: string | null) {
  return useMemo(() => {
    if (currency) {
      try {
        const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
        return (v: number) => fmt.format(v);
      } catch {
        /* unknown code — fall through to the bare number */
      }
    }
    return (v: number) => v.toFixed(2);
  }, [currency]);
}

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
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search).trim().toLowerCase();
  const [sort, setSort] = useState<SortMode>(defaultSortFor(data.activeTab));
  const [status, setStatus] = useState<StatusFilter>("active");
  const [shown, setShown] = useState(WINDOW);
  // Overlays.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [removeWarn, setRemoveWarn] = useState<BucketCard | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    body: string;
    yes: string;
    run: () => void;
    /** "ai" — Cancel returns to the AI Picks dialog, not the page. */
    back?: "ai";
  } | null>(null);
  const [peek, setPeek] = useState<{ card: BucketCard; back: "ai" | null } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Start-routing spec §1 — Continue opens the "How do you want to start?"
  // intercept (decider drafts only). Dismissal returns here unchanged.
  const [interceptOpen, setInterceptOpen] = useState(false);
  const isDecider = data.logicModel === "decider";
  const goalFirst = data.goalFirst;
  const prepickBusy = goalFirst?.prepick === "picking";
  const templateFirst = data.templateFirst;
  const referencedSet = useMemo(() => new Set(data.referencedKeys), [data.referencedKeys]);
  const money = useMoney(data.catalog.currency);

  // ── the catalog as cards ──────────────────────────────────────────────────
  const productById = useMemo(
    () => new Map(data.catalog.products.map((p) => [p.id, p])),
    [data.catalog.products],
  );
  const groupById = useMemo(
    () => new Map(data.catalog.groups.map((g) => [g.key, g])),
    [data.catalog.groups],
  );
  const cardFor = useCallback(
    (type: BucketType, key: string): BucketCard => {
      if (type === "product") {
        const p = productById.get(key);
        return {
          key,
          type,
          name: p?.title ?? key,
          count: 1,
          thumbnailUrl: p?.imageUrl ?? null,
          status: p?.status ?? null,
          variants: p?.variants ?? [],
          variantOption: p?.variantOption ?? null,
        };
      }
      if (type === "group") {
        const g = groupById.get(key);
        return { key, type, name: g?.label ?? key, count: g?.count ?? 0, thumbnailUrl: null };
      }
      const src = type === "tag" ? data.catalog.tags : data.catalog.collections;
      const g = src.find((x) => x.key === key);
      return { key, type, name: g?.label ?? key, count: g?.count ?? 0, thumbnailUrl: null };
    },
    [productById, groupById, data.catalog.tags, data.catalog.collections],
  );
  const cardsByTab = useMemo<Record<BucketType, BucketCard[]>>(
    () => ({
      product: data.catalog.products.map((p) => cardFor("product", p.id)),
      tag: data.catalog.tags.map((t) => cardFor("tag", t.key)),
      collection: data.catalog.collections.map((c) => cardFor("collection", c.key)),
      group: data.catalog.groups.map((g) => cardFor("group", g.key)),
    }),
    [data.catalog, cardFor],
  );
  const totals: Record<BucketType, number> = {
    product: cardsByTab.product.length,
    tag: cardsByTab.tag.length,
    collection: cardsByTab.collection.length,
    group: cardsByTab.group.length,
  };

  // ── selection: server buckets + the optimistic overlay ────────────────────
  const [overlay, setOverlay] = useState<Map<string, BucketCard | null>>(() => new Map());
  useEffect(() => {
    if (fetcher.state === "idle") setOverlay(new Map());
  }, [fetcher.state, data.buckets]);

  const selected = useMemo(() => {
    const m = new Map<string, BucketCard>();
    for (const b of data.buckets) {
      m.set(idOf(b.type, b.key), {
        ...cardFor(b.type, b.key),
        name: b.name,
        count: b.count,
        deliverableCount: b.deliverableCount,
        thumbnailUrl: b.type === "product" ? b.thumbnailUrl : null,
      });
    }
    for (const [id, card] of overlay) {
      if (card === null) m.delete(id);
      else m.set(id, card);
    }
    return m;
  }, [data.buckets, overlay, cardFor]);
  const selectedList = useMemo(() => [...selected.values()], [selected]);
  const isOn = useCallback((id: string) => selected.has(id), [selected]);
  const overlaySet = (id: string, val: BucketCard | null) =>
    setOverlay((prev) => new Map(prev).set(id, val));

  // ── AI Picks (§05): ONE pill for the heuristic tip AND the goal pre-pick ──
  // The heuristic (bucketDetect) earns its place only when the grouping choice
  // is genuinely ambiguous; the goal pre-pick always shows (it has a lifecycle).
  const tipEligible =
    data.catalog.products.length >= 20 &&
    (data.catalog.collections.length >= 2 || data.catalog.tags.length >= 5);
  const aiPicks = useMemo<{ type: BucketType; keys: string[] } | null>(() => {
    if (goalFirst?.picks && goalFirst.picks.keys.length) return goalFirst.picks;
    // A pre-pick still running / failed owns the corner (its lifecycle
    // states); a READY one from before picks were held falls back to the
    // heuristic — the pill must not attribute those to the goal.
    if (goalFirst && goalFirst.prepick !== "ready") return null;
    const apply = data.suggestion.apply;
    if (apply && tipEligible && apply.keys.length) return { type: apply.type, keys: apply.keys };
    return null;
  }, [goalFirst, data.suggestion.apply, tipEligible]);
  const picksFromGoal = Boolean(goalFirst?.picks && goalFirst.picks.keys.length);
  const aiApplied = aiPicks ? typedSelectionIs(selectedList, aiPicks.type, aiPicks.keys) : false;
  // The prior keys of the suggested type, kept as long as the picks stay
  // applied (Revert) — explicitly SESSION-scoped (decision: not persisted).
  const [aiPrior, setAiPrior] = useState<{ type: BucketType; keys: string[] } | null>(null);
  const [undoLive, setUndoLive] = useState(false);
  const undoTimer = useRef<number | null>(null);
  const clearUndo = useCallback(() => {
    if (undoTimer.current != null) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoLive(false);
  }, []);
  // Armed ONCE at the apply, never in render (an immortal window otherwise).
  const armUndo = useCallback(() => {
    clearUndo();
    setUndoLive(true);
    undoTimer.current = window.setTimeout(() => setUndoLive(false), UNDO_MS);
  }, [clearUndo]);
  useEffect(() => () => clearUndo(), [clearUndo]);

  // ── the frozen order (§03) ────────────────────────────────────────────────
  const [order, setOrder] = useState<string[] | null>(null);
  const rebuildOrder = useCallback(
    (tab: BucketType, mode: SortMode) =>
      setOrder(buildOrder(cardsByTab[tab], isOn, mode)),
    [cardsByTab, isOn],
  );
  // The order is rebuilt on load and when the CATALOG's identity changes (a
  // resync, a group created) — never on the loader revalidation every toggle
  // triggers, or "frozen between rebuilds" would mean nothing.
  const catalogKey = useMemo(
    () => (Object.keys(cardsByTab) as BucketType[]).map((t) => cardsByTab[t].map((c) => c.key).join("|")).join("\n"),
    [cardsByTab],
  );
  useEffect(() => {
    setOrder(
      buildOrder(cardsByTab[activeTab], (id) => data.buckets.some((b) => idOf(b.type, b.key) === id), sort),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogKey]);

  const [justAdded, setJustAdded] = useState<string | null>(null);

  // One toggle = one optimistic overlay write + one server write. The grid row
  // and the rail row share this, so removing in either place is the same op.
  const doToggle = (card: BucketCard) => {
    const id = idOf(card.type, card.key);
    const on = !isOn(id);
    overlaySet(id, on ? card : null);
    setJustAdded(on ? id : null);
    clearUndo();
    fetcher.submit(
      { intent: "toggle-bucket", type: card.type, key: card.key, on: String(on) },
      { method: "post" },
    );
  };
  // §6 downstream integrity — removing a selection the draft's questions/rules
  // already reference gets a warn-first confirm.
  const toggle = (card: BucketCard) => {
    const id = idOf(card.type, card.key);
    if (isOn(id) && referencedSet.has(id)) {
      setRemoveWarn(card);
      return;
    }
    doToggle(card);
  };

  // A tab is a VIEW, not a mode: switching keeps every pick.
  const switchTab = (type: BucketType) => {
    if (type === activeTab) return;
    const nextSort = sortsFor(type).includes(sort) ? sort : defaultSortFor(type);
    setActiveTab(type);
    setSort(nextSort);
    setSearch("");
    resetWindow();
    setOrder(buildOrder(cardsByTab[type], isOn, nextSort));
    fetcher.submit({ intent: "switch-tab", type }, { method: "post" });
  };

  // §05 — Apply replaces ONE type's half of the selection; Undo and Revert
  // restore that type's prior keys and leave everything else alone.
  const setTyped = (type: BucketType, keys: string[], nextCards: BucketCard[]) => {
    setOverlay((prev) => {
      const next = new Map(prev);
      for (const c of selectedList) if (c.type === type) next.set(idOf(c.type, c.key), null);
      for (const c of nextCards) next.set(idOf(c.type, c.key), c);
      return next;
    });
    fetcher.submit({ intent: "set-buckets", type, keys: keys.join(",") }, { method: "post" });
  };
  const doApply = () => {
    if (!aiPicks) return;
    const prior = selectedList.filter((c) => c.type === aiPicks.type).map((c) => c.key);
    setAiPrior({ type: aiPicks.type, keys: prior });
    const nextCards = aiPicks.keys.map((k) => cardFor(aiPicks.type, k));
    setTyped(aiPicks.type, aiPicks.keys, nextCards);
    // Applying force-switches the picker to the suggested type and clears the search.
    setActiveTab(aiPicks.type);
    setSort(sortsFor(aiPicks.type).includes(sort) ? sort : defaultSortFor(aiPicks.type));
    setSearch("");
    resetWindow();
    setOrder(
      buildOrder(
        cardsByTab[aiPicks.type],
        (id) => applyTyped(selectedList, aiPicks.type, nextCards).some((c) => idOf(c.type, c.key) === id),
        sortsFor(aiPicks.type).includes(sort) ? sort : defaultSortFor(aiPicks.type),
      ),
    );
    setJustAdded(null);
    setAiOpen(false);
    armUndo();
  };
  const applyPicks = () => {
    if (!aiPicks) return;
    const priorOfType = selectedList.filter((c) => c.type === aiPicks.type);
    // The Override confirm fires on an existing selection OF THE TYPE being
    // applied — never on any selection.
    if (priorOfType.length > 0 && !aiApplied) {
      const otherN = selectedList.length - priorOfType.length;
      const n = priorOfType.length;
      const referenced = priorOfType.filter((c) => referencedSet.has(idOf(c.type, c.key))).length;
      setAiOpen(false);
      setConfirm({
        title: "Override and continue?",
        body:
          `${n} ${noun(aiPicks.type, n)} ${n === 1 ? "is" : "are"} already selected, and applying replaces ${n === 1 ? "it" : "them"}.` +
          (otherN ? ` Your ${otherN} other ${noun("product", otherN) === "product" ? "recommendation" : "recommendations"} stay${otherN === 1 ? "s" : ""}.` : "") +
          (referenced ? ` ${referenced} of ${n === 1 ? "it" : "them"} ${referenced === 1 ? "is" : "are"} already used by your questions — the Questions step will flag anything that breaks.` : "") +
          " You can revert from this dialog afterwards.",
        yes: "Override and continue",
        run: doApply,
        back: "ai",
      });
      return;
    }
    doApply();
  };
  const revertPicks = () => {
    if (!aiPrior) return;
    clearUndo();
    const priorCards = aiPrior.keys.map((k) => cardFor(aiPrior.type, k));
    const nextSelection = revertTyped(selectedList, aiPrior.type, priorCards);
    setTyped(aiPrior.type, aiPrior.keys, priorCards);
    setAiPrior(null);
    setAiOpen(false);
    setOrder(
      buildOrder(
        cardsByTab[activeTab],
        (id) => nextSelection.some((c) => idOf(c.type, c.key) === id),
        sort,
      ),
    );
  };

  // H4 a11y — roving-tabindex arrow-key navigation for the bucket-source
  // tablist (ARIA tablist keyboard pattern, MANUAL activation).
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

  // ── the visible list ──────────────────────────────────────────────────────
  const keep = useCallback(
    (c: BucketCard) =>
      c.type !== "product" || statusKeeps(status, c.status ?? null, isOn(idOf(c.type, c.key))),
    [status, isOn],
  );
  const visible = useMemo(
    () => visibleCards(cardsByTab[activeTab], order, q, sort, keep),
    [cardsByTab, activeTab, order, q, sort, keep],
  );
  const windowed = visible.slice(0, shown);
  const plan = bulkPlan(windowed, isOn);
  const statusCounts = useMemo(() => {
    let draft = 0;
    let archived = 0;
    for (const p of data.catalog.products) {
      if (p.status === "draft") draft++;
      else if (p.status === "archived") archived++;
    }
    return { draft, archived };
  }, [data.catalog.products]);
  const hasStatuses = data.catalog.products.some((p) => p.status !== null);

  const listRef = useRef<HTMLDivElement>(null);
  // The window resets on a tab change, a new search, a sort change and a
  // status change — and the list scrolls back to the top with it, or a list
  // still sitting at its bottom re-fires the scroll-load on the next render.
  const resetWindow = useCallback(() => {
    setShown(WINDOW);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, []);
  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 160) return;
    if (shown >= visible.length) return;
    setShown((n) => n + WINDOW);
  };

  // Select all / Clear all — one control, always confirms, acts on the LOADED
  // window and counts what will actually change (§03).
  const bulk = () => {
    if (windowed.length === 0) return;
    const more = visible.length - windowed.length;
    const scope = more > 0 ? ` That is everything currently shown — scroll the list to reach the other ${more}.` : "";
    const matching = q ? ` Only the rows matching “${search.trim()}” — not the whole tab.` : "";
    const done = () => {
      clearUndo();
      setJustAdded(null);
    };
    if (plan.mode === "clear") {
      const referenced = plan.cards.filter((c) => referencedSet.has(idOf(c.type, c.key))).length;
      const n = plan.cards.length;
      setConfirm({
        title: `Remove ${n} ${noun(activeTab, n)}?`,
        body:
          "They stop being results this quiz can return." +
          matching +
          scope +
          (referenced
            ? ` ${referenced} of them ${referenced === 1 ? "is" : "are"} already used by your questions — the Questions step will flag anything that breaks.`
            : ""),
        yes: `Remove ${n}`,
        run: () => {
          setOverlay((prev) => {
            const next = new Map(prev);
            for (const c of plan.cards) next.set(idOf(c.type, c.key), null);
            return next;
          });
          fetcher.submit(
            { intent: "clear-visible", type: activeTab, keys: plan.cards.map((c) => c.key).join(",") },
            { method: "post" },
          );
          done();
        },
      });
      return;
    }
    const n = plan.cards.length;
    setConfirm({
      title: `Add ${n} ${noun(activeTab, n)}?`,
      body: "Each one becomes a result this quiz can return." + matching + scope,
      yes: `Add ${n}`,
      run: () => {
        setOverlay((prev) => {
          const next = new Map(prev);
          for (const c of plan.cards) next.set(idOf(c.type, c.key), c);
          return next;
        });
        fetcher.submit(
          { intent: "select-all", type: activeTab, keys: plan.cards.map((c) => c.key).join(",") },
          { method: "post" },
        );
        done();
      },
    });
  };

  // ── Custom tab: the group wizard ──────────────────────────────────────────
  const wizProducts = useMemo<WizProduct[]>(
    () =>
      data.catalog.products.map((p) => ({
        id: p.id,
        title: p.title,
        imageUrl: p.imageUrl,
        tags: p.tags,
        collectionIds: p.collectionIds,
        metafieldValues: p.metafieldValues,
      })),
    [data.catalog.products],
  );
  const wizTags = useMemo(
    () => [...new Set(data.catalog.products.flatMap((p) => p.tags))].sort(),
    [data.catalog.products],
  );
  const submitGroup: GroupWizardSubmit = (payload) => {
    fetcher.submit(
      {
        intent: "create-group",
        name: payload.name,
        description: payload.description,
        membership: JSON.stringify(payload.membership),
        persona: payload.persona ? JSON.stringify(payload.persona) : "",
      },
      { method: "post" },
    );
    setWizardOpen(false);
  };
  // The created group lands through the loader; flash its row on the Custom tab.
  const handledGroup = useRef<string | null>(null);
  useEffect(() => {
    const r = result as (ActionResult & { groupId?: string; added?: boolean }) | null;
    if (!r || r.intent !== "create-group" || !r.ok || !r.groupId) return;
    if (handledGroup.current === r.groupId) return;
    handledGroup.current = r.groupId;
    setActiveTab("group");
    setSort(defaultSortFor("group"));
    setSearch("");
    resetWindow();
    if (r.added) setJustAdded(idOf("group", r.groupId));
  }, [result, resetWindow]);

  // ── Continue (the funnel bar) ─────────────────────────────────────────────
  const count = selectedList.length;
  const continuing = pendingIntent === "continue-buckets";
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

  // QRTZ-G1 — speculative question-gen prefetch once the pool settles (5s).
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

  // ── the rail: measured five-row cut + the landed flash ───────────────────
  const railListRef = useRef<HTMLDivElement>(null);
  const [railMax, setRailMax] = useState<number | null>(null);
  const { groups: railGroups, products: railProducts } = railComposition(selectedList);
  useEffect(() => {
    const rl = railListRef.current;
    if (!rl) {
      setRailMax(null);
      return;
    }
    const rows = rl.querySelectorAll<HTMLElement>(".qz-rb-rail-row");
    if (rows.length <= RAIL_ROWS) {
      setRailMax(null);
      return;
    }
    const fifth = rows[RAIL_ROWS - 1]!;
    setRailMax(fifth.getBoundingClientRect().bottom - rl.getBoundingClientRect().top);
  }, [selectedList.length, railGroups.length, railProducts.length]);
  useEffect(() => {
    if (!justAdded) return;
    const rl = railListRef.current;
    const el = rl?.querySelector<HTMLElement>(`[data-row="${CSS.escape(justAdded)}"]`);
    if (rl && el) {
      // scrollTop on the rail list directly — scrollIntoView moves the page too.
      const lr = rl.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      if (er.top < lr.top) rl.scrollTop += er.top - lr.top;
      else if (er.bottom > lr.bottom) rl.scrollTop += er.bottom - lr.bottom;
    }
    const t = window.setTimeout(() => setJustAdded(null), 1600);
    return () => window.clearTimeout(t);
  }, [justAdded]);

  // ── the AI pill ───────────────────────────────────────────────────────────
  const retrying = pendingIntent === "retry-gen";
  const onRetry = () => fetcher.submit({ intent: "retry-gen" }, { method: "post" });
  const aiPill = (() => {
    if (goalFirst?.prepick === "picking" && data.genStalled) {
      return (
        <div className="qz-rb-aicorner">
          <span className="qz-rb-aipill is-warn" role="status">
            <span aria-hidden>◷</span> This is taking longer than it should.
          </span>
          <button type="button" className="qz-btn qz-btn-sm" disabled={retrying} onClick={onRetry}>
            {retrying ? "Restarting…" : "Try again"}
          </button>
        </div>
      );
    }
    if (goalFirst?.prepick === "picking") {
      return (
        <div className="qz-rb-aicorner">
          <span className="qz-rb-aipill is-busy" role="status" aria-live="polite">
            <span className="qz-rb-spark" aria-hidden>✦</span> Choosing recommendations for your goal…{" "}
            <b>your picks are kept</b>.
          </span>
        </div>
      );
    }
    if (goalFirst?.prepick === "failed") {
      return (
        <div className="qz-rb-aicorner">
          <span className="qz-rb-aipill is-warn" role="status">
            <span aria-hidden>⚠</span> We couldn&rsquo;t pick these automatically — choose below.
          </span>
          <button type="button" className="qz-btn qz-btn-sm" disabled={retrying} onClick={onRetry}>
            {retrying ? "Retrying…" : "Try again"}
          </button>
        </div>
      );
    }
    if (!aiPicks) return null;
    const n = aiPicks.keys.length;
    // Undo is a SIBLING, never nested inside the pill.
    return (
      <div className="qz-rb-aicorner">
        <button
          type="button"
          className="qz-rb-aipill"
          onClick={() => setAiOpen(true)}
          aria-haspopup="dialog"
        >
          <span className="qz-rb-spark" aria-hidden>✦</span>
          {aiApplied ? `Applied ${n}` : `AI picked ${n}`}
        </button>
        {undoLive && aiPrior ? (
          <button type="button" className="qz-rb-aiundo" onClick={revertPicks}>
            Undo
          </button>
        ) : null}
      </div>
    );
  })();

  const openPeek = (card: BucketCard, back: "ai" | null = null) => {
    if (back === "ai") setAiOpen(false);
    setPeek({ card, back });
  };
  const closePeek = () => {
    const back = peek?.back ?? null;
    setPeek(null);
    if (back === "ai") setAiOpen(true);
  };

  const activeNoun = noun(activeTab, 2);
  const emptyCopy = q
    ? "No matches."
    : activeTab === "group"
      ? "No groups yet — create one above."
      : activeTab === "product" && status !== "all" && data.catalog.products.length > 0
        ? `No ${STATUS_LABEL[status].toLowerCase()} products.`
        : "Nothing here yet — sync your catalog to populate this tab.";
  const ledger = hasStatuses && activeTab === "product" ? ledgerHidden(status, statusCounts) : [];

  return (
    <div className="qz-rb">
      <div className="qz-rb-titlerow">
        <h2 className="qz-h2" style={{ margin: 0 }}>
          What should this quiz recommend?
        </h2>
      </div>

      {templateFirst ? (
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
          <QzCard flush className="qz-rb-browser">
            {/* tabs + the AI corner */}
            <div className="qz-rb-panehd">
              <div
                className="qz-rb-tabs"
                role="tablist"
                aria-label="Recommendation type"
                ref={tablistRef}
                onKeyDown={onTabKeyDown}
              >
                {TAB_META.map((t) => {
                  const on = t.type === activeTab;
                  const sn = selectedList.filter((c) => c.type === t.type).length;
                  const total = totals[t.type];
                  return (
                    <button
                      key={t.type}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      tabIndex={on ? 0 : -1}
                      aria-label={`${t.label}, ${total} available${sn ? `, ${sn} selected` : ""}`}
                      className={`qz-rb-tab${on ? " is-active" : ""}`}
                      onClick={() => switchTab(t.type)}
                    >
                      {t.label}
                      {sn ? <span className="qz-rb-tab-n">{sn}</span> : null}
                    </button>
                  );
                })}
              </div>
              {aiPill}
            </div>

            {/* the ONE narrowing line — group tabs only (decision 6 rewording) */}
            {activeTab !== "product" ? (
              <div className="qz-rb-narrow">
                <span className="qz-rb-narrow-ic" aria-hidden>⌥</span>
                <span>A group is the starting set — a later question can narrow one that holds several products.</span>
                <button type="button" className="qz-rb-narrow-link" onClick={() => setHowOpen(true)}>
                  How narrowing works →
                </button>
              </div>
            ) : null}

            <div className="qz-rb-toolbar">
              <QzInput
                type="search"
                placeholder={`Search ${activeNoun}…`}
                value={search}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setSearch(v);
                  resetWindow();
                  if (!v.trim()) rebuildOrder(activeTab, sort);
                }}
                aria-label="Search the catalog"
              />
              <select
                className="qz-select qz-rb-sortsel"
                aria-label="Sort"
                value={sort}
                onChange={(e) => {
                  const m = e.currentTarget.value as SortMode;
                  setSort(m);
                  resetWindow();
                  rebuildOrder(activeTab, m);
                }}
              >
                {sortsFor(activeTab).map((m) => (
                  <option key={m} value={m}>
                    {SORT_LABEL[m]}
                  </option>
                ))}
              </select>
              {activeTab === "product" && hasStatuses ? (
                <select
                  className="qz-select qz-rb-statsel"
                  aria-label="Status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.currentTarget.value as StatusFilter);
                    resetWindow();
                    rebuildOrder(activeTab, sort);
                  }}
                >
                  {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((k) => (
                    <option key={k} value={k}>
                      {STATUS_LABEL[k]}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                className="qz-rb-selall"
                onClick={bulk}
                disabled={windowed.length === 0}
                aria-label={`${plan.mode === "clear" ? "Clear the" : "Select the"} ${windowed.length} ${noun(activeTab, windowed.length)} shown`}
              >
                {plan.mode === "clear" ? "Clear all" : "Select all"}
              </button>
            </div>

            <div className="qz-rb-grid" ref={listRef} onScroll={onListScroll}>
              {activeTab === "group" && !q ? (
                <button type="button" className="qz-rb-newgrp" onClick={() => setWizardOpen(true)}>
                  <span className="qz-rb-newgrp-plus" aria-hidden>+</span>
                  <span className="qz-rb-newgrp-body">
                    New group
                    <small>Combine tags, collections or hand-picked products into one result</small>
                  </span>
                </button>
              ) : null}
              {windowed.length === 0 ? (
                <div className="qz-rb-empty qz-dim">{emptyCopy}</div>
              ) : (
                windowed.map((c) => {
                  const id = idOf(c.type, c.key);
                  const on = isOn(id);
                  const right =
                    c.type === "product" ? (
                      c.variants && c.variants.length ? (
                        <button
                          type="button"
                          className="qz-rb-vars"
                          onClick={(event) => {
                            event.stopPropagation();
                            openPeek(c);
                          }}
                          aria-label={`View the ${c.variants.length} variants of ${c.name}`}
                        >
                          <b>{c.variantOption}</b> · {c.variants.map((v) => v.value).join(", ")}
                        </button>
                      ) : (
                        <span className="qz-rb-vars is-none" />
                      )
                    ) : (
                      <span className="qz-rb-vars is-grp">
                        Group of{" "}
                        <button
                          type="button"
                          className="qz-rb-cntb"
                          onClick={(event) => {
                            event.stopPropagation();
                            openPeek(c);
                          }}
                          aria-label={`View the ${c.count} ${c.count === 1 ? "product" : "products"} in ${c.name}`}
                        >
                          {c.count} product{c.count === 1 ? "" : "s"}
                        </button>
                      </span>
                    );
                  return (
                    // A picker row is role="checkbox", NOT a <button>: it
                    // contains the count/variants button, and nested
                    // interactive elements break the parser (§10, hit thrice).
                    <div
                      key={id}
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
                      </span>
                      {c.type === "product" && c.status && c.status !== "active" ? (
                        <span className={`qz-rb-stat is-${c.status}`}>{c.status}</span>
                      ) : null}
                      {right}
                    </div>
                  );
                })
              )}
              {shown < visible.length ? (
                // The keyboard/AT route past row 25 — scroll-loading never
                // fires from focus movement.
                <button
                  type="button"
                  className="qz-rb-loadmore"
                  onClick={() => setShown((n) => n + WINDOW)}
                >
                  Show {Math.min(WINDOW, visible.length - shown)} more
                </button>
              ) : null}
            </div>

            <div className="qz-rb-listfoot" aria-live="polite">
              <span>
                Showing <b>{windowed.length}</b> of <b>{visible.length}</b>
                {q ? " matching" : ""}
                {activeTab === "product" && hasStatuses && status !== "all"
                  ? ` ${STATUS_LABEL[status].toLowerCase()}`
                  : ""}
                {ledger.length ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="qz-rb-archtog"
                      onClick={() => {
                        setStatus("all");
                        resetWindow();
                        rebuildOrder(activeTab, sort);
                      }}
                    >
                      {ledger.join(", ")} not shown
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          </QzCard>
        </div>

        {/* §04 — the Results rail (sticky) */}
        <aside className="qz-rb-rail" aria-label="Results this quiz can return">
          <div className="qz-rb-rail-head">
            <span className="qz-rb-rail-title">
              <strong>Results</strong>
              {count ? (
                <span className="qz-rb-rail-sub">
                  {railGroups.length ? (
                    <>
                      <b>{railGroups.length}</b> group{railGroups.length === 1 ? "" : "s"}
                    </>
                  ) : null}
                  {railGroups.length && railProducts.length ? " · " : ""}
                  {railProducts.length ? (
                    <>
                      <b>{railProducts.length}</b> product{railProducts.length === 1 ? "" : "s"}
                    </>
                  ) : null}
                </span>
              ) : null}
            </span>
            <span className="qz-rb-count">{count}</span>
          </div>
          {count === 0 ? (
            <div className="qz-rb-rail-empty">
              <div className="qz-rb-rail-empty-ic" aria-hidden>🗂️</div>
              <p>Nothing added yet — click a row to add it.</p>
            </div>
          ) : (
            <div
              className={`qz-rb-rail-list${railMax ? " is-fade" : ""}`}
              ref={railListRef}
              style={railMax ? { maxHeight: railMax } : undefined}
            >
              {[
                { label: "Groups", items: railGroups },
                { label: "Products", items: railProducts },
              ]
                .filter((s) => s.items.length)
                .map((section, _i, secs) => (
                  <div key={section.label} className="qz-rb-rail-sec">
                    {secs.length > 1 ? (
                      <div className="qz-rb-rail-seclab">
                        {section.label}
                        <span>{section.items.length}</span>
                      </div>
                    ) : null}
                    {section.items.map((c) => {
                      const id = idOf(c.type, c.key);
                      return (
                        // A div role="button", never a <button>: it contains the ✕.
                        <div
                          key={id}
                          data-row={id}
                          role="button"
                          tabIndex={0}
                          aria-label={`View ${c.name}`}
                          className={`qz-rb-rail-row${justAdded === id ? " is-new" : ""}`}
                          onClick={() => openPeek(c)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            openPeek(c);
                          }}
                        >
                          <span className="qz-rb-chip-thumb">
                            {c.type === "product" && c.thumbnailUrl ? (
                              <img src={c.thumbnailUrl} alt="" loading="lazy" />
                            ) : (
                              <BucketGlyph type={c.type} size={14} />
                            )}
                          </span>
                          <span className="qz-rb-chip-body">
                            <span className="qz-rb-chip-name">{c.name}</span>
                            {c.type !== "product" ? (
                              <span className="qz-rb-card-meta qz-dim">
                                {deliverableCopy(c.deliverableCount ?? c.count, c.count)}
                              </span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            className="qz-rb-chip-x"
                            aria-label={`Remove ${c.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggle(c);
                            }}
                          >
                            <X size={13} aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
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
      {confirm ? (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          yes={confirm.yes}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            c.run();
          }}
          onCancel={() => {
            const back = confirm.back;
            setConfirm(null);
            if (back === "ai") setAiOpen(true);
          }}
        />
      ) : null}
      {aiOpen && aiPicks ? (
        <AiPicksModal
          picks={aiPicks.keys.map((k) => cardFor(aiPicks.type, k))}
          type={aiPicks.type}
          subline={
            picksFromGoal && data.goal?.goal_text
              ? `Based on “${(data.goal.goal_text.split("\n")[0] ?? "").slice(0, 140)}”`
              : data.suggestion.message
          }
          rationale={picksFromGoal ? goalFirst?.rationale : data.suggestion.reason}
          applied={aiApplied}
          canRevert={aiApplied && aiPrior !== null}
          onApply={applyPicks}
          onRevert={revertPicks}
          onPeek={(card) => openPeek(card, "ai")}
          onClose={() => setAiOpen(false)}
        />
      ) : null}
      {howOpen ? <NarrowingModal onClose={() => setHowOpen(false)} /> : null}
      {previewOpen && count > 0 ? (
        <ResultsPreviewDrawer
          selections={selectedList}
          products={data.catalog.products}
          groups={data.catalog.groups}
          money={money}
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
      {peek ? (
        <BucketProductsModal
          bucket={peek.card}
          products={data.catalog.products}
          groups={data.catalog.groups}
          money={money}
          onClose={closePeek}
        />
      ) : null}
      <GroupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        tags={wizTags}
        collections={data.collections.map((c) => ({ id: c.collectionId, title: c.title }))}
        metafieldConditions={data.catalog.metafieldConditions}
        products={wizProducts}
        onSubmit={submitGroup}
      />
    </div>
  );
}

// ── members of a bucket, client-side from the catalog ───────────────────────
function membersOf(
  bucket: BucketCard,
  products: FunnelData["catalog"]["products"],
  groups: FunnelData["catalog"]["groups"],
): FunnelData["catalog"]["products"] {
  if (bucket.type === "tag") return products.filter((p) => p.tagKeys.includes(bucket.key));
  if (bucket.type === "collection")
    return products.filter((p) => p.collectionIds.includes(bucket.key));
  if (bucket.type === "group") {
    const ids = new Set(groups.find((g) => g.key === bucket.key)?.productIds ?? []);
    return products.filter((p) => ids.has(p.id));
  }
  return products.filter((p) => p.id === bucket.key);
}

// The row preview: a group's members with prices, or a product's variants
// with per-variant stock (§03 — display only; the engine does not read
// oos_behavior yet, §12).
function BucketProductsModal({
  bucket,
  products,
  groups,
  money,
  onClose,
}: {
  bucket: BucketCard;
  products: FunnelData["catalog"]["products"];
  groups: FunnelData["catalog"]["groups"];
  money: (v: number) => string;
  onClose: () => void;
}) {
  if (bucket.type === "product") {
    const p = products.find((x) => x.id === bucket.key);
    const vs = p?.variants ?? [];
    return (
      <QzModal
        open
        onClose={onClose}
        size="md"
        title={
          <span className="qz-rb-modal-title">
            <span className="qz-rb-modal-icon"><BucketGlyph type="product" size={17} /></span>
            <span className="qz-rb-modal-copy">
              <span>{bucket.name}</span>
              <span className="qz-rb-modal-meta">
                {vs.length
                  ? `${vs.length} variants pulled in from Shopify`
                  : "One variant — no options set"}
              </span>
            </span>
          </span>
        }
        footer={<button type="button" className="qz-btn qz-btn-accent" onClick={onClose}>Done</button>}
      >
        {vs.length ? (
          <div className="qz-rb-product-list">
            {vs.map((v) => (
              <div key={v.value} className="qz-rb-product-row">
                <span className="qz-rb-product-copy">
                  <strong>
                    {v.name}: {v.value}
                  </strong>
                </span>
                <span className={`qz-rb-stock${v.available ? "" : " is-out"}`}>
                  {v.available ? "In stock" : "Sold out"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            This product has a single variant, so there is nothing for a later question to
            choose between.
          </p>
        )}
      </QzModal>
    );
  }
  const members = membersOf(bucket, products, groups);
  const kind = bucket.type === "collection" ? "collection" : bucket.type === "tag" ? "tag" : "group";
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="qz-rb-modal-title">
          <span className="qz-rb-modal-icon"><BucketGlyph type={bucket.type} size={17} /></span>
          <span className="qz-rb-modal-copy">
            <span>{bucket.name}</span>
            <span className="qz-rb-modal-meta">
              {members.length} product{members.length === 1 ? "" : "s"} in this {kind}
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
              <span className="qz-dim">{product.price != null ? money(product.price) : "Price unavailable"}</span>
            </span>
            {product.status && product.status !== "active" ? (
              <span className={`qz-rb-stat is-${product.status}`}>{product.status}</span>
            ) : null}
          </div>
        )) : <p className="qz-dim" style={{ margin: 0 }}>No matching products are currently available.</p>}
      </div>
    </QzModal>
  );
}

// §05 — the AI Picks dialog. Titled AI Picks, sub-lined with the provenance;
// each row's count opens its members (a count of one shows nothing); Apply →
// Applied (disabled) with Revert beside it while the picks are still the
// selected picks AND a session snapshot exists.
function AiPicksModal({
  picks,
  type,
  subline,
  rationale,
  applied,
  canRevert,
  onApply,
  onRevert,
  onPeek,
  onClose,
}: {
  picks: BucketCard[];
  type: BucketType;
  subline: string;
  rationale?: string;
  applied: boolean;
  canRevert: boolean;
  onApply: () => void;
  onRevert: () => void;
  onPeek: (card: BucketCard) => void;
  onClose: () => void;
}) {
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="qz-rb-modal-title">
          <span className="qz-rb-modal-icon" aria-hidden>✦</span>
          <span className="qz-rb-modal-copy">
            <span>AI Picks</span>
            <span className="qz-rb-modal-meta qz-rb-modal-goal">{subline}</span>
          </span>
        </span>
      }
      footer={
        <div className="qz-row" style={{ width: "100%", gap: 8 }}>
          {canRevert ? (
            <button type="button" className="qz-btn" onClick={onRevert}>
              Revert
            </button>
          ) : null}
          <span style={{ marginLeft: "auto" }} />
          <button type="button" className="qz-btn qz-btn-accent" disabled={applied} onClick={onApply}>
            {applied ? "Applied" : "Apply"}
          </button>
        </div>
      }
    >
      <div className="qz-rb-airows">
        {picks.map((c) => (
          <div key={c.key} className="qz-rb-airow">
            <span className="qz-rb-airow-ic"><BucketGlyph type={type} size={12} /></span>
            <span className="qz-rb-airow-name">{c.name}</span>
            {c.count > 1 ? (
              <button
                type="button"
                className="qz-rb-cntb"
                onClick={() => onPeek(c)}
                aria-label={`View the ${c.count} products in ${c.name}`}
              >
                {c.count} products
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {rationale ? (
        <p className="qz-dim" style={{ margin: "12px 0 0", fontSize: 13 }}>{rationale}</p>
      ) : null}
    </QzModal>
  );
}

// The narrowing explainer (§03 — the one genuinely new element).
function NarrowingModal({ onClose }: { onClose: () => void }) {
  return (
    <QzModal
      open
      onClose={onClose}
      size="md"
      title={
        <span className="qz-rb-modal-title">
          <span className="qz-rb-modal-icon" aria-hidden>⌥</span>
          <span className="qz-rb-modal-copy">
            <span>How narrowing works</span>
            <span className="qz-rb-modal-meta">A group is the starting set, not the final list.</span>
          </span>
        </span>
      }
      footer={<button type="button" className="qz-btn qz-btn-accent" onClick={onClose}>Got it</button>}
    >
      <p className="qz-rb-mlbl">Example — a shirt store</p>
      <div className="qz-rb-chain">
        <div className="qz-rb-chain-l">
          <span className="qz-rb-chain-bar"><span className="qz-rb-chain-d">12</span><span className="qz-rb-chain-n" /></span>
          <span className="qz-rb-chain-x"><b>Result: Hawaiian Shirts</b><span>The group you pick here.</span></span>
        </div>
        <div className="qz-rb-chain-l">
          <span className="qz-rb-chain-bar"><span className="qz-rb-chain-d">4</span><span className="qz-rb-chain-n" /></span>
          <span className="qz-rb-chain-x"><b>&ldquo;What size are you?&rdquo;</b><span>Narrows by variant option · Size</span></span>
        </div>
        <div className="qz-rb-chain-l">
          <span className="qz-rb-chain-bar"><span className="qz-rb-chain-d is-end">2</span></span>
          <span className="qz-rb-chain-x"><b>&ldquo;Bold or muted print?&rdquo;</b><span>Narrows by tag · print. The shopper sees 2, not 12.</span></span>
        </div>
      </div>
      <p className="qz-rb-mlbl">Narrow by</p>
      <div className="qz-rb-by">
        <span>Variant option</span><span>Tag family</span><span>Product type</span><span>Metafield</span>
      </div>
    </QzModal>
  );
}

// The Select-all / Clear-all / Override confirm — an in-page modal, never a
// native confirm() (suppressed inside a sandboxed frame).
function ConfirmModal({
  title,
  body,
  yes,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  yes: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <QzModal
      open
      onClose={onCancel}
      size="sm"
      title={title}
      footer={
        <>
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onConfirm}>
            {yes}
          </button>
        </>
      }
    >
      <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>{body}</p>
    </QzModal>
  );
}

// Step-1 start modal (start-modal-flow.html mock screen 1, EXACT). FLOW-2:
// survives ONLY in the manual flow.
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
    <QzModal open onClose={onClose} size="md" width={560}>
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

// §6 downstream integrity — removing a selection the draft's questions already
// reference gets a warn-first confirm.
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
// shopper would see for each selected recommendation. A product previews as a
// focused single-product screen; a group as a grid.
function ResultsPreviewDrawer({
  selections,
  products,
  groups,
  money,
  designTokens,
  onClose,
}: {
  selections: BucketCard[];
  products: FunnelData["catalog"]["products"];
  groups: FunnelData["catalog"]["groups"];
  money: (v: number) => string;
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

  const members = useMemo(() => (sel ? membersOf(sel, products, groups) : []), [sel, products, groups]);

  if (!sel) return null;
  const isProduct = sel.type === "product";
  const hero = members[0] ?? null;
  const shown = members.slice(0, 6);
  const overflow = members.length - shown.length;
  const kind = sel.type === "tag" ? "tag" : sel.type === "collection" ? "collection" : "group";
  const descriptor = isProduct
    ? "Single-product layout — one focused product screen"
    : `Multi-product layout — ${members.length} product${members.length === 1 ? "" : "s"} from this ${kind}`;
  const ctaText = suggestContrastText(resolved.colors?.primary ?? "#5563DE");

  return (
    <QzDrawer open onClose={onClose} title="Results page preview" width="min(496px, 94vw)">
      <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", overflow: "hidden" }}>
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
                    <div className="qz-rb-pv-heroimg qz-rb-pv-noimg" aria-hidden>📦</div>
                  )}
                  <strong className="qz-rb-pv-name">{hero.title}</strong>
                  {hero.description ? <p className="qz-rb-pv-desc">{hero.description}</p> : null}
                  <p className="qz-rb-ghost">✦ AI personalizes at quiz time</p>
                  <div className="qz-rb-pv-buyrow">
                    <span className="qz-rb-pv-price">{hero.price != null ? money(hero.price) : ""}</span>
                    <span className="qz-rb-pv-cta" style={{ color: ctaText }}>Add to cart</span>
                  </div>
                </div>
              ) : (
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
                        <div className="qz-rb-pv-noimg" aria-hidden>📦</div>
                      )}
                      <span className="qz-rb-pvtile-name">{p.title}</span>
                      <span className="qz-rb-pvtile-price">{p.price != null ? money(p.price) : ""}</span>
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
