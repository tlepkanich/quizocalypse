// ───────────────────────────────────────────────────────────────────────────
// Shopify cart permalinks — the cross-origin-safe way for the quiz (which runs
// in an iframe on the storefront) to add a product to cart and auto-apply a
// discount. Navigating the parent window (target="_top") to
//   https://{shop}/cart/{numericVariantId}:{qty}?discount={CODE}
// drops the shopper on a cart with the item added and the discount applied —
// no Shopify JS / same-origin requirement.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Extract the numeric id from a Shopify gid, e.g.
 * "gid://shopify/ProductVariant/123" → "123". Returns the trimmed input
 * unchanged if it's already numeric, or null if there's no numeric id.
 */
export function numericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const trimmed = String(gid).trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/(\d+)\s*$/);
  return m ? m[1]! : null;
}

/**
 * Build a Shopify cart permalink. Returns null when the shop domain or a usable
 * variant id is missing (so callers can fall back to a PDP link).
 */
export function cartPermalink(
  shopDomain: string | null | undefined,
  variantGid: string | null | undefined,
  qty = 1,
  discountCode?: string | null,
): string | null {
  if (!shopDomain) return null;
  const vid = numericId(variantGid);
  if (!vid) return null;
  const quantity = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
  const base = `https://${shopDomain}/cart/${vid}:${quantity}`;
  const code = discountCode?.trim();
  return code ? `${base}?discount=${encodeURIComponent(code)}` : base;
}
