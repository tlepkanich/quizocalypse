import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import type { IndexedProduct } from "../lib/recommendationEngine";
import { rateLimit } from "../lib/rateLimiters";

// Live inventory endpoint (Rec-Page spec §2 "Urgency Signal"). The storefront
// runtime POSTs the product ids it's about to show on a result page; we reply
// with the CURRENT available quantity per product, read at request time (never
// baked into publishedJson, never cached) so "Only X left in stock" reflects
// real-time stock. Inventory is kept current in our DB by Shopify's
// inventory_levels webhook, so this is a fresh read without a per-load Shopify
// Admin API round-trip. (A direct Admin API call is a future upgrade if a
// merchant needs sub-webhook-latency accuracy.)
//
// Public route, no auth — but it only ever discloses quantities for products
// that already appear in THIS quiz's published product_index, so it can't be
// used to enumerate the merchant's wider catalog.

interface InventoryRequestBody {
  product_ids?: unknown;
}

type VariantJson = { inventoryQuantity?: number | null };

export async function action({ params, request }: ActionFunctionArgs) {
  const { id } = params;
  if (!id) return json({ error: "Missing quiz id" }, { status: 400 });
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // 60 inventory reads/min/IP — called on result-page loads; throttle scraping.
  const rl = rateLimit(request, "inventory", 60);
  if (!rl.ok) {
    return json(
      { error: "rate limited" },
      { status: 429, headers: { "retry-after": String(rl.retryAfterS) } },
    );
  }

  let body: InventoryRequestBody;
  try {
    body = (await request.json()) as InventoryRequestBody;
  } catch {
    return json({ error: "Invalid JSON" }, { status: 400 });
  }
  const requested = Array.isArray(body.product_ids)
    ? body.product_ids.filter((x): x is string => typeof x === "string").slice(0, 100)
    : [];
  if (requested.length === 0) return json({ quantities: {} });

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { publishedJson: true },
  });
  if (!quiz?.publishedJson) {
    return json({ error: "Quiz not published" }, { status: 404 });
  }

  // Scope to the quiz's own products — never disclose anything outside it.
  const productIndex =
    (quiz.publishedJson as { product_index?: IndexedProduct[] }).product_index ?? [];
  const allowed = new Set(productIndex.map((p) => p.product_id));
  const scopedIds = requested.filter((pid) => allowed.has(pid));
  if (scopedIds.length === 0) return json({ quantities: {} });

  const rows = await prisma.product.findMany({
    where: { productId: { in: scopedIds } },
    select: { productId: true, variants: true },
  });

  // Product-level available quantity = sum of variant quantities (clamped at 0,
  // so an oversold variant can't drag a sibling's stock negative). A product
  // with no numeric quantities (inventory tracking off) is omitted entirely —
  // the spec hides the urgency signal when tracking is disabled.
  const quantities: Record<string, number> = {};
  for (const row of rows) {
    const variants = (row.variants ?? []) as VariantJson[];
    let total = 0;
    let tracked = false;
    for (const v of variants) {
      if (typeof v.inventoryQuantity === "number") {
        tracked = true;
        total += Math.max(0, v.inventoryQuantity);
      }
    }
    if (tracked) quantities[row.productId] = total;
  }

  return json({ quantities });
}
