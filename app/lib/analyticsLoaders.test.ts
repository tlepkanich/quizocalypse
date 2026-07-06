import type { LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import { ANALYTICS_EVENT_WINDOW } from "./analyticsWindow";
import { loader as analyticsLoader } from "../routes/studio.$id_.analytics";

// BIC-2 D2 — the studio analytics dashboard loader, driven end-to-end over a
// crafted prisma fixture. The pure aggregation libs each have their own unit
// suites; what was UNpinned is the loader's wiring: distinct-session funnel
// semantics, revenue dedupe by order_id, leaderboard CTR bounds, the hotspot
// cliff, the B2a truncation flag, and ?from/?to narrowing the prisma reads.
// Lives in app/lib per the publicWriteGuards precedent.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    event: { findMany: vi.fn() },
    quizSession: { findMany: vi.fn(), groupBy: vi.fn() },
    emailCapture: { count: vi.fn() },
    product: { findMany: vi.fn() },
  },
}));

// Auth + shop resolution are the studioAccessFlow suite's territory — stubbed
// here so the loader math is what's under test.
vi.mock("./studioAccess.server", () => ({
  requireStudioAccess: vi.fn(async () => undefined),
  resolveStudioShop: vi.fn(async () => ({ id: "s1", shopDomain: "studio.local" })),
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  event: { findMany: Mock };
  quizSession: { findMany: Mock; groupBy: Mock };
  emailCapture: { count: Mock };
  product: { findMany: Mock };
};

// Two-question product-match doc so the loader has flow-ordered questions.
const DOC = Quiz.parse({
  quiz_id: "qz1",
  status: "published",
  scope: { collection_ids: [] },
  nodes: [
    {
      id: "q1",
      type: "question",
      position: { x: 0, y: 0 },
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
      position: { x: 1, y: 0 },
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
      position: { x: 2, y: 0 },
      data: { headline: "Match", fallback_collection_id: "c1" },
    },
  ],
});

interface EventRow {
  sessionId: string;
  eventType: string;
  payload: unknown;
}

const ev = (sessionId: string, eventType: string, payload: unknown = {}): EventRow => ({
  sessionId,
  eventType,
  payload,
});

// s1 + s2 complete (s1 all the way to cart + an attributed order); s3 abandons
// after q1. Deliberate poison: duplicated events per session (distinct-session
// semantics) and the SAME order attributed to two sessions (order_id dedupe).
const FIXTURE_EVENTS: EventRow[] = [
  ev("s1", "quiz_started"),
  ev("s1", "quiz_started"), // duplicate — must not double-count
  ev("s2", "quiz_started"),
  ev("s3", "quiz_started"),
  ev("s1", "quiz_engaged"),
  ev("s2", "quiz_engaged"),
  ev("s3", "quiz_engaged"),
  ev("s1", "question_answered", { question_id: "q1" }),
  ev("s2", "question_answered", { question_id: "q1" }),
  ev("s3", "question_answered", { question_id: "q1" }),
  ev("s1", "question_answered", { question_id: "q2" }),
  ev("s2", "question_answered", { question_id: "q2" }),
  ev("s1", "quiz_completed"),
  ev("s2", "quiz_completed"),
  ev("s1", "recommendation_viewed", { product_ids: ["p1", "p2"] }),
  ev("s2", "recommendation_viewed", { product_ids: ["p1"] }),
  ev("s1", "recommendation_clicked", { product_id: "p1" }),
  ev("s1", "recommendation_clicked", { product_id: "p1" }), // duplicate click
  ev("s1", "add_to_cart", { product_id: "p1" }),
  // One real order, written against BOTH winning sessions → counts once.
  ev("s1", "order_attributed", { order_id: "o1", total_price: "50.00", currency: "USD" }),
  ev("s2", "order_attributed", { order_id: "o1", total_price: "50.00", currency: "USD" }),
];

function args(query = ""): LoaderFunctionArgs {
  const request = new Request(`https://studio.example/studio/qz1/analytics${query}`);
  return { request, params: { id: "qz1" }, context: {} } as unknown as LoaderFunctionArgs;
}

interface LoaderData {
  funnel: Record<string, number>;
  dropoff: Array<{ questionId: string; answered: number }>;
  hotspots: Array<{ questionId: string; severity: string; pctLostHere: number }>;
  conversion: { completed: number; converted: number; rate: number };
  captureCount: number;
  revenue: { formatted: string; orders: number };
  truncated: boolean;
  topProducts: Array<{ productId: string; title: string; impressions: number; clicks: number; ctr: number; atcRate: number }>;
}

async function runLoader(query = ""): Promise<LoaderData> {
  const res = await analyticsLoader(args(query));
  return (await res.json()) as LoaderData;
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
  p.event.findMany.mockResolvedValue(FIXTURE_EVENTS);
  p.quizSession.findMany.mockResolvedValue([{ converted: true }, { converted: false }]);
  p.quizSession.groupBy.mockResolvedValue([]);
  p.emailCapture.count.mockResolvedValue(1);
  p.product.findMany.mockResolvedValue([
    { productId: "p1", title: "Hydra Cream", imageUrl: null, handle: "hydra-cream" },
  ]);
});

describe("funnel + revenue + leaderboard math", () => {
  it("funnel counts DISTINCT sessions per stage (duplicates don't inflate)", async () => {
    const data = await runLoader();
    expect(data.funnel).toEqual({
      started: 3,
      engaged: 3,
      answered: 3,
      completed: 2,
      viewed: 2,
      addToCart: 1,
      clicked: 1,
    });
  });

  it("revenue dedupes by order_id — one order across two sessions counts once", async () => {
    const data = await runLoader();
    expect(data.revenue.orders).toBe(1);
    expect(data.revenue.formatted).toBe("50.00 USD");
  });

  it("conversion uses the event-based completed denominator + the session converted flag", async () => {
    const data = await runLoader();
    expect(data.conversion).toEqual({ completed: 2, converted: 1, rate: 0.5 });
  });

  it("product leaderboard: distinct-session CTR stays ≤ 100% despite duplicate clicks, and a product without catalog meta still surfaces", async () => {
    const data = await runLoader();
    const p1 = data.topProducts.find((r) => r.productId === "p1");
    expect(p1).toMatchObject({ title: "Hydra Cream", impressions: 2, clicks: 1, ctr: 0.5 });
    for (const row of data.topProducts) {
      expect(row.ctr).toBeLessThanOrEqual(1);
      expect(row.atcRate).toBeLessThanOrEqual(1);
    }
    // p2 was shown (s1) but never synced into the Product table — still listed.
    const p2 = data.topProducts.find((r) => r.productId === "p2");
    expect(p2).toMatchObject({ impressions: 1, clicks: 0 });
  });

  it("per-question drop-off in flow order + no hotspot noise below the traffic floor", async () => {
    const data = await runLoader();
    expect(data.dropoff.map((d) => [d.questionId, d.answered])).toEqual([
      ["q1", 3],
      ["q2", 2],
    ]);
    // 3 starts < HOTSPOT_MIN_STARTED — a 1-of-3 drop is not a trend.
    expect(data.hotspots).toEqual([]);
    expect(data.captureCount).toBe(1);
  });
});

describe("hotspot detection on a real cliff", () => {
  it("20 start, all answer q1, 5 answer q2 → one crit hotspot at q2", async () => {
    const sessions = Array.from({ length: 20 }, (_, i) => `s${i}`);
    p.event.findMany.mockResolvedValue([
      ...sessions.map((s) => ev(s, "quiz_started")),
      ...sessions.map((s) => ev(s, "question_answered", { question_id: "q1" })),
      ...sessions.slice(0, 5).map((s) => ev(s, "question_answered", { question_id: "q2" })),
    ]);
    const data = await runLoader();
    expect(data.hotspots).toHaveLength(1);
    expect(data.hotspots[0]).toMatchObject({ questionId: "q2", severity: "crit" });
    expect(data.hotspots[0]!.pctLostHere).toBeCloseTo(0.75);
  });
});

describe("B2a window + date range", () => {
  it("truncated=true when the fetch returns more than ANALYTICS_EVENT_WINDOW rows (and the extra row is dropped)", async () => {
    p.event.findMany.mockResolvedValue(
      Array.from({ length: ANALYTICS_EVENT_WINDOW + 1 }, (_, i) => ev(`s${i}`, "quiz_started")),
    );
    const data = await runLoader();
    expect(data.truncated).toBe(true);
    expect(data.funnel.started).toBe(ANALYTICS_EVENT_WINDOW);
  });

  it("exactly at the window → not truncated", async () => {
    p.event.findMany.mockResolvedValue(
      Array.from({ length: ANALYTICS_EVENT_WINDOW }, (_, i) => ev(`s${i}`, "quiz_started")),
    );
    expect((await runLoader()).truncated).toBe(false);
  });

  it("?from/?to narrows every timestamped read; `to` is inclusive end-of-day", async () => {
    await runLoader("?from=2026-01-01&to=2026-01-31");
    const eventWhere = (p.event.findMany.mock.calls[0]![0] as { where: { ts: { gte: Date; lte: Date } } })
      .where;
    expect(eventWhere.ts.gte).toEqual(new Date("2026-01-01"));
    expect(eventWhere.ts.lte).toEqual(new Date("2026-01-31T23:59:59.999Z"));
    const sessionWhere = (
      p.quizSession.findMany.mock.calls[0]![0] as { where: { startedAt: { gte: Date } } }
    ).where;
    expect(sessionWhere.startedAt.gte).toEqual(new Date("2026-01-01"));
    const captureWhere = (
      p.emailCapture.count.mock.calls[0]![0] as { where: { capturedAt: { gte: Date } } }
    ).where;
    expect(captureWhere.capturedAt.gte).toEqual(new Date("2026-01-01"));
  });

  it("an invalid date param is ignored (no ts constraint) rather than corrupting the query", async () => {
    await runLoader("?from=not-a-date");
    const where = (p.event.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect("ts" in where).toBe(false);
  });
});

describe("guards", () => {
  it("unknown quiz → 404 Response thrown", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    await expect(analyticsLoader(args())).rejects.toMatchObject({ status: 404 });
  });
});
