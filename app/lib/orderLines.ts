// Line items on attributed orders (ANALYTICS-HANDOFF.md, Data work 1).
//
// The orders/create webhook saves each line of an attributed order INSIDE the
// `order_attributed` event payload, so the existing order redaction removes
// them with the order — no second store to forget. This module is both ends
// of that payload: the writer (`orderLineItems`, from the Shopify order) and
// the readers (`readLineItems`, `lineRevenueByProduct`). Pure: no I/O.
//
// Product revenue is each line's price × quantity after discounts. It is a
// PART of the order total (which also carries shipping and tax), so the
// per-product column can never add up to more than Revenue influenced.

/** The slice of a Shopify order line the payload is built from. */
export interface ShopifyOrderLine {
  product_id?: number | string | null;
  variant_id?: number | string | null;
  quantity?: number | null;
  /** Unit price before discounts, as a decimal string. */
  price?: string | null;
  total_discount?: string | null;
  discount_allocations?: Array<{ amount?: string | null }> | null;
}

/** One saved line. Ids are Shopify GIDs, the same format as `product_index`. */
export interface SavedLineItem {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  /** price × quantity − discounts, as a decimal string (never negative). */
  line_total: string;
}

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Shopify order lines → the lines saved on the event. Lines without a product
 *  (custom items, tips) are dropped: no product can earn their revenue. */
export function orderLineItems(lines: ShopifyOrderLine[] | null | undefined): SavedLineItem[] {
  const out: SavedLineItem[] = [];
  for (const li of lines ?? []) {
    if (li.product_id == null) continue;
    const quantity = Math.max(0, Math.trunc(toNumber(li.quantity)));
    const gross = toNumber(li.price) * quantity;
    // `discount_allocations` covers order-level codes spread across lines;
    // `total_discount` only the line's own. Allocations win when present.
    const allocations = li.discount_allocations ?? [];
    const discount = allocations.length
      ? allocations.reduce((sum, a) => sum + toNumber(a.amount), 0)
      : toNumber(li.total_discount);
    out.push({
      product_id: `gid://shopify/Product/${li.product_id}`,
      variant_id: li.variant_id != null ? `gid://shopify/ProductVariant/${li.variant_id}` : null,
      quantity,
      line_total: Math.max(0, gross - discount).toFixed(2),
    });
  }
  return out;
}

/** Read saved lines back off an `order_attributed` payload. null = the order
 *  predates line-item capture (an honest "we can't know", not an empty order). */
export function readLineItems(payload: unknown): SavedLineItem[] | null {
  const raw = (payload as { line_items?: unknown } | null)?.line_items;
  if (!Array.isArray(raw)) return null;
  const out: SavedLineItem[] = [];
  for (const r of raw) {
    const li = r as Partial<SavedLineItem> | null;
    if (!li || typeof li.product_id !== "string") continue;
    out.push({
      product_id: li.product_id,
      variant_id: typeof li.variant_id === "string" ? li.variant_id : null,
      quantity: Math.max(0, Math.trunc(toNumber(li.quantity))),
      line_total: typeof li.line_total === "string" ? li.line_total : "0.00",
    });
  }
  return out;
}

export interface ProductLineRevenue {
  /** Sum of the product's lines across attributed orders. */
  revenue: number;
  /** Units across those lines. */
  units: number;
  /** Distinct orders holding the product. */
  orders: number;
}

export interface LineRevenueSummary {
  byProduct: Map<string, ProductLineRevenue>;
  /** Orders that carry saved lines — the base the revenue column rests on. */
  ordersWithLines: number;
  /** Earliest order (ms) that carries lines: "counted since" on the screen. */
  since: number | null;
}

/**
 * Per-product line revenue over `order_attributed` events, DEDUPED BY order_id
 * (one order can win several sessions and each win writes its own event).
 */
export function lineRevenueByProduct(
  orderEvents: Array<{ payload: unknown; ts: number }>,
): LineRevenueSummary {
  const byProduct = new Map<string, ProductLineRevenue>();
  const seenOrders = new Set<string>();
  let ordersWithLines = 0;
  let since: number | null = null;
  for (const e of orderEvents) {
    const p = e.payload as { order_id?: unknown; order_created_at?: unknown } | null;
    const orderId = typeof p?.order_id === "string" ? p.order_id : null;
    if (orderId) {
      if (seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);
    }
    const lines = readLineItems(e.payload);
    if (lines === null) continue;
    ordersWithLines += 1;
    const createdAt = typeof p?.order_created_at === "string" ? Date.parse(p.order_created_at) : NaN;
    const when = Number.isFinite(createdAt) ? createdAt : e.ts;
    if (since === null || when < since) since = when;
    const inThisOrder = new Set<string>();
    for (const li of lines) {
      const row = byProduct.get(li.product_id) ?? { revenue: 0, units: 0, orders: 0 };
      row.revenue += toNumber(li.line_total);
      row.units += li.quantity;
      if (!inThisOrder.has(li.product_id)) {
        inThisOrder.add(li.product_id);
        row.orders += 1;
      }
      byProduct.set(li.product_id, row);
    }
  }
  return { byProduct, ordersWithLines, since };
}
