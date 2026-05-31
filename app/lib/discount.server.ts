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

/**
 * Build the DiscountCodeBasicInput for a quiz discount. Pure + testable.
 * - percentage → customerGets.value.percentage as a 0–1 fraction
 * - amount     → customerGets.value.discountAmount.amount (shop currency)
 * Applies to all items; one use per customer ≈ first-purchase gate.
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
    customerGets: { value, items: { all: true } },
    appliesOncePerCustomer: cfg.once_per_customer,
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
  const input = buildDiscountInput(cfg, code, new Date().toISOString());

  try {
    const res = await admin.graphql(DISCOUNT_CODE_BASIC_CREATE, {
      variables: { basicCodeDiscount: input },
    });
    const body = (await res.json()) as {
      data?: {
        discountCodeBasicCreate?: {
          codeDiscountNode?: { id?: string } | null;
          userErrors?: Array<{ message: string }>;
        };
      };
    };
    const result = body.data?.discountCodeBasicCreate;
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
