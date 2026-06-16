import { randomUUID } from "node:crypto";
import Papa from "papaparse";
import { z } from "zod";
import type { Product } from "@prisma/client";
import prisma from "../db.server";

// Spin-off — the manual catalog for standalone (non-Shopify) workspaces. Products
// added by hand or via CSV become Product rows with platform-neutral man_<uuid>
// ids + one synthetic always-in-stock variant, so the recommendation engine,
// grouping, and publish baking all work UNCHANGED (they treat productId as an
// opaque string). The merchant's own product URL is the "Shop now" click-through
// (QD-7), since there's no Shopify cart permalink. papaparse runs server-side
// only (this is a .server module), never entering the client bundle.

// Empty strings → undefined, then validate as an optional URL.
const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
  z.string().url("Must be a valid URL (https://…)").max(2000).optional(),
);

export const ManualProductInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  url: optionalUrl,
  imageUrl: optionalUrl,
  price: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? undefined : v),
    z.coerce.number().nonnegative().optional(),
  ),
  tags: z.array(z.string().trim().min(1)).default([]),
  description: z.string().trim().max(5000).optional(),
});
export type ManualProductInput = z.input<typeof ManualProductInput>;

const MANUAL_PREFIX = "man_";

export function isManualId(productId: string): boolean {
  return productId.startsWith(MANUAL_PREFIX);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

// One synthetic variant so quizPublish's inventory/default_variant_id baking
// works. A high inventoryQuantity means "always in stock" through the existing
// `inventoryQuantity > 0` check — manual catalogs don't track stock.
function syntheticVariants() {
  return [{ id: `man_var_${randomUUID()}`, title: "Default", inventoryQuantity: 9999 }];
}

function toRow(shopId: string, data: z.output<typeof ManualProductInput>, productId: string) {
  return {
    productId,
    shopId,
    title: data.title,
    handle: slugify(data.title),
    source: "manual",
    tags: data.tags,
    url: data.url ?? null,
    imageUrl: data.imageUrl ?? null,
    priceMin: data.price ?? null,
    priceMax: data.price ?? null,
    descriptionText: data.description ?? null,
    collectionIds: [],
    variants: syntheticVariants(),
    metafields: {},
  };
}

export async function listCatalog(shopId: string): Promise<Product[]> {
  return prisma.product.findMany({ where: { shopId }, orderBy: { updatedAt: "desc" } });
}

export async function createManualProduct(shopId: string, input: unknown): Promise<Product> {
  const data = ManualProductInput.parse(input);
  return prisma.product.create({ data: toRow(shopId, data, `${MANUAL_PREFIX}${randomUUID()}`) });
}

export async function updateManualProduct(
  shopId: string,
  productId: string,
  input: unknown,
): Promise<Product> {
  if (!isManualId(productId)) throw new Error("Only manual products can be edited here.");
  const data = ManualProductInput.parse(input);
  // Re-slug + keep the existing synthetic variant (don't churn the id).
  const existing = await prisma.product.findFirst({ where: { productId, shopId }, select: { variants: true } });
  return prisma.product.update({
    where: { productId },
    data: {
      title: data.title,
      handle: slugify(data.title),
      tags: data.tags,
      url: data.url ?? null,
      imageUrl: data.imageUrl ?? null,
      priceMin: data.price ?? null,
      priceMax: data.price ?? null,
      descriptionText: data.description ?? null,
      ...(existing?.variants ? {} : { variants: syntheticVariants() }),
    },
  });
}

export async function deleteManualProduct(shopId: string, productId: string): Promise<void> {
  if (!isManualId(productId)) throw new Error("Only manual products can be deleted here.");
  await prisma.product.deleteMany({ where: { productId, shopId } });
}

export interface CsvImportResult {
  created: number;
  errors: Array<{ row: number; message: string }>;
}

// Header-mapped CSV (case-insensitive). Recognized columns: title* | url |
// product_url | image_url | image | price | tags (| or , delimited) |
// description. Per-row validation; a bad row is reported, never aborts the batch.
export async function importCsv(shopId: string, csvText: string): Promise<CsvImportResult> {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  const rows = parsed.data;
  const result: CsvImportResult = { created: 0, errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const get = (...keys: string[]): string => {
      for (const k of keys) {
        const v = r[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
      return "";
    };
    const input = {
      title: get("title", "name"),
      url: get("url", "product_url", "link"),
      imageUrl: get("image_url", "image", "image url"),
      price: get("price", "cost"),
      tags: get("tags", "tag")
        .split(/[|,]/)
        .map((t) => t.trim())
        .filter(Boolean),
      description: get("description", "body", "details"),
    };
    try {
      await createManualProduct(shopId, input);
      result.created++;
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.issues.map((iss) => `${iss.path.join(".") || "row"}: ${iss.message}`).join("; ")
          : err instanceof Error
            ? err.message
            : "Unknown error";
      result.errors.push({ row: i + 2, message }); // +2: header row + 1-based
    }
  }
  return result;
}
