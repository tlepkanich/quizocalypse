import type { DiscountConfig } from "./quizSchema";

// Results handoff §8 "What the shopper is told" — ONE set of helpers feeds
// the offer bar, the unlock card and (later) the Klaviyo event, so all three
// always agree. Words are built from the structured fields, never from
// Shopify's `summary`.

type Offer = Pick<
  DiscountConfig,
  | "kind"
  | "value"
  | "applies_to"
  | "minimum_subtotal"
  | "minimum_quantity"
  | "ends_at"
  | "code"
  | "code_mode"
  | "code_prefix"
  | "static_code"
  | "expiry_mode"
  | "expiry_hours"
  | "purchase"
  | "applies_on_each_item"
>;

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** Shopify's discount types, as the editor offers them. */
export type OfferType = "order" | "products" | "shipping";

export function offerType(d: Pick<Offer, "kind" | "applies_to">): OfferType {
  if (d.kind === "free_shipping") return "shipping";
  return d.applies_to === "all" ? "order" : "products";
}

/** "10% off" · "$10 off" · "Free shipping". */
export function offerValue(d: Pick<Offer, "kind" | "value">): string {
  if (d.kind === "free_shipping") return "Free shipping";
  return d.kind === "amount" ? `${money(d.value)} off` : `${d.value}% off`;
}

/** The noun follows the scope. A picked list is named by the caller. */
export function offerNoun(d: Pick<Offer, "kind" | "applies_to">, pickedLabel?: string): string {
  if (d.kind === "free_shipping") return "";
  if (d.applies_to === "all") return "your order";
  if (d.applies_to === "recommended") return "your match";
  return pickedLabel?.trim() || "selected items";
}

/** The terms a shopper needs to redeem it — a minimum the page never
 *  mentioned is a code that silently fails at checkout. */
export function offerTerms(
  d: Pick<Offer, "minimum_subtotal" | "minimum_quantity" | "expiry_mode" | "expiry_hours" | "ends_at">,
): string {
  const parts: string[] = [];
  if (d.minimum_subtotal) parts.push(`orders ${money(d.minimum_subtotal)}+`);
  else if (d.minimum_quantity) parts.push(`${d.minimum_quantity}+ items`);
  if (d.expiry_mode === "hours" && d.expiry_hours) parts.push(`expires in ${d.expiry_hours}h`);
  else if (d.expiry_mode === "date" && d.ends_at) parts.push(`ends ${d.ends_at.slice(0, 10)}`);
  return parts.map((p) => ` · ${p}`).join("");
}

/** The discount's name as the builder lists it: "10% off your order". */
export function offerName(d: Pick<Offer, "kind" | "value" | "applies_to">, pickedLabel?: string): string {
  const noun = offerNoun(d, pickedLabel);
  return `${offerValue(d)}${noun ? ` ${noun}` : ""}`;
}

/** "10% off your order · orders $50+ · expires in 24h". */
export function offerLine(d: Offer, pickedLabel?: string): string {
  if (d.kind === "free_shipping") return `Free shipping${offerTerms(d)}`;
  const noun = offerNoun(d, pickedLabel);
  return `${offerValue(d)}${noun ? ` ${noun}` : ""}${offerTerms(d)}`;
}

/** What the code reads as: a masked per-shopper code, the typed shared
 *  code, or the existing discount — never a real minted code. */
export function offerCodeDisplay(
  d: Pick<Offer, "code_mode" | "code_prefix" | "static_code">,
): string {
  if (d.code_mode === "existing") return "your existing code";
  if (d.code_mode === "static") return d.static_code?.trim() || "—";
  return `${d.code_prefix ?? "QUIZ-"}••••••`;
}

/**
 * Card prices strike only for a product discount scoped to what we
 * recommend, not locked behind the email, and not subscription-only. A fixed
 * amount "once per order" is split across the matching cards; per item, each
 * card takes the full amount. Returns the per-card cut, or null for none.
 */
export function cardCut(
  d: Offer,
  opts: { locked: boolean; matchingCards: number },
): { kind: "percentage" | "amount"; value: number } | null {
  if (opts.locked || d.kind === "free_shipping" || d.applies_to !== "recommended") return null;
  if (d.purchase === "sub") return null;
  if (d.kind === "percentage") return { kind: "percentage", value: d.value };
  const n = Math.max(1, opts.matchingCards);
  return { kind: "amount", value: d.applies_on_each_item ? d.value : d.value / n };
}
