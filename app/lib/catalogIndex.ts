import type { Product, Collection } from "@prisma/client";

// Scoped product index passed to the AI generator. Spec §3.2: when the catalog
// summary exceeds the model's effective context budget, downgrade to attribute
// distribution rather than full product listings.

const FULL_LISTING_BUDGET = 80; // products
const SAMPLE_PER_BAND = 5;

export interface ScopedIndex {
  products: Product[];
  collections: Collection[];
  summary: string;
}

export function buildScopedIndex(
  allProducts: Product[],
  allCollections: Collection[],
  collectionIds: string[],
): ScopedIndex {
  const scopedCollections =
    collectionIds.length === 0
      ? allCollections
      : allCollections.filter((c) => collectionIds.includes(c.collectionId));

  const inScope = (p: Product) =>
    collectionIds.length === 0 ||
    p.collectionIds.some((id) => collectionIds.includes(id));

  const products = allProducts.filter(inScope);

  return {
    products,
    collections: scopedCollections,
    summary: buildSummary(products, scopedCollections),
  };
}

function buildSummary(products: Product[], collections: Collection[]): string {
  const lines: string[] = [];
  lines.push(`Total scoped products: ${products.length}`);
  lines.push(`Scoped collections: ${collections.length}`);

  lines.push("");
  lines.push("Collections (id — title):");
  for (const c of collections) {
    lines.push(`  ${c.collectionId} — ${c.title}`);
  }

  const tagCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const prices: number[] = [];
  for (const p of products) {
    for (const t of p.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (p.productType) {
      typeCounts.set(p.productType, (typeCounts.get(p.productType) ?? 0) + 1);
    }
    if (p.priceMin) prices.push(Number(p.priceMin));
  }

  lines.push("");
  lines.push("Top tags (real catalog tags — only use these in answer.tags):");
  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);
  for (const [tag, count] of sortedTags) lines.push(`  ${tag} (${count})`);

  lines.push("");
  lines.push("Product types:");
  for (const [type, count] of [...typeCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`  ${type} (${count})`);
  }

  if (prices.length) {
    prices.sort((a, b) => a - b);
    const min = prices[0]!;
    const max = prices[prices.length - 1]!;
    const mid = prices[Math.floor(prices.length / 2)]!;
    lines.push("");
    lines.push(`Price range: $${min.toFixed(2)} – $${max.toFixed(2)} (median $${mid.toFixed(2)})`);
  }

  lines.push("");
  if (products.length <= FULL_LISTING_BUDGET) {
    lines.push("Products (id | title | tags):");
    for (const p of products) {
      lines.push(`  ${p.productId} | ${p.title} | ${p.tags.join(",")}`);
    }
  } else {
    lines.push(
      `Catalog exceeds ${FULL_LISTING_BUDGET} products — showing a sample per collection:`,
    );
    for (const c of collections) {
      const sample = products
        .filter((p) => p.collectionIds.includes(c.collectionId))
        .slice(0, SAMPLE_PER_BAND);
      if (sample.length === 0) continue;
      lines.push(`  ${c.title}:`);
      for (const p of sample) {
        lines.push(`    ${p.productId} | ${p.title} | ${p.tags.join(",")}`);
      }
    }
  }

  return lines.join("\n");
}
