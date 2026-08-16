import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import {
  handleInsightDismissForm,
  loadDismissals,
  setInsightDismissal,
} from "./quizAnalytics.server";
import { INSIGHT_SNOOZE_DAYS } from "./quizInsights";

// ANALYTICS — the 14-day snooze (owner, 2026-08-16). A dismissal HIDES a
// finding temporarily; it never mutes one forever, so a problem the merchant
// never fixed comes back on its own.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    insightDismissal: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  insightDismissal: { findMany: Mock; upsert: Mock; deleteMany: Mock };
};

const NOW = new Date("2026-08-16T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  p.quiz.findFirst.mockResolvedValue({ id: "q1" }); // owned by the shop
  p.insightDismissal.findMany.mockResolvedValue([]);
  p.insightDismissal.upsert.mockResolvedValue({});
  p.insightDismissal.deleteMany.mockResolvedValue({ count: 1 });
});

describe("setInsightDismissal", () => {
  it("snoozes for exactly 14 days from now", async () => {
    const res = await setInsightDismissal("shop1", "q1", "leak:n3", "dismiss", NOW);
    expect(res.ok).toBe(true);
    const arg = p.insightDismissal.upsert.mock.calls[0]![0];
    const until = arg.create.snoozedUntil as Date;
    expect(+until - +NOW).toBe(INSIGHT_SNOOZE_DAYS * 86_400_000);
    // Upsert, so dismissing twice can't pile up rows for one object.
    expect(arg.where).toEqual({ quizId_cardId: { quizId: "q1", cardId: "leak:n3" } });
    expect(arg.update.snoozedUntil).toEqual(until);
  });

  it("restore deletes the row outright", async () => {
    await setInsightDismissal("shop1", "q1", "leak:n3", "restore", NOW);
    expect(p.insightDismissal.deleteMany).toHaveBeenCalledWith({
      where: { quizId: "q1", cardId: "leak:n3" },
    });
    expect(p.insightDismissal.upsert).not.toHaveBeenCalled();
  });

  it("a quiz the shop doesn't own writes NOTHING", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    const res = await setInsightDismissal("shop1", "someone-elses-quiz", "leak:n3", "dismiss", NOW);
    expect(res.ok).toBe(false);
    expect(p.insightDismissal.upsert).not.toHaveBeenCalled();
    expect(p.insightDismissal.deleteMany).not.toHaveBeenCalled();
  });
});

describe("loadDismissals", () => {
  it("a live snooze is active; a LAPSED one is not — the finding returns", async () => {
    p.insightDismissal.findMany.mockResolvedValue([
      { quizId: "q1", cardId: "still-hidden", snoozedUntil: new Date("2026-08-30T12:00:00Z") },
      { quizId: "q1", cardId: "lapsed", snoozedUntil: new Date("2026-08-02T12:00:00Z") },
    ]);
    const st = (await loadDismissals(["q1"], NOW)).get("q1")!;
    expect([...st.active]).toEqual(["still-hidden"]);
    // The lapsed row is KEPT so the count stays truthful and a re-dismissal
    // updates rather than inserting.
    expect(st.until.has("lapsed")).toBe(true);
  });

  it("no quizzes → no query", async () => {
    const out = await loadDismissals([], NOW);
    expect(out.size).toBe(0);
    expect(p.insightDismissal.findMany).not.toHaveBeenCalled();
  });
});

describe("handleInsightDismissForm", () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  it("ignores a form that isn't a dismissal (returns null, writes nothing)", async () => {
    const res = await handleInsightDismissForm("shop1", form({ intent: "publish" }), NOW);
    expect(res).toBeNull();
    expect(p.insightDismissal.upsert).not.toHaveBeenCalled();
  });

  it("rejects a dismissal missing its ids rather than writing a partial row", async () => {
    const res = await handleInsightDismissForm("shop1", form({ intent: "dismiss-insight", quizId: "q1" }), NOW);
    expect(res).toEqual({ ok: false });
    expect(p.insightDismissal.upsert).not.toHaveBeenCalled();
  });

  it("routes dismiss and restore to the right operation", async () => {
    await handleInsightDismissForm("shop1", form({ intent: "dismiss-insight", quizId: "q1", cardId: "c" }), NOW);
    expect(p.insightDismissal.upsert).toHaveBeenCalledTimes(1);
    await handleInsightDismissForm("shop1", form({ intent: "restore-insight", quizId: "q1", cardId: "c" }), NOW);
    expect(p.insightDismissal.deleteMany).toHaveBeenCalledTimes(1);
  });
});
