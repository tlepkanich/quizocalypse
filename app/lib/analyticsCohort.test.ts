import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { computeCohort, NOT_FINISHED_RESULT_ID, type CohortEvent } from "./analyticsCohort";
import { buildResultContext } from "./sessionResult";

// Tie-outs from ANALYTICS-HANDOFF.md "How the numbers tie together", on a
// legacy two-result doc.
const DOC = Quiz.parse({
  quiz_id: "qz1",
  status: "published",
  scope: { collection_ids: [] },
  nodes: [
    { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Skin type?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "Dry", tags: [], edge_handle_id: "h1" },
          { id: "a2", text: "Oily", tags: [], edge_handle_id: "h2" },
        ],
      },
    },
    { id: "rDry", type: "result", position: { x: 2, y: 0 }, data: { headline: "Hydrating set", fallback_collection_id: "c1" } },
    { id: "rOily", type: "result", position: { x: 2, y: 1 }, data: { headline: "Balancing set", fallback_collection_id: "c1" } },
  ],
  edges: [
    { id: "e1", source: "i1", target: "q1" },
    { id: "e2", source: "q1", target: "rDry", source_handle: "h1" },
    { id: "e3", source: "q1", target: "rOily", source_handle: "h2" },
  ],
});

const ctx = buildResultContext(DOC, DOC, new Map());
const T = Date.parse("2026-09-01T00:00:00Z");
const ev = (sessionId: string, eventType: string, payload: unknown = {}, ts = T): CohortEvent => ({
  sessionId,
  eventType,
  payload,
  ts,
});
const view = (sid: string, node: string) =>
  ev(sid, "recommendation_viewed", { result_node_id: node, product_ids: ["p1"] });
const order = (sid: string, id: string, total: string) =>
  ev(sid, "order_attributed", { order_id: id, total_price: total, currency: "USD" });

// s1 Dry, bought (two sessions share order o1 with s2); s2 Oily, bought;
// s3 Oily, added to cart; s4 Dry, finished, no email; s5 left an email, never
// finished; s6 started and left.
const IDS = new Set(["s1", "s2", "s3", "s4", "s5", "s6"]);
const EVENTS: CohortEvent[] = [
  ...["s1", "s2", "s3", "s4", "s5", "s6"].map((s) => ev(s, "quiz_engaged")),
  ...["s1", "s2", "s3", "s4"].map((s) => ev(s, "quiz_completed")),
  view("s1", "rDry"),
  view("s2", "rOily"),
  view("s3", "rOily"),
  view("s4", "rDry"),
  ev("s3", "add_to_cart", { product_id: "p1" }),
  ev("s5", "add_to_cart", { stage: "preview", product_id: "p1" }),
  order("s1", "o1", "40.00"),
  order("s2", "o1", "40.00"),
  order("s2", "o2", "60.00"),
  ev("zz", "quiz_completed"), // outside the cohort: ignored
];
const cap = (sid: string, consent: boolean | null, at = T) => ({
  id: `c-${sid}-${at}`,
  sessionId: sid,
  email: `${sid}@example.com`,
  capturedAt: new Date(at),
  marketingConsent: consent,
});
const CAPTURES = [cap("s1", true), cap("s2", false), cap("s3", true), cap("s5", true)];
const row = (sid: string, converted: boolean) => ({
  sessionId: sid,
  outcomeId: null,
  answerIds: [],
  matchedProductIds: ["p1"],
  converted,
  completedAt: new Date(T),
});
const SESSIONS = [row("s1", true), row("s2", true), row("s3", false), row("s4", false)];

const fig = computeCohort({
  doc: DOC,
  resultCtx: ctx,
  cohortIds: IDS,
  events: EVENTS,
  captures: CAPTURES,
  sessions: SESSIONS,
});

describe("computeCohort", () => {
  it("counts the funnel over the cohort only", () => {
    expect(fig).toMatchObject({ started: 6, finished: 4, contacts: 4, canEmail: 3, bought: 2 });
    expect(fig.revenue.orders).toBe(2);
  });

  it("results add up to Finished and are named by their headline", () => {
    const real = fig.results.filter((r) => r.resultId !== NOT_FINISHED_RESULT_ID);
    expect(real.reduce((n, r) => n + r.finished, 0)).toBe(fig.finished);
    expect(real.map((r) => [r.name, r.finished])).toEqual([
      ["Balancing set", 2],
      ["Hydrating set", 2],
    ]);
  });

  it("contacts per result add up to Contacts captured, with a row for those who left first", () => {
    expect(fig.results.reduce((n, r) => n + r.contacts, 0)).toBe(fig.contacts);
    expect(fig.results.find((r) => r.resultId === NOT_FINISHED_RESULT_ID)?.contacts).toBe(1);
  });

  it("orders and revenue per result add up to the totals, each order once", () => {
    expect(fig.results.reduce((n, r) => n + r.orders, 0)).toBe(fig.revenue.orders);
    const sum = fig.results.reduce((n, r) => n + (r.totalsByCurrency.USD ?? 0), 0);
    expect(sum).toBe(fig.revenue.totalsByCurrency.USD);
  });

  it("contact status: Bought, Added (quiz button, not preview), otherwise No purchase yet", () => {
    const status = Object.fromEntries(fig.contactList.map((c) => [c.sessionId, c.status]));
    expect(status).toEqual({ s1: "bought", s2: "bought", s3: "added", s5: "no-purchase" });
    const bought = fig.results.reduce((n, r) => n + r.contactsBought, 0);
    expect(bought).toBe(2);
  });

  it("consent is the latest explicit answer; a later form that never asked keeps it", () => {
    const later = computeCohort({
      doc: DOC,
      resultCtx: ctx,
      cohortIds: IDS,
      events: EVENTS,
      captures: [cap("s1", true), cap("s1", null, T + 1000), cap("s2", true), cap("s2", false, T + 1000)],
      sessions: SESSIONS,
    });
    const consent = Object.fromEntries(later.contactList.map((c) => [c.sessionId, c.consent]));
    expect(consent).toEqual({ s1: true, s2: false });
    expect(later.contacts).toBe(2);
  });
});
