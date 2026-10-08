// "Create Klaviyo segment" (ANALYTICS-HANDOFF.md, Data work 8) — the panel's
// group as rules Klaviyo keeps evaluating by itself. Pure, and shared by the
// panel (which lists the rules before the merchant presses Create) and the
// server (which turns the same rules into Klaviyo's segment definition), so
// what the merchant reads is what Klaviyo gets.
//
// Klaviyo's definition: condition_groups are ANDed; conditions inside a group
// are ORed. Every rule here is its own group.
//
// - "Took the quiz" and the answer / result / product are filters on the
//   quiz's own "Completed Quiz" event (q.$id.integration.tsx writes the quiz
//   id, the result name, every answer under its question text, and the
//   recommended product ids on it). That keeps a segment to ONE quiz even
//   when a shopper took several.
// - Status uses Klaviyo's own commerce metrics (Placed Order, Added to Cart,
//   Started Checkout) over the attribution window, so its counts can differ
//   slightly from ours (the panel says so).
// - EVERY segment requires email marketing consent, whatever the panel's
//   switch says: a Klaviyo segment only ever holds people Klaviyo may email.

import { ATTRIBUTION_WINDOW_DAYS } from "./conversionAttribution";

export const COMPLETED_QUIZ_METRIC = "Completed Quiz";
export const PLACED_ORDER_METRIC = "Placed Order";
export const ADDED_TO_CART_METRIC = "Added to Cart";
export const STARTED_CHECKOUT_METRIC = "Started Checkout";

/** Event property names on "Completed Quiz" (written by the integration route). */
export const EVENT_PROPS = {
  quizId: "quiz_id",
  result: "quiz_result",
  products: "recommended_product_ids",
} as const;

export type SegmentStatus = "all" | "bought" | "added" | "no-purchase";

export interface SegmentSpec {
  quizId: string;
  quizName: string;
  facet:
    | { kind: "all" }
    | { kind: "answer"; questionText: string; answerText: string }
    | { kind: "result"; resultName: string; noMatch?: boolean }
    | { kind: "product"; productId: string; productTitle: string };
  status: SegmentStatus;
}

/** The rules in the merchant's words, in the order Klaviyo will check them. */
export function segmentRules(spec: SegmentSpec): string[] {
  const rules = [`Took the quiz “${spec.quizName}”`];
  const f = spec.facet;
  if (f.kind === "answer") rules.push(`Answered “${f.answerText}” to “${f.questionText}”`);
  else if (f.kind === "product") rules.push(`Was recommended “${f.productTitle}”`);
  else if (f.kind === "result") rules.push(f.noMatch ? "Saw the fallback products (no match)" : `Got the result “${f.resultName}”`);
  const days = ATTRIBUTION_WINDOW_DAYS;
  if (spec.status === "bought") rules.push(`Placed an order in the last ${days} days`);
  else if (spec.status === "added") rules.push(`Added to cart in the last ${days} days, and has not placed an order in that time`);
  else if (spec.status === "no-purchase") rules.push(`Has not started checkout or placed an order in the last ${days} days`);
  rules.push("Can receive email marketing");
  return rules;
}

export interface MetricIds {
  completedQuiz: string;
  placedOrder?: string;
  addedToCart?: string;
  startedCheckout?: string;
}

type Json = Record<string, unknown>;

function metric(metricId: string, op: "greater-than" | "equals", value: number, metricFilters?: Json[]): Json {
  return {
    type: "profile-metric",
    metric_id: metricId,
    measurement: "count",
    measurement_filter: { type: "numeric", operator: op, value },
    timeframe_filter:
      metricFilters !== undefined
        ? { type: "date", operator: "alltime" }
        : { type: "date", operator: "in-the-last", unit: "day", quantity: ATTRIBUTION_WINDOW_DAYS },
    ...(metricFilters ? { metric_filters: metricFilters } : {}),
  };
}

const group = (...conditions: Json[]): Json => ({ conditions });

/** Which commerce metrics a spec needs (their ids are looked up by name). */
export function metricsNeeded(status: SegmentStatus): Array<keyof Omit<MetricIds, "completedQuiz">> {
  if (status === "bought") return ["placedOrder"];
  if (status === "added") return ["addedToCart", "placedOrder"];
  if (status === "no-purchase") return ["startedCheckout", "placedOrder"];
  return [];
}

/** Klaviyo's segment definition for a spec. Throws when a metric id is missing. */
export function segmentDefinition(spec: SegmentSpec, ids: MetricIds): Json {
  const quizFilters: Json[] = [
    { property: EVENT_PROPS.quizId, filter: { type: "string", operator: "equals", value: spec.quizId } },
  ];
  const f = spec.facet;
  if (f.kind === "answer") {
    // Each answer is saved under its question text, as a list of answer texts.
    quizFilters.push({ property: f.questionText, filter: { type: "list", operator: "contains-any", value: [f.answerText] } });
  } else if (f.kind === "result") {
    quizFilters.push({ property: EVENT_PROPS.result, filter: { type: "string", operator: "equals", value: f.resultName } });
  } else if (f.kind === "product") {
    quizFilters.push({ property: EVENT_PROPS.products, filter: { type: "list", operator: "contains-any", value: [f.productId] } });
  }
  const need = (k: keyof MetricIds): string => {
    const id = ids[k];
    if (!id) throw new Error(`Klaviyo metric missing: ${k}`);
    return id;
  };
  const groups: Json[] = [group(metric(ids.completedQuiz, "greater-than", 0, quizFilters))];
  if (spec.status === "bought") groups.push(group(metric(need("placedOrder"), "greater-than", 0)));
  else if (spec.status === "added") {
    groups.push(group(metric(need("addedToCart"), "greater-than", 0)));
    groups.push(group(metric(need("placedOrder"), "equals", 0)));
  } else if (spec.status === "no-purchase") {
    groups.push(group(metric(need("startedCheckout"), "equals", 0)));
    groups.push(group(metric(need("placedOrder"), "equals", 0)));
  }
  groups.push(
    group({
      type: "profile-marketing-consent",
      consent: { channel: "email", can_receive_marketing: true, consent_status: { subscription: "subscribed" } },
    }),
  );
  return { condition_groups: groups };
}

/** The default segment name: "Wiskr · {group} · {status}". */
export function defaultSegmentName(groupName: string, status: SegmentStatus): string {
  const label: Record<SegmentStatus, string> = {
    all: "",
    bought: "Bought",
    added: "Added, not bought",
    "no-purchase": "No purchase yet",
  };
  return `Wiskr · ${groupName}${status === "all" ? "" : ` · ${label[status]}`}`.slice(0, 120);
}
