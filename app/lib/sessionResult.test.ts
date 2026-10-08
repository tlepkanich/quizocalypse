import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  NO_MATCH_RESULT_ID,
  UNKNOWN_RESULT_ID,
  buildResultContext,
  resolveSessionResult,
  revenueByResult,
  tallyResults,
  type SessionResult,
  type SessionResultFacts,
} from "./sessionResult";

// ── fixtures ────────────────────────────────────────────────────────────────

const question = (id: string, role: string | undefined, answers: Array<Record<string, unknown>>) => ({
  id,
  type: "question",
  position: { x: 0, y: 0 },
  data: { text: `${id}?`, question_type: "single_select", ...(role ? { role } : {}), answers },
});

const DECIDER = Quiz.parse({
  quiz_id: "qz1",
  scope: { collection_ids: [] },
  logic_model: "decider",
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    question("q1", "decides", [
      { id: "park", text: "Park", tags: [], edge_handle_id: "h1", target_id: "cat_park" },
      { id: "powder", text: "Powder", tags: [], edge_handle_id: "h2", target_id: "cat_powder" },
      { id: "unsure", text: "Not sure", tags: [], edge_handle_id: "h3" },
    ]),
    { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "Match", fallback_collection_id: "c1" } },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "r1" },
  ],
  results_pages: [],
});

