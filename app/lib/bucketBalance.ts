// Pure analysis of how evenly products spread across buckets. One bucket
// swallowing the catalog skews every recommendation toward it ("only snowboards
// returned"); an empty bucket means its result page silently falls back to the
// default collection. Both the Step-1 Products summary and the Optimize-tab
// product-mapping table use this so they agree on what "unbalanced" means.

export interface BucketBalance {
  total: number; // products across all buckets (multi-mapped products double-count)
  topIndex: number; // index of the largest bucket, or -1 when empty
  topShare: number; // 0..1 — the largest bucket's share of the total
  oversized: number[]; // indices holding an outsized share
  empty: number[]; // indices with zero products
  imbalanced: boolean; // oversized or empty present
}

// A bucket is "oversized" when its share exceeds well above an even split. The
// floor (0.4) keeps the rule meaningful when there are many buckets (an even
// 7-way split is ~14%, so 40%+ is ~3× its fair share); the 1.5/n term tightens
// it for few buckets (with 2 buckets, only a >75% bucket is flagged).
function oversizeThreshold(n: number): number {
  return Math.max(0.4, 1.5 / n);
}

export function analyzeBucketBalance(counts: number[]): BucketBalance {
  const total = counts.reduce((sum, n) => sum + n, 0);
  const empty = counts.flatMap((n, i) => (n === 0 ? [i] : []));

  if (counts.length < 2 || total === 0) {
    return { total, topIndex: -1, topShare: 0, oversized: [], empty, imbalanced: empty.length > 0 };
  }

  let topIndex = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[topIndex]!) topIndex = i;
  const topShare = counts[topIndex]! / total;

  const threshold = oversizeThreshold(counts.length);
  const oversized = counts.flatMap((n, i) => (n / total > threshold ? [i] : []));

  return {
    total,
    topIndex,
    topShare,
    oversized,
    empty,
    imbalanced: oversized.length > 0 || empty.length > 0,
  };
}

// Build a merchant-facing warning string (or null when balanced). Empties take
// priority — they're a functional fallback bug, not just a skew.
export function bucketBalanceMessage(
  buckets: { name: string; count: number }[],
): string | null {
  const b = analyzeBucketBalance(buckets.map((x) => x.count));
  const nameOf = (i: number) => `"${buckets[i]?.name?.trim() || "Untitled"}"`;

  if (b.empty.length > 0) {
    const names = b.empty.map(nameOf).join(", ");
    const one = b.empty.length === 1;
    return `${one ? "Group" : "Groups"} ${names} ${one ? "has" : "have"} no products — ${
      one ? "that result page" : "those result pages"
    } will fall back to the default collection. Add products, or re-group.`;
  }

  if (b.oversized.length > 0) {
    const pct = Math.round(b.topShare * 100);
    return `${nameOf(b.topIndex)} holds ${pct}% of products — recommendations will skew toward it. Move products in Optimize, or re-group for more variety per answer.`;
  }

  return null;
}
