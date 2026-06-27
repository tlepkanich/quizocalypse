// Per-item discounted price for a PERCENTAGE discount — the only discount kind
// that maps cleanly to a per-card strikethrough. A fixed amount ("$10 off") or
// free shipping is an ORDER-level discount Shopify applies once to the subtotal,
// so showing `price - amount` on each card would misstate the per-item price;
// those keep the badge-only display. Returns the reduced price, or null when
// there's nothing to show (invalid price, pct ≤ 0, or no actual reduction).
export function discountedItemPrice(price: number, percentOff: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const pct = Math.max(0, Math.min(100, percentOff));
  if (pct <= 0) return null;
  const next = Math.max(0, price * (1 - pct / 100));
  return next < price ? next : null;
}
