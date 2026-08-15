import type { LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import type { QuizAnalyticsData } from "./quizAnalytics.server";
import { loader as analyticsLoader } from "../routes/studio.$id_.analytics";

// ANALYTICS P0 — the per-quiz analytics loader driven end-to-end over a
// crafted prisma fixture, through the SHARED seam (quizAnalytics.server.ts).
// The pure libs (stepLedger, answerDistribution, confidence, insights) have
// their own unit suites; what's pinned here is the seam's WIRING: session
// cohorting (events fetched by sessionId, not by ts), distinct-session
// dedupe, order_id revenue dedupe, capture-session dedupe (W10), the preview
// impression filter (W4), confidence gating on thin n, auto-widen, and the
// 404 guard.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    event: { findMany: vi.fn(), findFirst: vi.fn() },
    quizSession: { findMany: vi.fn(), groupBy: vi.fn() },
    emailCapture: { findMany: vi.fn() },
    product: { findMany: vi.fn() },
    backInStockRequest: { findMany: vi.fn() },
    category: { findMany: vi.fn() },
  },
}));

vi.mock("./studioAccess.server", () => ({
  requireStudioAccess: vi.fn(async () => undefined),
  resolveStudioShop: vi.fn(async () => ({ id: "s1", shopDomain: "studio.local" })),
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  event: { findMany: Mock; findFirst: Mock };
  quizSession: { findMany: Mock; groupBy: Mock };
  emailCapture: { findMany: Mock };
  product: { findMany: Mock };
  backInStockRequest: { findMany: Mock };
  category: { findMany: Mock };
};

// Linear intro → q1 → q2 → result spine so the step ledger reconciles.
const DOC = Quiz.parse({
  quiz_id: "qz1",
  status: "published",
  scope: { collection_ids: [] },
  nodes: [
    { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } },
    {
      id: "q1",
      type: "question",
      position: { x: 1, y: 0 },
      data: {
        text: "Skin type?",
        question_type: "single_select",
        answers: [
          { id: "a1", text: "Dry", tags: [], edge_handle_id: "h1" },
          { id: "a1b", text: "Oily", tags: [], edge_handle_id: "h1b" },
        ],
      },
    },
    {
      id: "q2",
      type: "question",
      position: { x: 2, y: 0 },
      data: {
        text: "Budget?",
        question_type: "single_select",
        answers: [
          { id: "a2", text: "Any", tags: [], edge_handle_id: "h2" },
          { id: "a2b", text: "Under $50", tags: [], edge_handle_id: "h2b" },
        ],
      },
    },
    {
      id: "r1",
      type: "result",
      position: { x: 3, y: 0 },
      data: { headline: "Match", fallback_collection_id: "c1" },
    },
  ],
  edges: [
    { id: "e1", source: "i1", target: "q1" },
    { id: "e2", source: "q1", target: "q2" },
    { id: "e3", source: "q2", target: "r1" },
  ],
});

interface EventRow {
  sessionId: string;
  eventType: string;
  payload: unknown;
  ts: Date;
}

const T0 = new Date("2026-08-01T12:00:00Z");
const ev = (sessionId: string, eventType: string, payload: unknown = {}, ts = T0): EventRow => ({
  sessionId,
  eventType,
  payload,
  ts,
});

// s1 completes with an order; s2 SKIPS q2 and completes; s3 leaves after q1.
// Poison built in: duplicate events (distinct-session semantics), the same
// order on two sessions (order_id dedupe), a preview-stage impression (W4),
// and two capture ROWS for one session (W10).
const COHORT_EVENTS: EventRow[] = [
  ev("s1", "quiz_engaged"),
  ev("s1", "quiz_engaged"), // duplicate — must not double-count
  ev("s2", "quiz_engaged"),
  ev("s3", "quiz_engaged"),
  ev("s1", "question_answered", { question_id: "q1", answer_ids: ["a1"] }),
  ev("s2", "question_answered", { question_id: "q1", answer_ids: ["a1b"] }),
  ev("s3", "question_answered", { question_id: "q1", answer_ids: ["a1"] }),
  ev("s1", "question_answered", { question_id: "q2", answer_ids: ["a2"] }),
  ev("s2", "question_answered", { question_id: "q2", answer_ids: [] }), // an explicit SKIP
  ev("s1", "quiz_completed"),
  ev("s2", "quiz_completed"),
  ev("s1", "recommendation_viewed", { product_ids: ["p1", "p2"] }),
  ev("s2", "recommendation_viewed", { product_ids: ["p1"] }),
  // W4 poison — a mid-quiz preview impression must NOT count.
  ev("s3", "recommendation_viewed", { stage: "preview", product_ids: ["p1"] }),
  ev("s1", "recommendation_clicked", { product_id: "p1" }),
  ev("s1", "recommendation_clicked", { product_id: "p1" }), // duplicate click
  ev("s1", "add_to_cart", { product_id: "p1" }),
  ev("s1", "order_attributed", { order_id: "o1", total_price: "50.00", currency: "USD" }),
  ev("s2", "order_attributed", { order_id: "o1", total_price: "50.00", currency: "USD" }),
];

const ENGAGE_ROWS = [{ sessionId: "s1" }, { sessionId: "s2" }, { sessionId: "s3" }];

/** Dispatch the three event.findMany shapes the seam issues. */
function installEventDispatch(opts?: { engaged?: Array<{ sessionId: string }>; events?: EventRow[] }) {
  p.event.findMany.mockImplementation((q: { where: Record<string, unknown> }) => {
    const where = q.where;
    if (where.eventType === "quiz_engaged" && !("sessionId" in where)) {
      return Promise.resolve(opts?.engaged ?? ENGAGE_ROWS);
    }
    if (typeof where.eventType === "object" && where.eventType !== null) {
      return Promise.resolve([]); // prior-period delta query
    }
    if ("sessionId" in where) {
      return Promise.resolve(opts?.events ?? COHORT_EVENTS);
    }
    return Promise.resolve([]);
  });
}

function args(query = "?r=90d"): LoaderFunctionArgs {
  const request = new Request(`https://studio.example/studio/qz1/analytics${query}`);
  return { request, params: { id: "qz1" }, context: {} } as unknown as LoaderFunctionArgs;
}

async function runLoader(query = "?r=90d"): Promise<QuizAnalyticsData> {
  const res = await analyticsLoader(args(query));
  return ((await res.json()) as { data: QuizAnalyticsData }).data;
}

beforeEach(() => {
  vi.clearAllMocks();
  p.quiz.findFirst.mockResolvedValue({
    id: "qz1",
    name: "Skin quiz",
    status: "published",
    publishedJson: DOC,
    draftJson: null,
  });
  installEventDispatch();
  p.event.findFirst.mockResolvedValue(null);
  p.quizSession.findMany.mockResolvedValue([]);
  p.quizSession.groupBy.mockResolvedValue([]);
  // W10 poison — two rows, ONE session: back-nav resubmit added a row.
  p.emailCapture.findMany.mockResolvedValue([
    { id: "c1", sessionId: "s1", email: "amy@example.com", capturedAt: T0 },
    { id: "c2", sessionId: "s1", email: "amy@example.com", capturedAt: T0 },
  ]);
  p.product.findMany.mockResolvedValue([
    { productId: "p1", title: "Hydra Cream", imageUrl: null, handle: "hydra-cream" },
  ]);
  p.backInStockRequest.findMany.mockResolvedValue([]);
  p.category.findMany.mockResolvedValue([]);
});

describe("cohorting", () => {
  it("fetches cohort events by sessionId with NO ts filter — a session's late events stay in its range", async () => {
    await runLoader();
    const cohortCall = p.event.findMany.mock.calls.find(
      (c) => "sessionId" in (c[0] as { where: Record<string, unknown> }).where,
    );
    expect(cohortCall).toBeTruthy();
    const where = (cohortCall![0] as { where: Record<string, unknown> }).where;
    expect(where.sessionId).toEqual({ in: ["s1", "s2", "s3"] });
    expect("ts" in where).toBe(false);
  });

  it("distinct sessions per stage — duplicates don't inflate; completed ≤ engaged holds", async () => {
    const data = await runLoader();
    expect(data.kpis.engaged).toBe(3);
    expect(data.kpis.completed).toBe(2);
  });
});

describe("KPI honesty", () => {
  it("completion at n=3 is SUPPRESSED (gate 50), never a confident percentage", async () => {
    const data = await runLoader();
    expect(data.kpis.completion.state).toBe("suppressed");
    expect(data.kpis.completion.showsAt).toBe(50);
  });

  it("captures count DISTINCT SESSIONS, not rows (W10)", async () => {
    const data = await runLoader();
    expect(data.kpis.captureSessions).toBe(1);
  });

  it("the contacts table lists one row per SHOPPER — a duplicate capture row can't list them twice", async () => {
    const data = await runLoader();
    expect(data.contacts.rows).toHaveLength(1);
    expect(data.contacts.counts.all).toBe(1);
    // On-screen the address is masked; only the export carries it in full.
    expect(data.contacts.rows[0]!.emailMasked).not.toContain("amy@");
  });

  it("captures are fetched BY COHORT SESSION, not by capturedAt", async () => {
    await runLoader();
    const where = (p.emailCapture.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.sessionId).toEqual({ in: ["s1", "s2", "s3"] });
    expect("capturedAt" in where).toBe(false);
  });

  it("revenue dedupes by order_id across sessions", async () => {
    const data = await runLoader();
    expect(data.kpis.revenue.orders).toBe(1);
    expect(data.kpis.revenue.formatted).toBe("50.00 USD");
    // One shared order across two sessions = ONE buyer, never two.
    expect(data.kpis.buyers).toBe(1);
  });
});

describe("preview impression filter (W4)", () => {
  it("a stage:'preview' recommendation_viewed adds no impression", async () => {
    const data = await runLoader();
    const p1 = data.products.find((r) => r.productId === "p1");
    expect(p1).toMatchObject({ impressions: 2, clicks: 1 });
    // p2 was shown but never synced into the Product table — still listed.
    expect(data.products.find((r) => r.productId === "p2")).toMatchObject({ impressions: 1 });
  });
});

describe("step ledger", () => {
  it("reconciles: reached = continued + skipped + left on the linear spine, with the [] answer as a skip", async () => {
    const data = await runLoader();
    const q1 = data.ledger!.steps.find((s) => s.nodeId === "q1")!;
    const q2 = data.ledger!.steps.find((s) => s.nodeId === "q2")!;
    expect(q1).toMatchObject({ reached: 3, continued: 2, skipped: 0, left: 1 });
    expect(q1.reached).toBe(q1.continued! + q1.skipped! + q1.left!);
    expect(q2).toMatchObject({ reached: 2, continued: 1, skipped: 1, left: 0 });
    expect(data.ledger!.steepestNodeId).toBe("q1");
  });

  it("answer distributions bucket the skip separately", async () => {
    const data = await runLoader();
    const q2 = data.answers.find((a) => a.questionId === "q2")!;
    expect(q2.answered).toBe(1);
    expect(q2.skipped).toBe(1);
  });
});

describe("range + widen", () => {
  it("?r=90d sends a ts range on the ENGAGE query only", async () => {
    await runLoader();
    const engageCall = p.event.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect("ts" in engageCall.where).toBe(true);
  });

  it("a thin DEFAULT window auto-widens to all time and says so", async () => {
    let calls = 0;
    p.event.findMany.mockImplementation((q: { where: Record<string, unknown> }) => {
      const where = q.where;
      if (where.eventType === "quiz_engaged" && !("sessionId" in where)) {
        calls += 1;
        // First (ranged) fetch: 1 session. Widened (unranged) fetch: all 3.
        return Promise.resolve(calls === 1 ? [{ sessionId: "s1" }] : ENGAGE_ROWS);
      }
      if (typeof where.eventType === "object" && where.eventType !== null) return Promise.resolve([]);
      if ("sessionId" in where) return Promise.resolve(COHORT_EVENTS);
      return Promise.resolve([]);
    });
    const data = await runLoader(""); // no ?r → default preset, widen allowed
    expect(data.range.widened).toBe(true);
    expect(data.kpis.engaged).toBe(3);
  });

  it("an explicit ?r never widens", async () => {
    installEventDispatch({ engaged: [{ sessionId: "s1" }] });
    const data = await runLoader("?r=90d");
    expect(data.range.widened).toBe(false);
    expect(data.kpis.engaged).toBe(1);
  });
});

describe("insights + guards", () => {
  it("a live quiz under 200 sessions gets the traffic-starved card", async () => {
    const data = await runLoader();
    expect(data.insights.cards.some((c) => c.id === "traffic-starved")).toBe(true);
  });

  it("unknown quiz → 404 Response thrown", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    await expect(analyticsLoader(args())).rejects.toMatchObject({ status: 404 });
  });
});

