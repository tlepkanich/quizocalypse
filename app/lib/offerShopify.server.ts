import type { DiscountConfig } from "./quizSchema";
import {
  DISCOUNT_CODE_BASIC_CREATE,
  DISCOUNT_CODE_FREE_SHIPPING_CREATE,
  buildDiscountInput,
  buildFreeShippingInput,
  type AdminGraphql,
} from "./discount.server";

// Results handoff §12.2 — the Shopify side of the offer pipeline, behind a
// small interface so the mint (offerMint.server.ts) is testable without a
// store. Built for Shopify 5.5.3: discounts with multiple redeem codes use
// discountRedeemCodeBulkAdd — never one discount per shopper.

export interface OfferShopify {
  /** Create the keyed discount with its first (live) code. */
  createDiscount(args: {
    cfg: DiscountConfig;
    code: string;
    startsAt: Date;
    endsAt: Date | null;
    productIds: string[] | null;
    tags: string[];
  }): Promise<{ discountId: string }>;
  /** Add redeem codes and wait for the (asynchronous) creation to finish. */
  addCodes(discountId: string, codes: string[]): Promise<Array<{ code: string; redeemCodeId: string }>>;
  /** Delete unassigned redeem codes of an expired bucket. */
  deleteCodes(discountId: string, redeemCodeIds: string[]): Promise<void>;
}

const BULK_ADD = `#graphql
  mutation offerCodesAdd($discountId: ID!, $codes: [DiscountRedeemCodeInput!]!) {
    discountRedeemCodeBulkAdd(discountId: $discountId, codes: $codes) {
      bulkCreation { id }
      userErrors { field message }
    }
  }`;

const BULK_STATUS = `#graphql
  query offerCodesStatus($id: ID!) {
    discountRedeemCodeBulkCreation(id: $id) {
      done
      codes(first: 250) {
        nodes { code errors { message } discountRedeemCode { id } }
      }
    }
  }`;

const BULK_DELETE = `#graphql
  mutation offerCodesDelete($discountId: ID!, $ids: [ID!]) {
    discountCodeRedeemCodeBulkDelete(discountId: $discountId, ids: $ids) {
      job { id }
      userErrors { field message }
    }
  }`;

const POLL_MS = 400;
const POLL_TRIES = 20; // ≈ 8 s — the shopper is waiting on the first pool fill

type UserErrors = Array<{ message: string }> | undefined;
function assertNoUserErrors(errors: UserErrors, what: string): void {
  if (errors && errors.length > 0) throw new Error(`${what}: ${errors.map((e) => e.message).join("; ")}`);
}

export function shopifyOfferGateway(
  admin: AdminGraphql,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): OfferShopify {
  const call = async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await admin.graphql(query, { variables });
    const body = (await res.json()) as { data?: T; errors?: unknown };
    if (!body.data) throw new Error(`Admin API error: ${JSON.stringify(body.errors ?? "no data").slice(0, 300)}`);
    return body.data;
  };
  return {
    async createDiscount({ cfg, code, startsAt, endsAt, productIds, tags }) {
      const shipping = cfg.kind === "free_shipping";
      const base = shipping
        ? buildFreeShippingInput(cfg, code, startsAt.toISOString())
        : buildDiscountInput(cfg, code, startsAt.toISOString());
      const input: Record<string, unknown> = { ...base, endsAt: endsAt ? endsAt.toISOString() : null, tags };
      // The shopper's one-per-customer rule is enforced by email in the mint:
      // Shopify counts use per CODE, and each shopper has their own.
      delete input.usageLimit;
      if (productIds && !shipping) {
        const gets = input.customerGets as Record<string, unknown>;
        input.customerGets = { ...gets, items: { products: { productsToAdd: productIds } } };
      }
      if (shipping) {
        const data = await call<{
          discountCodeFreeShippingCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: UserErrors };
        }>(DISCOUNT_CODE_FREE_SHIPPING_CREATE, { freeShippingCodeDiscount: input });
        assertNoUserErrors(data.discountCodeFreeShippingCreate?.userErrors, "discount create");
        const id = data.discountCodeFreeShippingCreate?.codeDiscountNode?.id;
        if (!id) throw new Error("discount create returned no id");
        return { discountId: id };
      }
      const data = await call<{
        discountCodeBasicCreate?: { codeDiscountNode?: { id?: string } | null; userErrors?: UserErrors };
      }>(DISCOUNT_CODE_BASIC_CREATE, { basicCodeDiscount: input });
      assertNoUserErrors(data.discountCodeBasicCreate?.userErrors, "discount create");
      const id = data.discountCodeBasicCreate?.codeDiscountNode?.id;
      if (!id) throw new Error("discount create returned no id");
      return { discountId: id };
    },

    async addCodes(discountId, codes) {
      const started = await call<{
        discountRedeemCodeBulkAdd?: { bulkCreation?: { id?: string } | null; userErrors?: UserErrors };
      }>(BULK_ADD, { discountId, codes: codes.map((code) => ({ code })) });
      assertNoUserErrors(started.discountRedeemCodeBulkAdd?.userErrors, "code add");
      const creationId = started.discountRedeemCodeBulkAdd?.bulkCreation?.id;
      if (!creationId) throw new Error("code add returned no bulk creation");
      for (let i = 0; i < POLL_TRIES; i++) {
        await sleep(POLL_MS);
        const status = await call<{
          discountRedeemCodeBulkCreation?: {
            done?: boolean;
            codes?: { nodes?: Array<{ code: string; discountRedeemCode?: { id?: string } | null }> };
          } | null;
        }>(BULK_STATUS, { id: creationId });
        const creation = status.discountRedeemCodeBulkCreation;
        if (!creation?.done) continue;
        return (creation.codes?.nodes ?? [])
          .filter((n) => Boolean(n.discountRedeemCode?.id))
          .map((n) => ({ code: n.code, redeemCodeId: n.discountRedeemCode!.id! }));
      }
      throw new Error("code add did not finish in time");
    },

    async deleteCodes(discountId, redeemCodeIds) {
      if (redeemCodeIds.length === 0) return;
      const data = await call<{ discountCodeRedeemCodeBulkDelete?: { userErrors?: UserErrors } }>(BULK_DELETE, {
        discountId,
        ids: redeemCodeIds,
      });
      assertNoUserErrors(data.discountCodeRedeemCodeBulkDelete?.userErrors, "code delete");
    },
  };
}
