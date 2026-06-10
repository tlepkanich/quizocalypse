import type { RecommendedProduct } from "./recommendationEngine";

// ════════════════════════════════════════════════════════════════════════════
// Buddy mode (Phase L2) — compare two completed sessions. Pure: takes both
// shoppers' ranked recommendations and answer sets, returns what the compare
// page renders — the products they BOTH match, and an agreement score.
//
// Agreement is the Jaccard similarity of the two TOP-N matched product-id
// sets (not raw answers — two people can answer differently and still suit
// the same gear, which is the fun of the feature). N caps at 5 so a quiz
// with one giant fallback collection can't read as "100% twins".
// ════════════════════════════════════════════════════════════════════════════

const TOP_N = 5;

export interface BuddyComparison {
  /** Products in both shoppers' top-N, in A's rank order. */
  shared: RecommendedProduct[];
  /** 0–100 Jaccard over the two top-N product-id sets. */
  agreementPct: number;
  /** True when both landed on the same outcome node. */
  sameOutcome: boolean;
}

export function compareBuddies(input: {
  recsA: RecommendedProduct[];
  recsB: RecommendedProduct[];
  outcomeA: string | null;
  outcomeB: string | null;
}): BuddyComparison {
  const topA = input.recsA.slice(0, TOP_N);
  const topB = input.recsB.slice(0, TOP_N);
  const idsA = new Set(topA.map((r) => r.product_id));
  const idsB = new Set(topB.map((r) => r.product_id));
  const shared = topA.filter((r) => idsB.has(r.product_id));
  const union = new Set([...idsA, ...idsB]).size;
  return {
    shared,
    agreementPct: union === 0 ? 0 : Math.round((shared.length / union) * 100),
    sameOutcome:
      input.outcomeA !== null && input.outcomeB !== null && input.outcomeA === input.outcomeB,
  };
}
