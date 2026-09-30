import { useEffect, useMemo, useRef, useState } from "react";
import type { FunnelData } from "../../onboarding/stages/stagesShared";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { deliverableCopy } from "../../../lib/bucketSelection";
import { QzModal, QzPopover } from "../../qz-overlays";
import { useQzToast } from "../../qz-toast";
import {
  batches,
  catalogCounts,
  catalogKey,
  catalogMatches,
  catalogRows,
  inQuizKeySet,
  mapEnsureResponse,
  CATALOG_KINDS,
  type CatalogKind,
  type EnsureResult,
  type LogicCatalogRow,
} from "./createRuleBand";
import { ADD_RECS_COPY as A, RULE_WINDOW_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the "Add recommendations" window (D15; mock arHTML /
// drawAR / ACT.ar*; handoff 09 "Add recommendations").
//
//   Add recommendations                                               ×
//   [ Search products, collections, tags, groups                      ]
//   (All 29) (Collections 6) (Tags 10) (Products 10) (Custom groups 3)
//   COLLECTIONS
//   □ Moisturizers  Collection                               21 products
//   ✓ fine-lines    Tag                                     In this quiz
//   ────────────────────────────────────────────────────────────────────
//   Pick what shoppers could be shown           Cancel  Add N recommendations
//
// • The search box stays mounted for the window's life (IME-safe, B54); one
//   match test feeds both the list and the tab counts.
// • Rows already in the quiz are checked + disabled "In this quiz", matched
//   by identity (kind + key), never by name.
// • Selection is keyed by kind + key and survives tab and search changes.
// • "Add" writes through POST /api/categories/ensure-targets (the "group"
//   kind copies a shop-global group like Step 1 does), at most 12 per call,
//   one call at a time, lifting each batch through onCategoriesCreated as it
//   lands. Always quiz-scoped, additive, idempotent. The primary stays
//   disabled while calls run (no double submit). Rows that land after the
//   window closes are still lifted (and picked, from the rule window).
// • A failure keeps the window open with the unsent picks still ticked.
// • The list renders in windows (a real shop can have thousands of rows):
//   a first window, more on scroll, reset on tab or search change.
// ════════════════════════════════════════════════════════════════════════════

export type LogicCatalog = FunnelData["catalog"];

const PEEK_ROWS = 6;

/** "Inside {name}": six products and a "+N more" tail (D19 — the drill-in
 *  the live band had survives as a popover on the count). */
export function ProductPeek({ name, products }: { name: string; products: readonly IndexedProduct[] }) {
  return (
    <div className="qz-lm-peek">
      <div className="qz-lm-peek-h">{RULE_WINDOW_COPY.peekTitle(name)}</div>
      {products.slice(0, PEEK_ROWS).map((p) => (
        <div key={p.product_id} className="qz-lm-peek-row">
          {p.image_url ? (
            <img src={p.image_url} alt="" width={22} height={22} loading="lazy" />
          ) : (
            <span className="qz-lm-peek-sw" aria-hidden />
          )}
          <span>{p.title}</span>
        </div>
      ))}
      {products.length === 0 ? <div className="qz-lm-peek-more">{RULE_WINDOW_COPY.peekEmpty}</div> : null}
      {products.length > PEEK_ROWS ? (
        <div className="qz-lm-peek-more">{RULE_WINDOW_COPY.peekMore(products.length - PEEK_ROWS)}</div>
      ) : null}
    </div>
  );
}


export type AddRecommendationsDialogProps = {
  open: boolean;
  quizId: string;
  /** The funnel loader's catalogue. Absent on the builder (D6 parked). */
  catalog?: LogicCatalog;
  /** Every category the view knows (marks rows already in this quiz). */
  categories: readonly BuilderCategory[];
  /** For the count's peek ("Inside {name}"). */
  productIndex?: readonly IndexedProduct[];
  /** Opened from the rule window: the new rows are picked in its draft and
   *  the toast says so. */
  forRule?: boolean;
  onCategoriesCreated: (cats: BuilderCategory[]) => void;
  /** The rows this Add created or reused, as they land (rule window). */
  onAdded?: (cats: BuilderCategory[]) => void;
  onClose: () => void;
};

const WINDOW = 80;
type Tab = "all" | CatalogKind;
const TABS: readonly Tab[] = ["all", ...CATALOG_KINDS];

export function AddRecommendationsDialog({
  open,
  quizId,
  catalog,
  categories,
  productIndex = [],
  forRule = false,
  onCategoriesCreated,
  onAdded,
  onClose,
}: AddRecommendationsDialogProps) {
  const toast = useQzToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(WINDOW);
  // Keys added during this window's life (they read "In this quiz" at once).
  const [landed, setLanded] = useState<string[]>([]);

  // Callbacks read through a ref, so a batch that lands after the window
  // closed still lifts (and picks) its rows.
  const cbs = useRef({ onCategoriesCreated, onAdded, toast });
  cbs.current = { onCategoriesCreated, onAdded, toast };

  const rows = useMemo(() => (catalog ? catalogRows(catalog) : []), [catalog]);
  const inQuiz = useMemo(() => {
    const s = inQuizKeySet(catalog?.inQuizKeys, categories);
    for (const k of landed) s.add(k);
    return s;
  }, [catalog?.inQuizKeys, categories, landed]);
  const counts = useMemo(() => catalogCounts(rows, query), [rows, query]);
  const pool = useMemo(
    () => rows.filter((r) => (tab === "all" || r.kind === tab) && catalogMatches(r, query)),
    [rows, tab, query],
  );
  const productById = useMemo(() => new Map(productIndex.map((p) => [p.product_id, p])), [productIndex]);

  // A new query or tab starts at the top with a fresh window.
  useEffect(() => {
    setLimit(WINDOW);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [query, tab]);

  const toggle = (r: LogicCatalogRow) => {
    const k = catalogKey(r.kind, r.key);
    setPicked((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  const n = picked.length;

  const add = async () => {
    if (busy || n === 0) return;
    setBusy(true);
    const want = picked
      .map((k) => rows.find((r) => catalogKey(r.kind, r.key) === k))
      .filter((r): r is LogicCatalogRow => Boolean(r));
    const addedKeys: string[] = [];
    const skipped: Array<"empty" | "not_found"> = [];
    let failed = false;
    for (const batch of batches(want)) {
      const sent = batch.map((r) => ({ kind: r.kind, ref: r.key }));
      let results: EnsureResult[];
      try {
        const res = await fetch("/api/categories/ensure-targets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quizId, resources: sent }),
        });
        const body = (await res.json()) as {
          ok?: boolean;
          results?: EnsureResult[];
          categories?: BuilderCategory[];
        };
        if (!body.ok) throw new Error("ensure-targets refused");
        results = mapEnsureResponse(sent, body);
      } catch {
        failed = true;
        break;
      }
      const cats = results.flatMap((x) => ("category" in x ? [x.category] : []));
      if (cats.length) {
        cbs.current.onCategoriesCreated(cats);
        cbs.current.onAdded?.(cats);
      }
      results.forEach((x, i) => {
        const k = catalogKey(batch[i]!.kind, batch[i]!.key);
        if ("category" in x) addedKeys.push(k);
        else skipped.push(x.skipped);
      });
      setLanded((prev) => [...prev, ...addedKeys.filter((k) => !prev.includes(k))]);
    }
    setBusy(false);
    const say = cbs.current.toast;
    if (failed) {
      // Keep the window open; rows that did land now read "In this quiz",
      // the unsent picks stay ticked. Never clear the selection on failure.
      setPicked((prev) => prev.filter((k) => !addedKeys.includes(k)));
      say(addedKeys.length ? A.offlineSome(addedKeys.length, want.length) : A.offlineNone);
      return;
    }
    if (skipped.length) {
      say(skipped.length === 1 ? A.skipped(skipped[0]!) : A.skippedMany(skipped.length));
    } else if (addedKeys.length) {
      // The mock's plain toast() replaces whatever is up, a pending Undo
      // included: this news must not be dropped (B7 opt-out).
      say(forRule ? RULE_WINDOW_COPY.addedPicked : A.added(addedKeys.length), { replace: true });
    }
    setPicked([]);
    onClose();
  };

  const row = (r: LogicCatalogRow) => {
    const k = catalogKey(r.kind, r.key);
    const had = inQuiz.has(k);
    const empty = !had && r.count === 0;
    const on = picked.includes(k);
    const products = r.productIds
      .map((id) => productById.get(id))
      .filter((p): p is IndexedProduct => Boolean(p));
    return (
      <div key={k} className={`qz-lg-arrow${on ? " is-on" : ""}${had || empty ? " is-off" : ""}`}>
        <button
          type="button"
          className="qz-lg-arsel"
          role="checkbox"
          aria-checked={on || had}
          disabled={had || empty}
          title={r.label}
          onClick={() => toggle(r)}
        >
          <span className="qz-lg-ck" aria-hidden>
            {on || had ? "✓" : ""}
          </span>
          <span className="qz-lg-nm">{r.label}</span>
          {tab === "all" ? <span className="qz-lg-kd">{A.kind[r.kind]}</span> : null}
        </button>
        {had ? (
          <span className="qz-lg-ct">{A.inQuiz}</span>
        ) : (
          <QzPopover
            placement="bottom"
            align="end"
            maxWidth={260}
            trigger={
              <button
                type="button"
                className="qz-lg-ct is-btn"
                aria-label={RULE_WINDOW_COPY.peekLabel(deliverableCopy(r.count, r.count), r.label)}
              >
                {deliverableCopy(r.count, r.count)}
              </button>
            }
            content={<ProductPeek name={r.label} products={products} />}
          />
        )}
      </div>
    );
  };

  const shown = pool.slice(0, limit);
  let list: React.ReactNode;
  if (!catalog) list = <div className="qz-lg-arempty">{A.noCatalogue}</div>;
  else if (pool.length === 0) list = <div className="qz-lg-arempty">{A.nothingMatches(query.trim())}</div>;
  else if (tab === "all")
    list = CATALOG_KINDS.map((kind) => {
      const g = shown.filter((r) => r.kind === kind);
      return g.length ? (
        <div key={kind} role="group" aria-label={A.tabs[kind]}>
          <div className="qz-lg-argrp">{A.tabs[kind]}</div>
          {g.map(row)}
        </div>
      ) : null;
    });
  else
    list = (
      <>
        {tab === "group" ? <div className="qz-lg-arnote">{A.groupsNote}</div> : null}
        {shown.map(row)}
      </>
    );

  return (
    <QzModal
      open={open}
      onClose={onClose}
      width={580}
      title={A.title}
      draftSafe
      lockScroll
      initialFocusRef={searchRef}
      className="qz-lg-arbox"
      footer={
        <div className="qz-lg-arfoot">
          <span aria-live="polite">
            {n ? (
              <>
                <b>{n}</b> {A.selected}
              </>
            ) : (
              A.footEmpty
            )}
          </span>
          <button type="button" className="qz-lg-btn" onClick={onClose}>
            {A.cancel}
          </button>
          <button
            type="button"
            className="qz-lg-btn is-pri"
            disabled={n === 0 || busy}
            onClick={() => void add()}
          >
            {busy ? A.adding : n ? A.add(n) : A.addNone}
          </button>
        </div>
      }
    >
      <div className="qz-lg-artools">
        <input
          ref={searchRef}
          className="qz-lg-arsearch"
          type="search"
          placeholder={A.search}
          aria-label={A.searchLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="qz-lg-artabs" role="group" aria-label={A.kindGroup}>
          {TABS.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {A.tabs[t]}
              <span className="qz-lg-c">{counts[t]}</span>
            </button>
          ))}
        </div>
      </div>
      <div
        ref={listRef}
        className="qz-lg-arlist"
        data-testid="add-recs-list"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (limit < pool.length && el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            setLimit((l) => l + WINDOW);
          }
        }}
      >
        {list}
      </div>
    </QzModal>
  );
}
