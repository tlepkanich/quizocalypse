import type { DiscountConfig } from "./quizSchema";
import type { AdminGraphql } from "./discount.server";

// Results handoff §8 — the existing-discount picker reads the store's own
// code discounts. Nothing is created or changed: a picked discount is only
// read, and its facts are copied into discount_config so the page's words
// (offerCopy) match what the code really does at checkout.

export interface StoreDiscount {
  /** The Shopify discount node id — saved as existing_discount_id. */
  id: string;
  code: string;
  title: string;
  /** Shopify's own one-line summary, shown to the merchant only. */
  summary: string;
  /** The facts the shopper is told, in discount_config's own keys. */
  facts: Pick<DiscountConfig, "kind" | "value" | "applies_to"> &
    Partial<Pick<DiscountConfig, "minimum_subtotal" | "minimum_quantity" | "ends_at">>;
}

const FIELDS = `title status summary endsAt tags codes(first: 1) { nodes { code } }
  minimumRequirement { __typename
    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount } }
    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity } }`;

const LIST = `#graphql
  query quizExistingDiscounts {
    codeDiscountNodes(first: 50, query: "status:active", sortKey: CREATED_AT, reverse: true) {
      nodes { id codeDiscount { __typename
        ... on DiscountCodeBasic { ${FIELDS}
          customerGets { items { __typename }
            value { __typename ... on DiscountPercentage { percentage } ... on DiscountAmount { amount { amount } } } } }
        ... on DiscountCodeFreeShipping { ${FIELDS} }
      } }
    }
  }`;

interface RawNode {
  id?: string;
  codeDiscount?: {
    __typename?: string;
    title?: string;
    summary?: string;
    endsAt?: string | null;
    tags?: string[];
    codes?: { nodes?: Array<{ code?: string }> };
    minimumRequirement?: {
      greaterThanOrEqualToSubtotal?: { amount?: string };
      greaterThanOrEqualToQuantity?: string | number;
    } | null;
    customerGets?: {
      items?: { __typename?: string };
      value?: { __typename?: string; percentage?: number; amount?: { amount?: string } };
    };
  } | null;
}

/** The tag every per-shopper pool carries (offerMint.server.ts). A pool is
 *  never offered as "an existing discount": its codes are single-shopper. */
const OWN_POOL_TAG = "wiskr-quiz";

/** One Shopify node → a pickable discount; null for a kind the quiz cannot
 *  describe (Buy X get Y, app discounts) or one with no code. Pure. */
export function toStoreDiscount(node: RawNode): StoreDiscount | null {
  const d = node.codeDiscount;
  const code = d?.codes?.nodes?.[0]?.code?.trim();
  if (!node.id || !d || !code) return null;
  if (d.tags?.includes(OWN_POOL_TAG)) return null;
  const shipping = d.__typename === "DiscountCodeFreeShipping";
  if (!shipping && d.__typename !== "DiscountCodeBasic") return null;

  const v = d.customerGets?.value;
  const percent = v?.__typename === "DiscountPercentage" && typeof v.percentage === "number";
  const amount = v?.__typename === "DiscountAmount" ? Number(v.amount?.amount) : Number.NaN;
  if (!shipping && !percent && !(amount > 0)) return null;

  const subtotal = Number(d.minimumRequirement?.greaterThanOrEqualToSubtotal?.amount);
  const quantity = Number(d.minimumRequirement?.greaterThanOrEqualToQuantity);
  return {
    id: node.id,
    code,
    title: d.title?.trim() || code,
    summary: d.summary?.trim() ?? "",
    facts: {
      kind: shipping ? "free_shipping" : percent ? "percentage" : "amount",
      // 0.1 → 10; rounded so 0.15 never reads as 15.000000000000002.
      value: shipping ? 0 : percent ? Math.round(v!.percentage! * 10000) / 100 : amount,
      applies_to:
        shipping || d.customerGets?.items?.__typename === "AllDiscountItems" ? "all" : "collections",
      ...(subtotal > 0 ? { minimum_subtotal: subtotal } : quantity > 0 ? { minimum_quantity: quantity } : {}),
      ...(d.endsAt ? { ends_at: d.endsAt } : {}),
    },
  };
}

export async function listStoreDiscounts(admin: AdminGraphql): Promise<StoreDiscount[]> {
  const res = await admin.graphql(LIST);
  const body = (await res.json()) as { data?: { codeDiscountNodes?: { nodes?: RawNode[] } }; errors?: unknown };
  if (!body.data) throw new Error(`Admin API error: ${JSON.stringify(body.errors ?? "no data").slice(0, 300)}`);
  return (body.data.codeDiscountNodes?.nodes ?? [])
    .map(toStoreDiscount)
    .filter((d): d is StoreDiscount => d !== null);
}
