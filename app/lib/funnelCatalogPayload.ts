import { variantOptionsOf } from "./productIndexing";

// ════════════════════════════════════════════════════════════════════════════
// Step-1 tweaks (§02 item 1) — the picker's per-product payload, as ONE pure
// derivation so the loader, its tests and the size budget agree. Pure and
// client-safe (no prisma).
// ════════════════════════════════════════════════════════════════════════════

export interface CatalogProductSource {
  productId: string;
  title: string;
  imageUrl: string | null;
  priceMin: number | null;
  descriptionText: string | null;
  tags: string[];
  collectionIds: string[];
  status: string | null;
  variants: unknown;
  metafields: unknown;
  /** Normalized tag keys (the bucket identity) — computed by the caller. */
  tagKeys: string[];
  /** "ns.key: value" condition strings (metafieldValuesOf). */
  metafieldValues: string[];
}

export interface CatalogVariant {
  name: string;
  value: string;
  available: boolean;
}

export interface CatalogProductPayload {
  id: string;
  title: string;
  imageUrl: string | null;
  price: number | null;
  description: string | null;
  tagKeys: string[];
  collectionIds: string[];
  /** Raw Shopify tags — the group wizard's membership matches these EXACT. */
  tags: string[];
  metafieldValues: string[];
  /** "active" | "draft" | "archived" (lower-cased); null on a manual catalog. */
  status: "active" | "draft" | "archived" | null;
  /** The FIRST real option's values with per-variant availability. Empty for
   *  a single-variant product (variantOptionsOf drops "Title: Default Title"). */
  variants: CatalogVariant[];
  /** The option name the variant list is on ("Size"), null when none. */
  variantOption: string | null;
}

export function normalizeStatus(s: string | null | undefined): CatalogProductPayload["status"] {
  if (!s) return null;
  const v = s.toLowerCase();
  return v === "active" || v === "draft" || v === "archived" ? v : null;
}

/** Per-variant availability along the FIRST real option: a product can read
 *  "in stock" while one size is gone, and the variant preview is the one
 *  place that is visible before publish. Display only (§12). */
export function variantListOf(variants: unknown): { option: string | null; list: CatalogVariant[] } {
  const options = variantOptionsOf(variants);
  const option = Object.keys(options)[0] ?? null;
  if (!option) return { option: null, list: [] };
  const seen = new Map<string, boolean>();
  if (Array.isArray(variants)) {
    for (const v of variants) {
      const opts = (v as { options?: unknown })?.options;
      if (!Array.isArray(opts)) continue;
      const hit = opts.find(
        (o) => (o as { name?: unknown })?.name === option && typeof (o as { value?: unknown })?.value === "string",
      ) as { value: string } | undefined;
      if (!hit) continue;
      const qty = (v as { inventoryQuantity?: unknown })?.inventoryQuantity;
      const available = typeof qty === "number" ? qty > 0 : true;
      // Any available variant with this value makes the value available.
      seen.set(hit.value, (seen.get(hit.value) ?? false) || available);
    }
  }
  return {
    option,
    list: (options[option] ?? []).map((value) => ({
      name: option,
      value,
      available: seen.get(value) ?? true,
    })),
  };
}

export function catalogProductPayload(p: CatalogProductSource): CatalogProductPayload {
  const { option, list } = variantListOf(p.variants);
  return {
    id: p.productId,
    title: p.title,
    imageUrl: p.imageUrl,
    price: p.priceMin,
    // Step-1 spec §5: the single-product preview clamps to 3 lines — slice
    // server-side so 100+ products don't bloat the payload.
    description: p.descriptionText ? p.descriptionText.slice(0, 220) : null,
    tagKeys: p.tagKeys,
    collectionIds: p.collectionIds,
    tags: p.tags,
    metafieldValues: p.metafieldValues,
    status: normalizeStatus(p.status),
    variants: list,
    variantOption: option,
  };
}

// The catalog block is ungated and uncapped (no take/select/cursor on the
// product read), which is why descriptions are already sliced. The budget is
// an assertion, not a cap: over it the loader logs, never throws.
export const CATALOG_PAYLOAD_BUDGET_BYTES = 3 * 1024 * 1024;

export function checkCatalogPayloadBudget(
  products: readonly CatalogProductPayload[],
  limit = CATALOG_PAYLOAD_BUDGET_BYTES,
): { ok: boolean; bytes: number; limit: number } {
  const bytes = JSON.stringify(products).length;
  return { ok: bytes <= limit, bytes, limit };
}
