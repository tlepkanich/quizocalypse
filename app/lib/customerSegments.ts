// §R-8 / §S-4 — smart segments for the Customers re-engagement hub. Pure +
// testable: given each captured contact's quiz session (outcome, matched
// products, converted flag, completion) and whether they're on a back-in-stock
// list, classify them into the flagship money segments. A contact can be in
// several segments at once (e.g. didn't-buy AND back-in-stock).

export interface ContactSession {
  /** Resolved persona/outcome name (Category.name) or null. */
  persona: string | null;
  answerCount: number;
  /** # products we matched them to (drives the "didn't buy" money segment). */
  matchedCount: number;
  /** Resolved recommended product titles for display (may be fewer than matchedCount). */
  recommended: string[];
  converted: boolean;
  completed: boolean;
}

export interface SegmentDef {
  key: string;
  label: string;
  blurb: string;
  flagship?: boolean;
}

// Ordered flagship-first (matches the hub layout).
export const SEGMENTS: SegmentDef[] = [
  { key: "didnt_buy", label: "Recommended → didn't buy", blurb: "Got a match but haven't purchased — your warmest win-back.", flagship: true },
  { key: "abandoned", label: "Abandoned before results", blurb: "Shared contact, then left before seeing their result." },
  { key: "purchased", label: "Purchased → upsell", blurb: "Bought after the quiz — ready for the next product." },
  { key: "back_in_stock", label: "Back-in-stock waiting", blurb: "Waiting on a recommended product to restock." },
];

export function contactSegments(c: { session: ContactSession | null; backInStock: boolean }): string[] {
  const out: string[] = [];
  const s = c.session;
  if (s) {
    if (s.completed && !s.converted && s.matchedCount > 0) out.push("didnt_buy");
    if (!s.completed) out.push("abandoned");
    if (s.converted) out.push("purchased");
  }
  if (c.backInStock) out.push("back_in_stock");
  return out;
}

/** Count per segment key across a set of already-classified contacts. */
export function summarizeSegments(contacts: Array<{ segments: string[] }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of SEGMENTS) counts[s.key] = 0;
  for (const c of contacts) for (const k of c.segments) counts[k] = (counts[k] ?? 0) + 1;
  return counts;
}