// ── Decider-only surfaces ──────────────────────────────────────────────────
// No decider doc is published in the local fixture DB, so the product-reach
// paths and reachability states are pinned here rather than by screenshot.
describe("product reach paths (decider docs)", () => {
  const DECIDER = {
    ...JSON.parse(JSON.stringify(DOC)),
    logic_model: "decider",
    nodes: [
      { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi", subtext: "", button_label: "Start" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Skin type?",
          question_type: "single_select",
          required: true,
          role: "decides",
          answers: [
            { id: "a1", text: "Dry", tags: [], edge_handle_id: "h1", target_id: "t1" },
            { id: "a2", text: "Oily", tags: [], edge_handle_id: "h2", target_id: "t2" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 2, y: 0 }, data: { headline: "Match", fallback_collection_id: "c1" } },
    ],
    product_index: [
      { product_id: "p1", title: "Serum", collection_ids: [] },
      { product_id: "p2", title: "Cream", collection_ids: [] },
      { product_id: "p9", title: "Orphan", collection_ids: [] },
    ],
    // p1 sits in BOTH groups (the over-shown explanation); p9 in neither.
    target_product_ids_map: { t1: ["p1", "p2"], t2: ["p1"] },
    target_index: { t1: { type: "collection", name: "Dry & Sensitive" }, t2: { type: "collection", name: "Oily" } },
  };

  beforeEach(() => {
    p.quiz.findFirst.mockResolvedValue({
      id: "qz1",
      name: "Skin quiz",
      status: "published",
      publishedJson: DECIDER,
      draftJson: null,
    });
  });

  it("derives 'how shoppers reach this product' from the answer→target map", async () => {
    const data = await runLoader();
    const p1 = data.products.find((r) => r.productId === "p1")!;
    expect(p1.groupCount).toBe(2);
    expect(p1.paths.map((x) => `${x.answer}→${x.target}`).sort()).toEqual([
      "Dry→Dry & Sensitive",
      "Oily→Oily",
    ]);
  });

  it("a product in no group is UNREACHABLE and still listed, with no paths", async () => {
    const data = await runLoader();
    const orphan = data.products.find((r) => r.productId === "p9")!;
    expect(orphan.state).toBe("unreachable");
    expect(orphan.paths).toEqual([]);
    expect(orphan.impressions).toBe(0);
  });

  it("reports the mapped/unreachable counts for the section header", async () => {
    const data = await runLoader();
    expect(data.productMeta).toEqual({ mapped: 3, unreachable: 1 });
  });
});
