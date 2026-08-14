// ANALYTICS P0 — doc-static product reachability (spec section 04; rule A2).
// On a published DECIDER doc, target_product_ids_map (baked at publish,
// quizPublish.ts) makes "these products can never be recommended" PROVABLE at
// zero traffic: a product in product_index that sits in no target's member
// list, no result fallback collection, and no safety-net collection cannot be
// produced by any combination of answers. Legacy points-model docs have no
// baked map → reachability is not computable and this returns null (never
// guess).
//
// Pure: reads the published JSON only. No DB, no traffic.

export type ProductReachState = "reachable" | "unreachable";

export interface ReachabilityReport {
  /** Products the quiz maps (product_index length). */
  mapped: number;
  /** Distinct recommendation targets (result groups). */
  targetCount: number;
  unreachable: Array<{ productId: string; title: string }>;
  /** productId → state, for table joins. */
  stateById: Map<string, ProductReachState>;
}

interface PublishedDocLike {
  logic_model?: string;
  product_index?: Array<{ product_id: string; title: string; collection_ids?: string[] }>;
  target_product_ids_map?: Record<string, string[]>;
  nodes?: Array<{ type: string; data?: { fallback_collection_id?: string } }>;
  rec_page_settings?: { global?: { safetyNetCol?: string } };
}

/**
 * Compute reachability from a published decider doc. Returns null when the doc
 * is not a published decider doc (no baked map — nothing provable).
 */
export function computeReachability(published: unknown): ReachabilityReport | null {
  const doc = published as PublishedDocLike | null;
  if (!doc || typeof doc !== "object") return null;
  if (doc.logic_model !== "decider") return null;
  const map = doc.target_product_ids_map;
  const index = doc.product_index;
  if (!map || !Array.isArray(index)) return null;

  const reachable = new Set<string>();
  for (const ids of Object.values(map)) {
    for (const id of ids) reachable.add(id);
  }

  // Fallback surfaces can also serve a product: result-node fallback
  // collections and the global safety net, matched via each product's baked
  // collection_ids.
  const fallbackCols = new Set<string>();
  for (const n of doc.nodes ?? []) {
    if (n.type === "result" && n.data?.fallback_collection_id) {
      fallbackCols.add(n.data.fallback_collection_id);
    }
  }
  const safetyNet = doc.rec_page_settings?.global?.safetyNetCol;
  if (safetyNet) fallbackCols.add(safetyNet);

  const stateById = new Map<string, ProductReachState>();
  const unreachable: Array<{ productId: string; title: string }> = [];
  for (const p of index) {
    const viaFallback = (p.collection_ids ?? []).some((c) => fallbackCols.has(c));
    const ok = reachable.has(p.product_id) || viaFallback;
    stateById.set(p.product_id, ok ? "reachable" : "unreachable");
    if (!ok) unreachable.push({ productId: p.product_id, title: p.title });
  }

  return {
    mapped: index.length,
    targetCount: Object.keys(map).length,
    unreachable,
    stateById,
  };
}
