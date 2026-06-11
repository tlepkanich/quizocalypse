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

/**
 * Experiences E5 — a MULTI-item cart permalink for "add the full routine":
 * Shopify natively supports comma-separated variant:qty pairs
 * (https://{shop}/cart/v1:1,v2:1?discount=CODE). Unresolvable variants are
 * skipped; returns null when nothing resolves. The single-item
 * cartPermalink above is untouched.
 */
export function cartPermalinkMulti(
  shopDomain: string | null | undefined,
  variantGids: Array<string | null | undefined>,
  discountCode?: string | null,
): string | null {
  if (!shopDomain) return null;
  const pairs = variantGids
    .map((gid) => numericId(gid))
    .filter((vid): vid is string => Boolean(vid))
    .map((vid) => `${vid}:1`);
  if (pairs.length === 0) return null;
  const base = `https://${shopDomain}/cart/${pairs.join(",")}`;
  const code = discountCode?.trim();
  return code ? `${base}?discount=${encodeURIComponent(code)}` : base;
}
