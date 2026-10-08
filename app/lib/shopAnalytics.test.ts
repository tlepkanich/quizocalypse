import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import { shopAnalyticsForShop } from "./quizAnalytics.server";

// ANALYTICS P0 — the Analytics HOME seam (spec Screen 1). Live and draft
// quizzes share one row set; a draft's metrics are null (an em-dash on screen),
// never 0, and its Status cell carries the worst structural finding.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    emailCapture: { findMany: vi.fn() },
    insightDismissal: { findMany: vi.fn() },
  },
}));

const p = prisma as unknown as {
  quiz: { findMany: Mock };
  event: { findMany: Mock };
  emailCapture: { findMany: Mock };
  insightDismissal: { findMany: Mock };
};

function doc(questions: number, results: number) {
  return Quiz.parse({
    quiz_id: "qz",
    status: "published",
    scope: { collection_ids: [] },
    nodes: [
      { id: "i1", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      ...Array.from({ length: questions }, (_, i) => ({
        id: `q${i}`,
        type: "question",
        position: { x: i + 1, y: 0 },
        data: {
          text: `Question ${i}?`,
          question_type: "single_select",
          answers: [
            { id: `q${i}a`, text: "A", tags: [], edge_handle_id: `q${i}h1` },
            { id: `q${i}b`, text: "B", tags: [], edge_handle_id: `q${i}h2` },
          ],
        },
      })),
      ...Array.from({ length: results }, (_, i) => ({
        id: `r${i}`,
        type: "result",
        position: { x: 20, y: i },
        data: { headline: `R${i}`, fallback_collection_id: "c" },
      })),
    ],
  });
}

const ev = (quizId: string, eventType: string, sessionId: string, payload: unknown = {}, ts = new Date()) => ({
  quizId,
  eventType,
  sessionId,
  payload,
  ts,
});

/** The seam's two event queries: the engage cohort, then the cohort's later events. */
function installEvents(rows: ReturnType<typeof ev>[], prior: ReturnType<typeof ev>[] = []) {
  p.event.findMany.mockImplementation((q: { where: Record<string, unknown> }) => {
    const w = q.where;
    const isPrior = Boolean((w.ts as { lte?: Date } | undefined)?.lte && +(w.ts as { lte: Date }).lte < Date.now() - 86_400_000);
    const pool = isPrior ? prior : rows;
    if (w.eventType === "quiz_engaged") return Promise.resolve(pool.filter((r) => r.eventType === "quiz_engaged"));
    const types = (w.eventType as { in: string[] }).in;
    const sids = (w.sessionId as { in: string[] }).in;
    return Promise.resolve(
      [...rows, ...prior].filter((r) => types.includes(r.eventType) && sids.includes(r.sessionId)),
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  p.quiz.findMany.mockResolvedValue([
    { id: "live1", name: "Skin Type Finder", status: "published", draftJson: doc(3, 3), publishedJson: doc(3, 3) },
    // A draft whose every answer routes to one outcome — the structural flag.
    { id: "draft1", name: "Skill & Terrain Match", status: "draft", draftJson: doc(4, 1), publishedJson: null },
    { id: "draft2", name: "Gift Finder", status: "draft", draftJson: doc(3, 3), publishedJson: null },
  ]);
  installEvents([
    ev("live1", "quiz_engaged", "s1"),
    ev("live1", "quiz_engaged", "s2"),
    ev("live1", "quiz_completed", "s1"),
  ]);
  p.emailCapture.findMany.mockResolvedValue([{ quizId: "live1", sessionId: "s1" }]);
  p.insightDismissal.findMany.mockResolvedValue([]);
});

async function run() {
  return shopAnalyticsForShop({ id: "shop1" }, new URLSearchParams("r=90d"));
}

describe("home rows", () => {
  it("puts live and draft quizzes in ONE row set with a live flag", async () => {
    const data = await run();
    expect(data.rows).toHaveLength(3);
    expect(data.counts).toEqual({ all: 3, live: 1, draft: 2 });
  });

  it("a draft's metrics are null — no data is not the same as zero", async () => {
    const data = await run();
    const draft = data.rows.find((r) => r.id === "draft2")!;
    expect(draft.live).toBe(false);
    expect(draft.starts).toBeNull();
    expect(draft.completion).toBeNull();
    expect(draft.contacts).toBeNull();
    expect(draft.orders).toBeNull();
    expect(draft.revenue).toBeNull();
    expect(draft.perFinisher).toBeNull();
  });

  it("a draft with a structural problem carries a short Status flag", async () => {
    const data = await run();
    expect(data.rows.find((r) => r.id === "draft1")!.flag).toBe("1 result only");
    // A healthy draft gets no flag — the pill just reads "Draft".
    expect(data.rows.find((r) => r.id === "draft2")!.flag).toBeNull();
  });

  it("a live quiz reports real counts and a low-confidence completion rate", async () => {
    const data = await run();
    const live = data.rows.find((r) => r.id === "live1")!;
    expect(live.starts).toBe(2);
    expect(live.contacts).toBe(1);
    // The rate is COMPUTED and shown; `state` only drives the asterisk.
    expect(live.completion!.rate).toBeCloseTo(0.5);
    expect(live.completion!.state).toBe("suppressed"); // n=2 → asterisk + hover
    expect(live.completion!.n).toBe(2);
  });

  it("a live quiz with zero sessions carries n=0, so the view can dash it", async () => {
    installEvents([]);
    const data = await run();
    const live = data.rows.find((r) => r.id === "live1")!;
    expect(live.starts).toBe(0);
    expect(live.completion!.n).toBe(0);
  });

  it("drafts contribute nothing to the roll-up tiles", async () => {
    const data = await run();
    expect(data.tiles.sessions).toBe(2);
    expect(data.tiles.finished).toBe(1);
    expect(data.tiles.contacts).toBe(1);
  });

  it("surfaces structural findings from drafts, worst first", async () => {
    const data = await run();
    expect(data.findings.length).toBeGreaterThan(0);
    expect(data.findings[0]!.severity).toBe("crit");
    expect(data.findings[0]!.quizName).toBe("Skill & Terrain Match");
  });

  it("lists every quiz, drafts included, behind a safety cap", async () => {
    await run();
    const call = p.quiz.findMany.mock.calls[0]![0] as { where: Record<string, unknown>; take: number };
    expect("status" in call.where).toBe(false);
    expect(call.take).toBe(200);
  });

  it("counts by session cohort: a completion belongs to its engage period", async () => {
    // s3 engaged long before the range and finished inside it: not counted.
    installEvents([
      ev("live1", "quiz_engaged", "s1"),
      ev("live1", "quiz_completed", "s1"),
      ev("live1", "quiz_completed", "s3"),
    ]);
    const data = await run();
    const live = data.rows.find((r) => r.id === "live1")!;
    expect(live.starts).toBe(1);
    expect(live.completion!.rate).toBeCloseTo(1);
  });

  it("one order credits one quiz, and the tiles equal the sum of the live rows", async () => {
    installEvents([
      ev("live1", "quiz_engaged", "s1"),
      ev("live1", "quiz_completed", "s1"),
      ev("live1", "order_attributed", "s1", { order_id: "o1", total_price: "30.00", currency: "USD" }),
      ev("live1", "order_attributed", "s1", { order_id: "o1", total_price: "30.00", currency: "USD" }),
    ]);
    const data = await run();
    const live = data.rows.filter((r) => r.live);
    expect(data.tiles.orders).toBe(live.reduce((n, r) => n + (r.orders ?? 0), 0));
    expect(data.tiles.orders).toBe(1);
    expect(data.tiles.revenueNumeric).toBe(30);
    expect(data.tiles.liveQuizzes).toBe(1);
  });

  it("Compare adds the previous period, counted the same way", async () => {
    installEvents(
      [ev("live1", "quiz_engaged", "s1")],
      [ev("live1", "quiz_engaged", "p1"), ev("live1", "quiz_engaged", "p2"), ev("live1", "quiz_completed", "p1")],
    );
    const data = await shopAnalyticsForShop({ id: "shop1" }, new URLSearchParams("r=30d&cmp=1"));
    expect(data.compare).toBe(true);
    expect(data.tiles.prior).toMatchObject({ starts: 2, finished: 1 });
    expect(data.rows.find((r) => r.id === "live1")!.prior).toMatchObject({ starts: 2, finished: 1 });
    expect(data.tiles.sessionsDeltaPct).toBe(-50);
  });

  it("live quizzes also get the traffic findings over their own cohort", async () => {
    const data = await run();
    const starved = data.findings.find((f) => f.quizId === "live1" && f.cardId === "traffic-starved");
    expect(starved).toBeTruthy();
    // Drafts never get a traffic finding.
    expect(data.findings.some((f) => f.quizId !== "live1" && f.cardId === "traffic-starved")).toBe(false);
  });
});

