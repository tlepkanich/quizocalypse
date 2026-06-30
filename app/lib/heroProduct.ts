// step4-dev-handoff §6 — Hero product selection. Pure split of an ALREADY-ranked
// product list (ordered by the page's relevance/ranking logic) into the featured
// HERO card + the GRID below it. heroLogic=match keeps the incoming order (the
// hero is simply the top in-stock product); heroLogic=reviewed/seller re-sorting
// is engine-side + data-gated, so it's out of this pure split's scope — the caller
// passes whatever order it resolved.
//
// §6.1: filter to in-stock → first = hero → the rest become the grid.
// §6.2 (all matched OOS): heroOos="next" promotes the first product as an OOS-badged
// hero (Add-to-Cart disabled but visible); heroOos="grid" skips the hero entirely.

export type HeroOos = "next" | "grid";

// Anything with an optional in-stock flag. `available === false` = out of stock;
// undefined/true = treated as available (matches the runtime IndexedProduct shape
// where `available` is only explicitly false when inventory tracking says so).
export interface HeroSplitItem {
  available?: boolean;
}

export interface HeroSplit<T> {
  hero: T | null;
  grid: T[];
}

const inStock = (p: HeroSplitItem): boolean => p.available !== false;

export function selectHeroAndGrid<T extends HeroSplitItem>(
  ranked: readonly T[],
  heroOos: HeroOos = "next",
): HeroSplit<T> {
  if (ranked.length === 0) return { hero: null, grid: [] };

  // The hero is the first IN-STOCK product (the rest — including any OOS products
  // ahead of it — fall into the grid). This re-promotes an in-stock product over a
  // higher-ranked-but-OOS one, per §6.1, without reordering the grid.
  const heroIdx = ranked.findIndex(inStock);
  if (heroIdx >= 0) {
    return {
      hero: ranked[heroIdx]!,
      grid: ranked.filter((_, i) => i !== heroIdx),
    };
  }

  // All products are out of stock (§6.2).
  if (heroOos === "grid") return { hero: null, grid: [...ranked] };
  return { hero: ranked[0]!, grid: ranked.slice(1) };
}
