// Per-product performance for the merchant analytics dashboards (the missing
// consumer of the product-level events the runtime already fires: the dashboard
// loader does the DB reads and feeds this deterministic helper). Answers the
// merchant's #1 ROI question — "which recommended products get clicked + added to
// cart" — from existing Event rows, no new collection and no quiz-doc change.
//
// Producers (QuizRuntime, unchanged):
//   recommendation_viewed → payload.product_ids[] (+ secondary_product_ids[]) = impressions
//   recommendation_clicked → payload.product_id = a click
//   add_to_cart            → payload.product_id = an add-to-cart
//
// Every count is DISTINCT SESSIONS (the funnelAggregation/abAnalytics pattern), so
// a re-render can't double-count and CTR can't exceed 100%; rates are clamped to
// [0,1] anyway for the rare click-without-a-prior-view edge.

interface ProductEvent {
  sessionId: string;
  eventType: string;
  payload: unknown;
}

export interface ProductMeta {
  productId: string;
  title: string;
  imageUrl?: string | null;
  handle?: string | null;
}

export interface ProductPerfRow {
  productId: string;
  title: string;
  imageUrl: string | null;
  handle: string | null;
  /** Distinct sessions the product was shown in (primary or secondary recs). */
  impressions: number;
  /** Distinct sessions that clicked the product. */
  clicks: number;
  /** Distinct sessions that added the product to cart. */
  addToCart: number;
  /** clicks / impressions, clamped to [0,1] (0 when never shown). */
  ctr: number;
  /** addToCart / clicks, clamped to [0,1] (0 when never clicked). */
  atcRate: number;
}

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Add `sessionId` to the per-product session set (lazily created). */
function record(map: Map<string, Set<string>>, productId: string, sessionId: string): void {
  let set = map.get(productId);
  if (!set) {
    set = new Set();
    map.set(productId, set);
  }
  set.add(sessionId);
}

/**
 * Aggregate per-product impressions / clicks / add-to-cart (distinct sessions)
 * from raw Event rows, joined left-outer to product metadata so a product_id that
 * no longer exists in the catalog still surfaces its historical engagement (with a
 * neutral title) rather than being silently dropped. Sorted by clicks desc; capped.
 */
export function productPerformance(
  events: ProductEvent[],
  productMeta: ProductMeta[],
  opts?: { limit?: number },
): ProductPerfRow[] {
  const impressions = new Map<string, Set<string>>();
  const clicks = new Map<string, Set<string>>();
  const addToCart = new Map<string, Set<string>>();

  for (const e of events) {
    if (!e.sessionId) continue;
    const p = asRecord(e.payload);
    if (!p) continue;
    if (e.eventType === "recommendation_viewed") {
      // Both primary + secondary recs are rendered, so both are impressions.
      const ids = [...stringArray(p.product_ids), ...stringArray(p.secondary_product_ids)];
      for (const id of ids) record(impressions, id, e.sessionId);
    } else if (e.eventType === "recommendation_clicked") {
      if (typeof p.product_id === "string") record(clicks, p.product_id, e.sessionId);
    } else if (e.eventType === "add_to_cart") {
      if (typeof p.product_id === "string") record(addToCart, p.product_id, e.sessionId);
    }
  }

  const metaById = new Map(productMeta.map((m) => [m.productId, m]));
  const productIds = new Set<string>([
    ...impressions.keys(),
    ...clicks.keys(),
    ...addToCart.keys(),
  ]);

  const rows: ProductPerfRow[] = [];
  for (const productId of productIds) {
    const meta = metaById.get(productId);
    const imp = impressions.get(productId)?.size ?? 0;
    const clk = clicks.get(productId)?.size ?? 0;
    const atc = addToCart.get(productId)?.size ?? 0;
    rows.push({
      productId,
      title: meta?.title || productId,
      imageUrl: meta?.imageUrl ?? null,
      handle: meta?.handle ?? null,
      impressions: imp,
      clicks: clk,
      addToCart: atc,
      ctr: imp > 0 ? Math.min(clk / imp, 1) : 0,
      atcRate: clk > 0 ? Math.min(atc / clk, 1) : 0,
    });
  }

  // Clicks desc, then impressions desc, then productId for a stable order.
  rows.sort(
    (a, b) =>
      b.clicks - a.clicks ||
      b.impressions - a.impressions ||
      a.productId.localeCompare(b.productId),
  );

  const limit = opts?.limit ?? 20;
  return rows.slice(0, limit);
}
