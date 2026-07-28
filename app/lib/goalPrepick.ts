// FLOW-1 — the goal pre-pick's PURE half (unit-tested; no IO). The IO/job half
// lives in goalPrepick.server.ts (the bucketPersist.ts / bucketPersist.server.ts
// convention).
import { bucketRowsFor, type BucketRow, type BucketType } from "./bucketPersist";
import type { GroupingProduct, GroupingCollection } from "./categoryGrouping";

// The most outcomes a pre-pick may persist — each key becomes one result page,
// and past ~8 the quiz stops differentiating (mirrors bucketDetect's apply cap).
export const MAX_PREPICK_KEYS = 8;

export interface BucketResolveInputs {
  products: GroupingProduct[];
  collections: GroupingCollection[];
  productTitleById: Map<string, string>;
  collectionTitleById: Map<string, string>;
}

// Fold the goal brief's optional sharpeners into ONE stored goal text — the
// same shape shape-goal-build persists, so every downstream goal consumer
// (prompts, prefills) sees the whole brief.
export function foldGoalBrief(goal: string, audience: string, factors: string): string {
  return [
    goal.trim().slice(0, 500),
    audience.trim() ? `Audience: ${audience.trim().slice(0, 200)}` : "",
    factors.trim() ? `Deciding factors: ${factors.trim().slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// De-duplicate + cap the AI's keys, then resolve them to persistable rows.
// Hallucinated / stale keys drop silently inside bucketRowsFor (null rows) —
// the AI can only ever select things the merchant could have clicked.
export function resolveGoalPickRows(
  pick: { strategy: BucketType; keys: string[] },
  inputs: BucketResolveInputs,
): BucketRow[] {
  const keys = [...new Set(pick.keys.map((k) => k.trim()).filter(Boolean))].slice(
    0,
    MAX_PREPICK_KEYS,
  );
  return bucketRowsFor(
    keys.map((key) => ({ type: pick.strategy, key })),
    inputs.products,
    inputs.collections,
    inputs.productTitleById,
    inputs.collectionTitleById,
  );
}

// The pre-pick's four-outcome failure copy (ai-fallbacks §1) — recs-surface
// wording: the catalog browser below IS the non-AI way forward, so every class
// points at it. Never renders raw error text.
export function friendlyPrepickError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/credit balance|billing|quota|insufficient|payment/i.test(msg)) {
    return "AI product picking is temporarily unavailable — choose your products below, or try again shortly.";
  }
  if (/rate.?limit|429|overloaded|529/i.test(msg)) {
    return "The AI is busy right now — try again in a moment, or choose your products below.";
  }
  return "We couldn't pick products for that goal — try again, or choose them below.";
}
