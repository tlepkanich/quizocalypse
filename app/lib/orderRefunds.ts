// Returns on attributed orders (ANALYTICS-HANDOFF.md, Data work 2).
//
// The refunds/create webhook writes one `order_refunded` Event per session
// that holds the refunded order's `order_attributed` event. Its payload
// carries the order id, so order redaction (gdpr.server.ts redactOrders)
// deletes it together with the order. Only refund lines Shopify marks as a
// RETURN (`restock_type` = "return") are kept: a refund for a late parcel or
// a cancelled line is not a product coming back.
//
// This module is both ends of that payload: the writer (`refundReturnLines`)
// and the reader (`returnsByProduct`). Pure: no I/O.

/** The slice of a Shopify refund the payload is built from. */
export interface ShopifyRefund {
  id?: number | string | null;
  order_id?: number | string | null;
  created_at?: string | null;
  processed_at?: string | null;
  refund_line_items?: Array<{
    quantity?: number | null;
    restock_type?: string | null;
    line_item?: { product_id?: number | string | null; variant_id?: number | string | null } | null;
  }> | null;
}

export interface ReturnLine {
  /** Shopify GID, the same format as `product_index`. */
  product_id: string;
  quantity: number;
}

export interface RefundPayload {
  order_id: string;
  refund_id: string;
  refunded_at: string;
  /** The order's own created_at, copied from its order_attributed event. */
  order_created_at: string | null;
  returns: ReturnLine[];
}

/** Refund → its return lines, merged per product. Empty = nothing came back. */
export function refundReturnLines(refund: ShopifyRefund): ReturnLine[] {
  const byProduct = new Map<string, number>();
  for (const li of refund.refund_line_items ?? []) {
    if (li.restock_type !== "return") continue;
    const pid = li.line_item?.product_id;
    if (pid == null) continue;
    const qty = Math.max(0, Math.trunc(Number(li.quantity ?? 0)));
    if (!Number.isFinite(qty) || qty === 0) continue;
    const gid = `gid://shopify/Product/${pid}`;
    byProduct.set(gid, (byProduct.get(gid) ?? 0) + qty);
  }
  return [...byProduct.entries()].map(([product_id, quantity]) => ({ product_id, quantity }));
}

/** The time a refund happened: when it was processed, else when it was made. */
export function refundTime(refund: ShopifyRefund, fallback: Date): Date {
  for (const raw of [refund.processed_at, refund.created_at]) {
    const t = raw ? Date.parse(raw) : NaN;
    if (Number.isFinite(t)) return new Date(t);
  }
  return fallback;
}

export interface ProductReturns {
  /** Units returned across the cohort's attributed orders. */
  units: number;
  /** Median days from order to refund, over each (order, refund) holding the product. */
  medianDays: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Per-product returns over `order_refunded` events, DEDUPED BY refund_id (one
 * order can win several sessions, and each gets its own copy of the refund).
 * `orderIds` limits the count to the attributed orders being reported on.
 */
export function returnsByProduct(
  refundEvents: Array<{ payload: unknown }>,
  orderIds?: ReadonlySet<string>,
): Map<string, ProductReturns> {
  const seen = new Set<string>();
  const units = new Map<string, number>();
  const days = new Map<string, number[]>();
  for (const e of refundEvents) {
    const p = e.payload as Partial<RefundPayload> | null;
    if (!p || typeof p.order_id !== "string" || typeof p.refund_id !== "string") continue;
    if (orderIds && !orderIds.has(p.order_id)) continue;
    if (seen.has(p.refund_id)) continue;
    seen.add(p.refund_id);
    const refunded = typeof p.refunded_at === "string" ? Date.parse(p.refunded_at) : NaN;
    const ordered = typeof p.order_created_at === "string" ? Date.parse(p.order_created_at) : NaN;
    const d = Number.isFinite(refunded) && Number.isFinite(ordered) ? Math.max(0, (refunded - ordered) / 86_400_000) : null;
    for (const r of Array.isArray(p.returns) ? p.returns : []) {
      if (!r || typeof r.product_id !== "string") continue;
      const q = Math.max(0, Math.trunc(Number(r.quantity ?? 0)));
      if (!q) continue;
      units.set(r.product_id, (units.get(r.product_id) ?? 0) + q);
      if (d != null) {
        const list = days.get(r.product_id) ?? [];
        list.push(d);
        days.set(r.product_id, list);
      }
    }
  }
  const out = new Map<string, ProductReturns>();
  for (const [pid, u] of units) {
    const m = median(days.get(pid) ?? []);
    out.set(pid, { units: u, medianDays: m == null ? null : Math.round(m * 10) / 10 });
  }
  return out;
}
