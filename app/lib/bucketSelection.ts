// ════════════════════════════════════════════════════════════════════════════
// Step-1 tweaks — the picker's PURE selection/ordering rules, kept out of the
// component so the dangerous paths (typed apply/revert, the frozen order, the
// select-all scope) are unit-tested. Client-safe: no React, no prisma.
// ════════════════════════════════════════════════════════════════════════════

export type BucketType = "product" | "tag" | "collection" | "group";

export interface SelectableCard {
  key: string;
  type: BucketType;
  name: string;
  count: number;
}

export const idOf = (type: BucketType, key: string): string => `${type}:${key}`;

// ── sort ────────────────────────────────────────────────────────────────────
export type SortMode = "size" | "size_asc" | "az" | "za";
export const SORT_LABEL: Record<SortMode, string> = {
  size: "Most products",
  size_asc: "Fewest products",
  az: "A – Z",
  za: "Z – A",
};

/** Per-tab sorts (§03 toolbar): Tags and Custom browse by weight; Products
 *  have no member count and a Collection is something you already know the
 *  name of (decision 4), so those two get A–Z / Z–A only. */
export function sortsFor(tab: BucketType): SortMode[] {
  return tab === "product" || tab === "collection" ? ["az", "za"] : ["size", "size_asc", "az", "za"];
}

export function defaultSortFor(tab: BucketType): SortMode {
  return sortsFor(tab)[0]!;
}

export function comparator(mode: SortMode): (a: SelectableCard, b: SelectableCard) => number {
  const az = (a: SelectableCard, b: SelectableCard) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  if (mode === "az") return az;
  if (mode === "za") return (a, b) => az(b, a);
  if (mode === "size_asc") return (a, b) => a.count - b.count || az(a, b);
  return (a, b) => b.count - a.count || az(a, b);
}

// ── selected-first, FROZEN between rebuilds ─────────────────────────────────
// Selected-first is a GROUPING; the sort runs inside each group. The order is
// rebuilt only on load, tab change, search change, sort change and status
// change — re-partitioning on every toggle would teleport the clicked row to
// the top and slide the next row under the cursor. While a search is active
// the frozen order is bypassed entirely (a flat sorted list, selections
// interleaved) — see `visibleCards`.
export function buildOrder(
  cards: readonly SelectableCard[],
  isSelected: (id: string) => boolean,
  mode: SortMode,
): string[] {
  const cmp = comparator(mode);
  const on: SelectableCard[] = [];
  const off: SelectableCard[] = [];
  for (const c of cards) (isSelected(idOf(c.type, c.key)) ? on : off).push(c);
  return [...on.sort(cmp), ...off.sort(cmp)].map((c) => idOf(c.type, c.key));
}

export function visibleCards<T extends SelectableCard>(
  cards: readonly T[],
  order: readonly string[] | null,
  query: string,
  mode: SortMode,
  keep: (c: T) => boolean,
): T[] {
  const q = query.trim().toLowerCase();
  if (q) {
    return cards.filter((c) => keep(c) && c.name.toLowerCase().includes(q)).sort(comparator(mode));
  }
  const byId = new Map(cards.map((c) => [idOf(c.type, c.key), c]));
  const ordered = order ?? buildOrder(cards, () => false, mode);
  const out: T[] = [];
  for (const id of ordered) {
    const c = byId.get(id);
    if (c && keep(c)) out.push(c);
  }
  // Cards the frozen order never saw (a group created after the rebuild) go last.
  const seen = new Set(ordered);
  for (const c of cards) if (!seen.has(idOf(c.type, c.key)) && keep(c)) out.push(c);
  return out;
}

// ── status filter (Products only) ───────────────────────────────────────────
export type StatusFilter = "active" | "draft" | "archived" | "all";
export const STATUS_LABEL: Record<StatusFilter, string> = {
  active: "Active",
  draft: "Draft",
  archived: "Archived",
  all: "All statuses",
};

/** A selected row is ALWAYS shown regardless of the status filter (the §03
 *  "pick one rule" — the rail carries no badge, so a hidden pick must never
 *  look healthy from nowhere). */
export function statusKeeps(
  filter: StatusFilter,
  status: string | null,
  selected: boolean,
): boolean {
  if (selected || filter === "all") return true;
  return (status ?? "active") === filter;
}

// ── select all / clear all — the LOADED window, counting what changes ───────
export function bulkPlan<T extends SelectableCard>(
  window: readonly T[],
  isSelected: (id: string) => boolean,
): { mode: "add" | "clear"; cards: T[] } {
  const allOn = window.length > 0 && window.every((c) => isSelected(idOf(c.type, c.key)));
  if (allOn) return { mode: "clear", cards: [...window] };
  return { mode: "add", cards: window.filter((c) => !isSelected(idOf(c.type, c.key))) };
}

// ── typed apply / revert (§05) ──────────────────────────────────────────────
// Apply replaces ONE type's half of the selection and leaves the other three
// alone. Revert must be scoped identically: delete the suggested type's keys,
// restore that type's prior keys — never a whole-selection snapshot, which
// would silently discard anything added SINCE the apply.
export function applyTyped<T extends SelectableCard>(
  current: readonly T[],
  type: BucketType,
  next: readonly T[],
): T[] {
  return [...current.filter((c) => c.type !== type), ...next.filter((c) => c.type === type)];
}

export function revertTyped<T extends SelectableCard>(
  current: readonly T[],
  type: BucketType,
  prior: readonly T[],
): T[] {
  return applyTyped(current, type, prior);
}

/** True when the `type` half of the selection is EXACTLY the pick set. */
export function typedSelectionIs(
  current: readonly SelectableCard[],
  type: BucketType,
  keys: readonly string[],
): boolean {
  const have = current.filter((c) => c.type === type).map((c) => c.key);
  if (have.length !== keys.length) return false;
  const want = new Set(keys);
  return have.every((k) => want.has(k));
}

// ── rail composition (§04) ──────────────────────────────────────────────────
export function railComposition<T extends SelectableCard>(cards: readonly T[]): {
  groups: T[];
  products: T[];
} {
  return {
    groups: cards.filter((c) => c.type !== "product"),
    products: cards.filter((c) => c.type === "product"),
  };
}

/** Copy rule: equal → "44 products"; different → "38 of 44 products". */
export function deliverableCopy(deliverable: number, total: number): string {
  const noun = total === 1 ? "product" : "products";
  if (deliverable === total) return `${total} ${noun}`;
  return `${deliverable} of ${total} ${noun}`;
}

// ── footer ledger (§03) ─────────────────────────────────────────────────────
export function ledgerHidden(
  filter: StatusFilter,
  counts: { draft: number; archived: number },
): string[] {
  const hid: string[] = [];
  if (filter !== "all" && filter !== "draft" && counts.draft) hid.push(`${counts.draft} draft`);
  if (filter !== "all" && filter !== "archived" && counts.archived)
    hid.push(`${counts.archived} archived`);
  return hid;
}

export const TYPE_NOUN: Record<BucketType, [string, string]> = {
  product: ["product", "products"],
  tag: ["tag", "tags"],
  collection: ["collection", "collections"],
  group: ["group", "groups"],
};

export function noun(type: BucketType, n: number): string {
  return TYPE_NOUN[type][n === 1 ? 0 : 1];
}

/** The wizard's suggested name from the parts picked (mock autoName). */
export function autoGroupName(parts: readonly string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return `${parts[0]} + ${parts[1]}`;
  return `${parts[0]} + ${parts.length - 1} more`;
}
