// The ONE "No logic" answer (ANALYTICS-HANDOFF.md: "the products with no logic
// in Insights and on Products" must be the same figure). productReach.ts walks
// every answer path with the runtime's own narrowing and rules, which is
// stricter than computeReachability's map-only read; this adapts its result
// to the ReachabilityReport shape the insight rule and the Products table
// already consume, so both read the same products. Falls back to the map-only
// read when the doc can't be enumerated.

import type { Quiz as QuizDoc } from "./quizSchema";
import { computeReachability, type ReachabilityReport, type ProductReachState } from "./quizReachability";
import { productReachMap, type ProductReachReport } from "./productReach";

export function logicReachability(
  doc: QuizDoc | null,
  publishedRaw: unknown,
  collectionNames?: ReadonlyMap<string, string>,
): { report: ReachabilityReport | null; reach: ProductReachReport | null } {
  const mapOnly = computeReachability(publishedRaw);
  if (!doc || !mapOnly) return { report: mapOnly, reach: null };
  const reach = productReachMap(doc, publishedRaw, collectionNames ? { collectionNames } : undefined);
  if (!reach) return { report: mapOnly, reach: null };
  const stateById = new Map<string, ProductReachState>();
  const unreachable: ReachabilityReport["unreachable"] = [];
  for (const p of reach.products.values()) {
    stateById.set(p.productId, p.noLogic ? "unreachable" : "reachable");
    if (p.noLogic) unreachable.push({ productId: p.productId, title: p.title });
  }
  return {
    report: { mapped: reach.products.size, targetCount: mapOnly.targetCount, unreachable, stateById },
    reach,
  };
}