const LEGACY = Quiz.parse({
  quiz_id: "qz2",
  scope: { collection_ids: [] },
  nodes: [
    { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
    question("q1", undefined, [
      { id: "a", text: "A", tags: [], edge_handle_id: "h1" },
      { id: "b", text: "B", tags: [], edge_handle_id: "h2" },
    ]),
    { id: "rA", type: "result", position: { x: 0, y: 0 }, data: { headline: "The Minimalist", fallback_collection_id: "c1" } },
    { id: "rB", type: "result", position: { x: 0, y: 0 }, data: { headline: "The Collector", fallback_collection_id: "c1" } },
  ],
  edges: [
    { id: "e1", source: "intro", target: "q1" },
    { id: "e2", source: "q1", target: "rA", source_handle: "h1" },
    { id: "e3", source: "q1", target: "rB", source_handle: "h2" },
  ],
});

// `target_index` rides the RAW published JSON only.
const PUBLISHED = { target_index: { cat_park: { type: "collection", name: "Park boards" } } };
const CATEGORIES = new Map([
  ["cat_park", "Park (renamed since publish)"],
  ["cat_powder", "Powder boards"],
]);
const dctx = buildResultContext(DECIDER, PUBLISHED, CATEGORIES);
const lctx = buildResultContext(LEGACY, null, new Map());

const view = (payload: Record<string, unknown>, ts = 100) => ({ ts, payload });
const deciderView = (extra: Record<string, unknown>, ts = 100) =>
  view({ result_node_id: "r1", product_ids: ["p1"], secondary_product_ids: [], matched_rule_id: null, ...extra }, ts);
const facts = (f: Partial<SessionResultFacts>): SessionResultFacts => ({ finished: true, views: [], ...f });
const row = (r: Partial<NonNullable<SessionResultFacts["row"]>>) => ({
  outcomeId: "r1",
  answerIds: [],
  matchedProductIds: ["p1"],
  completedAt: new Date("2026-08-01T00:00:00Z"),
  ...r,
});

// ── decider ────────────────────────────────────────────────────────────────

describe("resolveSessionResult — decider docs", () => {
  it("the result is the resolved target, named from the baked target_index", () => {
    const r = resolveSessionResult(dctx, facts({ views: [deciderView({ resolved_target_id: "cat_park" })] }));
    expect(r).toMatchObject({ resultId: "cat_park", name: "Park boards", noMatch: false, source: "event", resultNodeId: "r1" });
  });

  it("falls back to the live Category name for a target added since publish", () => {
    const r = resolveSessionResult(dctx, facts({ views: [deciderView({ resolved_target_id: "cat_powder" })] }));
    expect(r?.name).toBe("Powder boards");
  });

  it("a deleted target keeps its bucket and is flagged stale", () => {
    const r = resolveSessionResult(dctx, facts({ views: [deciderView({ resolved_target_id: "cat_gone" })] }));
    expect(r).toMatchObject({ resultId: "cat_gone", name: "(deleted recommendation)", stale: true });
  });

  it("no resolved target is No match", () => {
    const r = resolveSessionResult(dctx, facts({ views: [deciderView({ fallback_source: "best_sellers" })] }));
    expect(r).toMatchObject({ resultId: NO_MATCH_RESULT_ID, noMatch: true, noMatchKind: "unresolved" });
  });

  it("a target that resolved but showed the fallback is No match, with the target kept (owner ruling)", () => {
    const r = resolveSessionResult(
      dctx,
      facts({ views: [deciderView({ resolved_target_id: "cat_park", fallback_source: "best_sellers" })] }),
    );
    expect(r).toMatchObject({ resultId: NO_MATCH_RESULT_ID, noMatchKind: "empty_target", intendedTargetId: "cat_park" });
  });

  it("a target that resolved with nothing to show is No match too", () => {
    const r = resolveSessionResult(dctx, facts({ views: [deciderView({ resolved_target_id: "cat_park", product_ids: [] })] }));
    expect(r).toMatchObject({ resultId: NO_MATCH_RESULT_ID, noMatchKind: "empty_target" });
  });

  it("a retake's latest result wins, and a mid-quiz preview is never a result", () => {
    const r = resolveSessionResult(
      dctx,
      facts({
        views: [
          deciderView({ resolved_target_id: "cat_park" }, 100),
          deciderView({ resolved_target_id: "cat_powder" }, 200),
          view({ stage: "preview", product_ids: ["p9"] }, 300),
        ],
      }),
    );
    expect(r?.resultId).toBe("cat_powder");
  });

  it("keeps the matched rule as a dimension, not as the identity", () => {
    const r = resolveSessionResult(
      dctx,
      facts({ views: [deciderView({ resolved_target_id: "cat_park", matched_rule_id: "rule_7" })] }),
    );
    expect(r).toMatchObject({ resultId: "cat_park", matchedRuleId: "rule_7" });
  });

  it("a legacy-shaped view with no products on a decider doc is the unresolved shopper", () => {
    const r = resolveSessionResult(dctx, facts({ views: [view({ result_node_id: "r1", product_ids: [] })] }));
    expect(r).toMatchObject({ resultId: NO_MATCH_RESULT_ID, noMatchKind: "unresolved" });
  });

  it("with no event, the session row's answers re-run the logic", () => {
    const hit = resolveSessionResult(dctx, facts({ row: row({ answerIds: ["powder"] }) }));
    expect(hit).toMatchObject({ resultId: "cat_powder", source: "derived" });
    const miss = resolveSessionResult(dctx, facts({ row: row({ answerIds: ["unsure"] }) }));
    expect(miss).toMatchObject({ resultId: NO_MATCH_RESULT_ID, source: "derived" });
  });

  it("with no event and no row, the events' own answers are the last resort", () => {
    expect(resolveSessionResult(dctx, facts({ eventAnswerIds: ["park"] }))?.resultId).toBe("cat_park");
    expect(resolveSessionResult(dctx, facts({}))?.resultId).toBe(UNKNOWN_RESULT_ID);
  });

  it("an unfinished session with no row has no result", () => {
    expect(resolveSessionResult(dctx, facts({ finished: false, eventAnswerIds: ["park"] }))).toBeNull();
  });
});

// ── legacy ─────────────────────────────────────────────────────────────────

describe("resolveSessionResult — legacy docs", () => {
  it("the result is the result node, named by its headline", () => {
    const r = resolveSessionResult(lctx, facts({ views: [view({ result_node_id: "rB", product_ids: ["p1"] })] }));
    expect(r).toMatchObject({ resultId: "rB", name: "The Collector", noMatch: false, source: "event" });
  });

  it("reads QuizSession.outcomeId as a NODE id when no event survived", () => {
    const r = resolveSessionResult(lctx, facts({ row: row({ outcomeId: "rA" }) }));
    expect(r).toMatchObject({ resultId: "rA", name: "The Minimalist", source: "session_row" });
  });

  it("no products shown is No match (the node it landed on is kept)", () => {
    const fromEvent = resolveSessionResult(lctx, facts({ views: [view({ result_node_id: "rA", product_ids: [] })] }));
    expect(fromEvent).toMatchObject({ resultId: NO_MATCH_RESULT_ID, noMatch: true, resultNodeId: "rA" });
    const fromRow = resolveSessionResult(lctx, facts({ row: row({ outcomeId: "rA", matchedProductIds: [] }) }));
    expect(fromRow?.noMatch).toBe(true);
  });

  it("a finished session with no record lands in Unknown on a multi-result quiz", () => {
    expect(resolveSessionResult(lctx, facts({}))?.resultId).toBe(UNKNOWN_RESULT_ID);
  });

  it("a quiz with ONE result needs no record at all", () => {
    const single = Quiz.parse({
      ...LEGACY,
      nodes: LEGACY.nodes.filter((n) => n.id !== "rB"),
      edges: LEGACY.edges.filter((e) => e.target !== "rB"),
    });
    const ctx = buildResultContext(single, null, new Map());
    expect(resolveSessionResult(ctx, facts({}))).toMatchObject({ resultId: "rA", source: "derived" });
  });

  it("a deleted node keeps its bucket, flagged stale", () => {
    const r = resolveSessionResult(lctx, facts({ views: [view({ result_node_id: "r_gone", product_ids: ["p1"] })] }));
    expect(r).toMatchObject({ resultId: "r_gone", stale: true });
  });
});

// ── tallies ────────────────────────────────────────────────────────────────

const result = (resultId: string, name = resultId, noMatch = false): SessionResult => ({
  resultId,
  name,
  noMatch,
  resultNodeId: null,
  source: "event",
});

describe("tallyResults", () => {
  it("adds up to the sessions passed in; No match and Unknown sort last", () => {
    const rows = tallyResults([
      result(NO_MATCH_RESULT_ID, "No match", true),
      result(NO_MATCH_RESULT_ID, "No match", true),
      result(NO_MATCH_RESULT_ID, "No match", true),
      result("a"),
      result("b"),
      result("b"),
      result(UNKNOWN_RESULT_ID),
    ]);
    expect(rows.map((r) => [r.resultId, r.count])).toEqual([
      ["b", 2],
      ["a", 1],
      [NO_MATCH_RESULT_ID, 3],
      [UNKNOWN_RESULT_ID, 1],
    ]);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(7);
  });
});

describe("revenueByResult", () => {
  const order = (sessionId: string, orderId: string, total: string, ts: number) => ({
    sessionId,
    ts,
    payload: { order_id: orderId, total_price: total, currency: "USD" },
  });
  const bySession = new Map([
    ["s1", result("a", "Result A")],
    ["s2", result("b", "Result B")],
  ]);

  it("counts each order once, under the earliest session that won it", () => {
    const rows = revenueByResult(
      [order("s2", "o1", "50.00", 200), order("s1", "o1", "50.00", 100), order("s2", "o2", "30.00", 300)],
      bySession,
    );
    expect(rows).toEqual([
      { resultId: "a", name: "Result A", noMatch: false, orders: 1, totalsByCurrency: { USD: 50 } },
      { resultId: "b", name: "Result B", noMatch: false, orders: 1, totalsByCurrency: { USD: 30 } },
    ]);
  });

  it("an order whose session has no result goes to Unknown, so the rows still add up", () => {
    const rows = revenueByResult([order("s1", "o1", "50.00", 100), order("s9", "o2", "20.00", 200)], bySession);
    expect(rows.reduce((n, r) => n + r.orders, 0)).toBe(2);
    expect(rows.find((r) => r.resultId === UNKNOWN_RESULT_ID)?.totalsByCurrency).toEqual({ USD: 20 });
  });

  it("skips malformed order rows exactly as totalRevenue does", () => {
    const rows = revenueByResult(
      [
        { sessionId: "s1", ts: 1, payload: { total_price: "9.00" } },
        { sessionId: "s1", ts: 2, payload: { order_id: "o1", total_price: "abc" } },
      ],
      bySession,
    );
    expect(rows).toEqual([]);
  });
});
