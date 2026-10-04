import { beforeEach, describe, expect, it, vi } from "vitest";
import { Quiz } from "./quizSchema";
import prisma from "../db.server";
import { quizVersionsForShop, restoreQuizVersionForShop } from "./quizVersions.server";

vi.mock("../db.server", () => ({ default: {
  quiz: { findFirst: vi.fn(), updateMany: vi.fn() },
  quizVersion: { findFirst: vi.fn(), findMany: vi.fn() },
} }));
const doc = Quiz.parse({ quiz_id: "q1", logic_model: "decider", status: "draft", scope: { collection_ids: [] }, nodes: [{ id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Welcome" } }, { id: "end", type: "end", position: { x: 0, y: 100 }, data: { headline: "Thanks" } }], edges: [], results_pages: [] });
const date = new Date("2026-10-04T12:00:00.000Z");
function form() {
  const data = new FormData();
  data.set("intent", "restore"); data.set("versionId", "v1"); data.set("updatedAt", date.toISOString());
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.quiz.findFirst).mockResolvedValue({ id: "q1", name: "Quiz", draftJson: doc, version: 2, status: "published", updatedAt: date } as never);
  vi.mocked(prisma.quizVersion.findFirst).mockResolvedValue({ version: 1, publishedJson: doc } as never);
  vi.mocked(prisma.quizVersion.findMany).mockResolvedValue([{ id: "v1", version: 1, publishedAt: date }] as never);
  vi.mocked(prisma.quiz.updateMany).mockResolvedValue({ count: 1 });
});
describe("standalone published history", () => {
  it("scopes access to the shop and lists only ten snapshot summaries", async () => {
    const result = await quizVersionsForShop("shop1", "q1");
    expect(prisma.quiz.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "q1", shopId: "shop1" } }));
    expect(prisma.quizVersion.findMany).toHaveBeenCalledWith({ where: { quizId: "q1" }, orderBy: { version: "desc" }, take: 10, select: { id: true, version: true, publishedAt: true } });
    expect(result.versions).toEqual([{ id: "v1", version: 1, publishedAt: date.toISOString() }]);
    expect(result.quiz).not.toHaveProperty("draftJson");
  });
  it("does not disclose history from a missing or foreign quiz", async () => {
    vi.mocked(prisma.quiz.findFirst).mockResolvedValue(null);
    await expect(quizVersionsForShop("other", "q1")).rejects.toMatchObject({ status: 404 });
    expect(prisma.quizVersion.findMany).not.toHaveBeenCalled();
    expect((await restoreQuizVersionForShop("other", "q1", form())).status).toBe(404);
    expect(prisma.quiz.updateMany).not.toHaveBeenCalled();
  });
  it("restores only draftJson, guarded against intervening saves and active generation", async () => {
    expect(await restoreQuizVersionForShop("shop1", "q1", form())).toEqual({ ok: true, restoredVersion: 1, status: 200 });
    expect(prisma.quizVersion.findFirst).toHaveBeenCalledWith({ where: { id: "v1", quiz: { id: "q1", shopId: "shop1" } }, select: { version: true, publishedJson: true } });
    expect(prisma.quiz.updateMany).toHaveBeenCalledWith({
      where: { id: "q1", shopId: "shop1", updatedAt: date, OR: [{ buildState: null }, { buildState: { not: "building" } }] },
      data: { draftJson: doc },
    });
  });
  it("returns a recoverable conflict when the compare-and-swap cannot write", async () => {
    vi.mocked(prisma.quiz.updateMany).mockResolvedValue({ count: 0 });
    expect(await restoreQuizVersionForShop("shop1", "q1", form())).toMatchObject({ ok: false, status: 409 });
  });
  it("rejects missing, expired or foreign snapshot IDs without writing", async () => {
    vi.mocked(prisma.quizVersion.findFirst).mockResolvedValue(null);
    expect((await restoreQuizVersionForShop("shop1", "q1", form())).status).toBe(404);
    expect(prisma.quiz.updateMany).not.toHaveBeenCalled();
  });
  it.each([{}, { ...doc, logic_model: undefined }])("rejects invalid or legacy snapshots", async snapshot => {
    vi.mocked(prisma.quizVersion.findFirst).mockResolvedValue({ version: 1, publishedJson: snapshot } as never);
    expect((await restoreQuizVersionForShop("shop1", "q1", form())).status).toBe(400);
    expect(prisma.quiz.updateMany).not.toHaveBeenCalled();
  });
  it("keeps legacy quizzes outside the new feature", async () => {
    vi.mocked(prisma.quiz.findFirst).mockResolvedValue({ draftJson: { ...doc, logic_model: undefined } } as never);
    await expect(quizVersionsForShop("shop1", "q1")).rejects.toMatchObject({ status: 400 });
    expect((await restoreQuizVersionForShop("shop1", "q1", form())).status).toBe(400);
    expect(prisma.quiz.updateMany).not.toHaveBeenCalled();
  });
  it("refuses a detached funnel generation even without buildState", async () => {
    vi.mocked(prisma.quiz.findFirst).mockResolvedValue({ draftJson: { ...doc, build_session: { stage: "templating" } } } as never);
    expect((await restoreQuizVersionForShop("shop1", "q1", form())).status).toBe(409);
    expect(prisma.quiz.updateMany).not.toHaveBeenCalled();
  });
  it("validates input before accessing storage", async () => {
    const input = form(); input.set("updatedAt", "yesterday");
    expect((await restoreQuizVersionForShop("shop1", "q1", input)).status).toBe(400);
    expect(prisma.quiz.findFirst).not.toHaveBeenCalled();
  });
});
