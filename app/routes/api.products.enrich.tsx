// app/routes/api.products.enrich.tsx
// Batched product tag enrichment endpoint. POST processes up to N
// products per call, returns progress so the dashboard auto-loops until
// every product is enriched.
//
// Per-product flow:
//   1. Pull title + description + existing tags from Prisma.
//   2. Ask Claude for 5–12 additional tags (forced tool-use, retries on
//      validation failure).
//   3. Merge enriched tags onto existing tags, dedupe case-insensitive.
//   4. Write merged tags + lastEnrichedAt back to Prisma.
//   5. Push merged tags to Shopify via productUpdate mutation. Failure
//      here is non-fatal — we keep the Prisma write so the local quiz
//      generator gets the benefit immediately.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { withAiSpendRecording } from "../lib/aiBudget.server";
import {
  EnrichmentError,
  enrichProductTags,
  mergeTags,
} from "../lib/enrichTags";

// BIC-2 A2(e) — this action takes NO body parameters today (the dashboard
// fetcher posts an empty form; batch size + refresh window are fixed
// server-side), but the boundary still validates: a JSON body must at least
// be an object. Garbage is a 400 instead of being silently ignored, and any
// future parameter has to land in this schema to be read at all.
const EnrichRequestBody = z.object({}).passthrough();

// Process up to BATCH_SIZE products per request. Each Claude call is
// ~2-5s; 10 fits comfortably inside Remix's default action timeout while
// still making visible progress on large catalogs.
const BATCH_SIZE = 10;

// Re-enrich anything older than 30 days, otherwise skip. Lets the
// merchant click "Enrich tags" once a month without paying repeat cost.
const REFRESH_AFTER_DAYS = 30;

const PRODUCT_UPDATE_MUTATION = `#graphql
  mutation enrichProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id tags }
      userErrors { field message }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  // Validate before any business logic; return early on failure (A2e). Form
  // posts (the real caller) carry no JSON body and skip straight through.
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = EnrichRequestBody.safeParse(raw);
    if (!parsed.success) {
      return json(
        { ok: false, error: "Invalid request body", issues: parsed.error.issues.slice(0, 3) },
        { status: 400 },
      );
    }
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 400 });
  }

  const cutoff = new Date(
    Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );

  // Selection: never-enriched OR enriched longer ago than the refresh
  // window. Ordered by oldest-first so re-runs make consistent forward
  // progress (no flapping between products).
  const stale = await prisma.product.findMany({
    where: {
      shopId: shop.id,
      OR: [
        { lastEnrichedAt: null },
        { lastEnrichedAt: { lt: cutoff } },
      ],
    },
    orderBy: [{ lastEnrichedAt: { sort: "asc", nulls: "first" } }],
    take: BATCH_SIZE,
    select: {
      productId: true,
      title: true,
      tags: true,
      vendor: true,
      productType: true,
      descriptionText: true,
    },
  });

  // Total remaining count for the dashboard progress indicator. Includes
  // the batch we're about to process; the client subtracts processed on
  // the response.
  const totalStale = await prisma.product.count({
    where: {
      shopId: shop.id,
      OR: [
        { lastEnrichedAt: null },
        { lastEnrichedAt: { lt: cutoff } },
      ],
    },
  });

  if (stale.length === 0) {
    return json({
      ok: true,
      processed: 0,
      remaining: 0,
      shopifyErrors: [],
      enrichmentErrors: [],
    });
  }

  const enrichmentErrors: Array<{ productId: string; error: string }> = [];
  const shopifyErrors: Array<{ productId: string; error: string }> = [];
  let processed = 0;

  for (const p of stale) {
    let newTags: string[];
    try {
      // ai-fallbacks Gap 8 — thread the shopId so enrichment token usage lands
      // in the budget ledger (enrichTags now calls the shared client).
      newTags = await withAiSpendRecording(shop.id, () =>
        enrichProductTags({
          title: p.title,
          description: p.descriptionText,
          existingTags: p.tags,
          vendor: p.vendor,
          productType: p.productType,
        }),
      );
    } catch (err) {
      const msg =
        err instanceof EnrichmentError
          ? `${err.message}${err.lastValidationIssue ? ` (${err.lastValidationIssue})` : ""}`
          : err instanceof Error
            ? err.message
            : String(err);
      enrichmentErrors.push({ productId: p.productId, error: msg });
      // ai-fallbacks Gap 7 — a FAILED product must stay retryable, not be
      // marked enriched forever (the old bump silently gave up on it). But it
      // also must not block the queue head: stamped to just-inside-stale
      // (cutoff − 1ms) it sorts LAST among stale products, so fresh products
      // enrich first and failures retry at the back of every run. Spend on
      // repeat failures is bounded by the merchant AI budget + manual runs.
      await prisma.product.update({
        where: { productId: p.productId },
        data: { lastEnrichedAt: new Date(cutoff.getTime() - 1) },
      });
      processed += 1;
      continue;
    }

    if (newTags.length === 0) {
      // Claude had nothing to add — still mark the product as enriched
      // so we don't pay for the same null result next time.
      await prisma.product.update({
        where: { productId: p.productId },
        data: { lastEnrichedAt: new Date() },
      });
      processed += 1;
      continue;
    }

    const merged = mergeTags(p.tags, newTags);

    // Local-first: write to Prisma. Even if the Shopify push fails the
    // quiz generator still benefits from the richer tags.
    await prisma.product.update({
      where: { productId: p.productId },
      data: {
        tags: merged,
        lastEnrichedAt: new Date(),
      },
    });

    // Push back to Shopify. Non-fatal on failure; we log and continue.
    try {
      const res = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
        variables: {
          input: { id: p.productId, tags: merged },
        },
      });
      const body = (await res.json()) as {
        data?: {
          productUpdate?: {
            userErrors?: Array<{ field?: string[]; message: string }>;
          };
        };
      };
      const userErrors = body?.data?.productUpdate?.userErrors ?? [];
      if (userErrors.length > 0) {
        shopifyErrors.push({
          productId: p.productId,
          error: userErrors.map((e) => e.message).join("; "),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      shopifyErrors.push({ productId: p.productId, error: msg });
    }

    processed += 1;
  }

  return json({
    ok: true,
    processed,
    remaining: Math.max(0, totalStale - processed),
    shopifyErrors,
    enrichmentErrors,
  });
}
