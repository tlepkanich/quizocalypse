// QD-7 — the single PDP-link rule shared by every product card in the runtime.
// Standalone quizzes link to the merchant's own product URL (the "Shop now"
// target baked into the index at publish); Shopify quizzes keep the storefront
// /products/<handle> permalink. Returns undefined when there's no resolvable
// target (a standalone product with no url, or a Shopify quiz with no shop
// domain) — callers then render a plain, unlinked card.

export type QuizPlatform = "shopify" | "standalone";

export function productHref(
  product: { handle?: string; url?: string },
  shopDomain: string | undefined,
  platform: QuizPlatform,
): string | undefined {
  if (platform === "standalone") return product.url || undefined;
  return shopDomain ? `https://${shopDomain}/products/${product.handle}` : undefined;
}
