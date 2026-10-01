import type { DiscountConfig } from "../../../lib/quizSchema";
import { offerCodeDisplay, offerName, offerType, type OfferType } from "../../../lib/offerCopy";
import type { GuidedDiscount } from "./state";

/* Results handoff §8 — the discount editor's rules, pure and unit-tested.
   Every control writes one documented Shopify Admin field; a state Shopify
   would reject (or that would publish a useless code) blocks Save. */

/** Switch the Shopify discount type, keeping the value where it still fits. */
export function withOfferType(d: GuidedDiscount, t: OfferType): GuidedDiscount {
  if (t === "shipping") return { ...d, kind: "free_shipping", applies_to: "all" };
  const kind = d.kind === "free_shipping" ? "percentage" : d.kind;
  if (t === "order") return { ...d, kind, applies_to: "all" };
  // Shopify has no "all products" product discount: pick a scope. What we
  // recommend needs per-shopper codes.
  const scope = d.applies_to !== "all" ? d.applies_to : d.code_mode === "dynamic" ? "recommended" : "collections";
  return { ...d, kind, applies_to: scope };
}

/** Coupled resets — both "hours after the quiz" and "what we recommend"
 *  need per-shopper codes, so a shared or existing code resets them. */
export function withCodeMode(d: GuidedDiscount, mode: NonNullable<DiscountConfig["code_mode"]>): GuidedDiscount {
  const next: GuidedDiscount = { ...d, code_mode: mode };
  if (mode !== "dynamic") {
    if (next.expiry_mode === "hours") next.expiry_mode = "none";
    if (next.applies_to === "recommended") next.applies_to = "collections";
  }
  return next;
}

/** The first reason Save is blocked, in the handoff's order; null = saveable. */
export function saveBlocker(d: GuidedDiscount): string | null {
  const t = offerType(d);
  if (t !== "shipping" && !(d.value > 0)) return "A 0% / $0 reward takes nothing off. Give it a value.";
  if (d.kind === "percentage" && d.value > 100) return "A percentage cannot go over 100.";
  if (d.code_mode === "static" && !d.static_code.trim()) return "Type the code shoppers will use.";
  if (d.code_mode === "existing" && !d.existing_code.trim()) return "Pick the discount you already made.";
  if (d.code_mode !== "dynamic" && d.expiry_mode === "hours")
    return "A shared code can only expire on a fixed date. Pick a date, or switch to a code per shopper.";
  if (d.expiry_mode === "date" && !d.ends_at) return "Pick the date it expires.";
  if (t === "products" && d.applies_to === "collections" && d.applies_collection_ids.length === 0)
    return "Pick at least one collection.";
  if (t === "products" && d.applies_to === "products" && d.applies_product_ids.length === 0)
    return "Pick at least one product.";
  if (t === "shipping" && d.shipping_countries !== undefined && d.shipping_countries.length === 0)
    return "Pick at least one country.";
  return null;
}

/** "24h after each shopper finishes, rounded up to the hour — someone
 *  finishing now has until 3:00 PM Thursday." Codes come from hourly
 *  buckets (handoff §12): the discount ends at the end of the current hour
 *  plus N hours. */
export function expiryReadback(d: GuidedDiscount, now: Date): string | null {
  if (d.expiry_mode === "date") return d.ends_at ? `Ends ${d.ends_at.slice(0, 10)}` : null;
  if (d.expiry_mode !== "hours") return "Doesn't expire";
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  end.setHours(end.getHours() + 1 + d.expiry_hours);
  const time = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const day = end.toLocaleDateString("en-US", { weekday: "long" });
  const at = `${time} ${day}`;
  return `${d.expiry_hours}h after each shopper finishes, rounded up to the hour — someone finishing now has until ${at}, your time.`;
}

export type ReadbackRow = [label: string, value: string];

/** "What this creates in Shopify" — labelled rows, each suppressed when it
 *  has nothing to say. */
export function readbackRows(
  d: GuidedDiscount,
  opts: { now: Date; pickedLabel?: string },
): ReadbackRow[] {
  const rows: ReadbackRow[] = [];
  const t = offerType(d);
  const split = t === "products" && d.kind === "amount" && d.applies_on_each_item !== true;
  rows.push([
    "Discount",
    `${offerName(d, opts.pickedLabel)}${split ? " — split across the matching items, not taken off each one" : ""}`,
  ]);
  rows.push([
    "Code",
    d.code_mode === "existing"
      ? `${d.existing_code || "—"} — nothing is created; the discount is only read`
      : d.code_mode === "static"
        ? `${offerCodeDisplay(d)} — one code everyone shares`
        : `${offerCodeDisplay(d)} — a new code per shopper`,
  ]);
  const expires = expiryReadback(d, opts.now);
  if (expires) rows.push(["Expires", expires]);
  if (t === "shipping") {
    const where = d.shipping_countries?.length ? d.shipping_countries.join(", ") : "All countries";
    rows.push(["Shipping", `${where}${d.max_shipping_price ? ` · rates up to $${d.max_shipping_price}` : ""}`]);
  }
  const classes = (["product", "order", "shipping"] as const).filter((k) => d.combines?.[k] === true);
  rows.push(["Stacking", classes.length ? `Combines with ${classes.join(", ")} discounts` : "Combines with nothing"]);
  const limits = [
    d.minimum_subtotal ? `orders $${d.minimum_subtotal}+` : d.minimum_quantity ? `${d.minimum_quantity}+ items` : null,
    d.usage_limit
      ? d.code_mode === "dynamic"
        ? `${d.usage_limit} codes in total`
        : `${d.usage_limit} uses in total`
      : null,
    d.once_per_customer ? "one use per customer" : null,
  ].filter(Boolean);
  if (limits.length) rows.push(["Limits", limits.join(" · ")]);
  if (d.purchase !== "onetime") {
    const cycles =
      d.recurring_limit === 0 ? "every payment" : d.recurring_limit === 1 ? "the first payment" : `${d.recurring_limit} payments`;
    rows.push(["Subscriptions", `${d.purchase === "sub" ? "Subscriptions only" : "One-time and subscriptions"} · ${cycles}`]);
  }
  return rows;
}

/** Retired guided keys: parsed forever, never written again (handoff §8). */
export const RETIRED_DISCOUNT_KEYS = [
  "scope",
  "auto_apply",
  "eligibility",
  "segment",
  "exclude_sale",
  "deliver_on_page",
  "deliver_klaviyo",
  "deliver_rivo",
] as const;
