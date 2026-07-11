import type { IndexedProduct } from "./recommendationEngine";

// ════════════════════════════════════════════════════════════════════════════
// §M8/M9 — persona landing pages (programmatic SEO/GEO). A published decider
// quiz already bakes, per target, a persona (name/description/image) + an
// ordered product set. This pure module turns that baked data into indexable
// persona pages ("The Glow Chaser Routine") — no extra authoring. Consumed by
// the SSR routes q.$id.persona.$slug (the page) and q.$id.llms.txt (the index).
// ════════════════════════════════════════════════════════════════════════════

export interface PersonaProduct {
  title: string;
  handle: string;
  price: string | null;
  image: string | null;
}

export interface PersonaPage {
  slug: string;
  targetId: string;
  name: string;
  description?: string;
  image?: string | null;
  products: PersonaProduct[];
}

/** URL-safe slug from a persona name. Deterministic; empty → "persona". */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "persona"
  );
}

interface PublishedForSeo {
  target_index?: Record<
    string,
    { type?: string; name?: string; persona?: { name: string; description?: string; image?: string | null } }
  >;
  target_product_ids_map?: Record<string, string[]>;
  product_index?: IndexedProduct[];
}

/** Every persona-bearing target, as an indexable page. Order-stable (target_index
 *  insertion order); slugs de-duped so two same-named personas stay distinct. */
export function extractPersonaPages(raw: PublishedForSeo): PersonaPage[] {
  const index = raw.target_index ?? {};
  const map = raw.target_product_ids_map ?? {};
  const byId = new Map((raw.product_index ?? []).map((p) => [p.product_id, p]));
  const pages: PersonaPage[] = [];
  const seen = new Set<string>();
  for (const [targetId, entry] of Object.entries(index)) {
    const persona = entry.persona;
    if (!persona?.name) continue;
    let slug = slugify(persona.name);
    let n = 2;
    while (seen.has(slug)) slug = `${slugify(persona.name)}-${n++}`;
    seen.add(slug);
    const products: PersonaProduct[] = (map[targetId] ?? [])
      .map((pid) => byId.get(pid))
      .filter((p): p is IndexedProduct => !!p)
      .slice(0, 24)
      .map((p) => ({ title: p.title, handle: p.handle, price: p.price, image: p.image_url }));
    pages.push({
      slug,
      targetId,
      name: persona.name,
      description: persona.description,
      image: persona.image ?? null,
      products,
    });
  }
  return pages;
}

/** Find one persona page by slug. */
export function findPersonaPage(raw: PublishedForSeo, slug: string): PersonaPage | null {
  return extractPersonaPages(raw).find((p) => p.slug === slug) ?? null;
}

/** Storefront product URL — Shopify PDP for shopify platform, else the bare
 *  handle path (the standalone merchant wires their own). */
export function productUrl(shopDomain: string | undefined, handle: string, platform?: string): string {
  if (platform === "standalone" || !shopDomain) return `/products/${handle}`;
  return `https://${shopDomain}/products/${handle}`;
}
