import type { Quiz as QuizDoc, DiscountConfig } from "./quizSchema";

// ───────────────────────────────────────────────────────────────────────────
// Phase 5 — recommended-product discounts. When a quiz's discount_config is
// enabled, the publisher creates a Shopify CODE discount once (idempotent: the
// generated code is stored back on the quiz and reused) and bakes the code into
// publishedJson. The storefront shows a badge and appends ?discount=CODE to the
// cart permalink so it auto-applies. Requires the write_discounts scope (already
// granted). Failures never block publish — they return a warning.
// ───────────────────────────────────────────────────────────────────────────

interface AdminGraphql {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
}

const DISCOUNT_CODE_BASIC_CREATE = `#graphql
  mutation quizDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

const DISCOUNT_CODE_FREE_SHIPPING_CREATE = `#graphql
  mutation quizFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field message }
    }
  }`;

// Shared minimum-requirement / usage-limit / end-date fields (spec §4). Pure.
function commonDiscountFields(cfg: DiscountConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    appliesOncePerCustomer: cfg.once_per_customer,
  };
  if (cfg.usage_limit != null) fields.usageLimit = cfg.usage_limit;
  if (cfg.ends_at) fields.endsAt = cfg.ends_at;
  if (cfg.minimum_subtotal != null) {
    fields.minimumRequirement = {
      subtotal: { greaterThanOrEqualToSubtotal: String(cfg.minimum_subtotal) },
    };
  } else if (cfg.minimum_quantity != null) {
    fields.minimumRequirement = {
      quantity: { greaterThanOrEqualToQuantity: String(cfg.minimum_quantity) },
    };
  }
  return fields;
}

// customerGets.items scope (spec §4 "Applies to"). Defaults to the whole cart.
function itemsScope(cfg: DiscountConfig): Record<string, unknown> {
  if (cfg.applies_to === "collections" && cfg.applies_collection_ids.length > 0) {
    return { collections: { add: cfg.applies_collection_ids } };
  }
  if (cfg.applies_to === "products" && cfg.applies_product_ids.length > 0) {
    return { products: { productsToAdd: cfg.applies_product_ids } };
  }
  return { all: true };
}

/**
 * Build the DiscountCodeBasicInput for a quiz % / amount discount. Pure + testable.
 * - percentage → customerGets.value.percentage as a 0–1 fraction
 * - amount     → customerGets.value.discountAmount.amount (shop currency)
 * Honors applies-to scope, usage cap, end date, and minimum requirement (spec §4).
 */
export function buildDiscountInput(
  cfg: DiscountConfig,
  code: string,
  startsAtISO: string,
): Record<string, unknown> {
  const value =
    cfg.kind === "percentage"
      ? { percentage: Math.max(0, Math.min(1, cfg.value / 100)) }
      : { discountAmount: { amount: String(cfg.value), appliesOnEachItem: false } };
  return {
    title: cfg.title || "Quiz reward",
    code,
    startsAt: startsAtISO,
    customerSelection: { all: true },
    customerGets: { value, items: itemsScope(cfg) },
    ...commonDiscountFields(cfg),
  };
}

/**
 * Build the DiscountCodeFreeShippingInput for a free-shipping quiz discount.
 * Pure + testable. Applies to all shipping destinations.
 */
export function buildFreeShippingInput(
  cfg: DiscountConfig,
  code: string,
  startsAtISO: string,
): Record<string, unknown> {
  return {
    title: cfg.title || "Quiz reward",
    code,
    startsAt: startsAtISO,
    customerSelection: { all: true },
    destination: { all: true },
    ...commonDiscountFields(cfg),
  };
}

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `QUIZ-${s}`;
}

interface DiscountCreateBody {
  data?: {
    discountCodeBasicCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: Array<{ message: string }> };
    discountCodeFreeShippingCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: Array<{ message: string }> };
  };
}

/**
 * §M3 — create ONE Shopify code discount for an arbitrary DiscountConfig + code
 * (the reward engine's per-shopper single-use codes). Reuses the same proven
 * mutations + pure input builders as ensureQuizDiscount. Never throws — returns
 * ok/warning so the caller can degrade gracefully.
 */
export async function createCodeDiscount(
  admin: AdminGraphql,
  cfg: DiscountConfig,
  code: string,
  startsAtISO: string,
): Promise<{ ok: boolean; warning?: string }> {
  const isFreeShipping = cfg.kind === "free_shipping";
  try {
    const res = isFreeShipping
      ? await admin.graphql(DISCOUNT_CODE_FREE_SHIPPING_CREATE, {
          variables: { freeShippingCodeDiscount: buildFreeShippingInput(cfg, code, startsAtISO) },
        })
      : await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, {
          variables: { basicCodeDiscount: buildDiscountInput(cfg, code, startsAtISO) },
        });
    const body = (await res.json()) as DiscountCreateBody;
    const result = isFreeShipping ? body.data?.discountCodeFreeShippingCreate : body.data?.discountCodeBasicCreate;
    const errors = result?.userErrors ?? [];
    if (errors.length > 0) return { ok: false, warning: errors.map((e) => e.message).join("; ") };
    if (!result?.codeDiscountNode?.id) return { ok: false, warning: "Shopify returned no discount." };
    return { ok: true };
  } catch (err) {
    return { ok: false, warning: err instanceof Error ? err.message : String(err) };
  }
}

export interface EnsureDiscountResult {
  doc: QuizDoc;
  code: string | null;
  warning?: string;
}

/**
 * Ensure the quiz's discount exists in Shopify. No-op when disabled; reuses an
 * already-created code. On success returns a doc with `discount_config.code`
 * set. Any failure returns the original doc + a human-readable warning (never
 * throws — publish must not be blocked by a discount hiccup).
 */
export async function ensureQuizDiscount(
  admin: AdminGraphql,
  doc: QuizDoc,
): Promise<EnsureDiscountResult> {
  const cfg = doc.discount_config;
  if (!cfg.enabled) return { doc, code: null };
  if (cfg.code) return { doc, code: cfg.code }; // already created — reuse

  const code = generateCode();
  const startsAt = new Date().toISOString();
  const isFreeShipping = cfg.kind === "free_shipping";

  try {
    const res = isFreeShipping
      ? await admin.graphql(DISCOUNT_CODE_FREE_SHIPPING_CREATE, {
          variables: { freeShippingCodeDiscount: buildFreeShippingInput(cfg, code, startsAt) },
        })
      : await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, {
          variables: { basicCodeDiscount: buildDiscountInput(cfg, code, startsAt) },
        });
    const body = (await res.json()) as {
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id?: string } | null;
          userErrors?: Array<{ message: string }>;
        };
        discountCodeFreeShippingCreate?: {
          codeDiscountNode?: { id?: string } | null;
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const result = isFreeShipping
      ? body.data?.discountCodeFreeShippingCreate
      : body.data?.discountCodeBasicCreate;
    const errors = result?.userErrors ?? [];
    if (errors.length > 0) {
      return { doc, code: null, warning: `Discount not created: ${errors.map((e) => e.message).join("; ")}` };
    }
    if (!result?.codeDiscountNode?.id) {
      return { doc, code: null, warning: "Discount not created (Shopify returned no discount)." };
    }
    return { doc: { ...doc, discount_config: { ...cfg, code } }, code };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { doc, code: null, warning: `Discount creation failed: ${msg}` };
  }
}
