import { z } from "zod";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";

/** Standalone history is decider-only; legacy restore behavior is unchanged. */
export async function quizVersionsForShop(shopId: string, id: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId },
    select: { id: true, name: true, version: true, status: true, draftJson: true, updatedAt: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  const doc = Quiz.safeParse(quiz.draftJson);
  if (!doc.success || doc.data.logic_model !== "decider") {
    throw new Response("Published history is available for decider quizzes", { status: 400 });
  }
  const versions = await prisma.quizVersion.findMany({
    where: { quizId: id }, orderBy: { version: "desc" }, take: 10,
    select: { id: true, version: true, publishedAt: true },
  });
  return {
    quiz: { id: quiz.id, name: quiz.name, version: quiz.version, status: quiz.status, updatedAt: quiz.updatedAt.toISOString() },
    versions: versions.map(v => ({ ...v, publishedAt: v.publishedAt.toISOString() })),
  };
}

const Restore = z.object({
  intent: z.literal("restore"), versionId: z.string().min(1).max(200),
  updatedAt: z.string().datetime(),
});

export async function restoreQuizVersionForShop(shopId: string, id: string, form: FormData) {
  const input = Restore.safeParse(Object.fromEntries(form));
  if (!input.success) return { ok: false as const, error: "Invalid restore request.", status: 400 };
  const quiz = await prisma.quiz.findFirst({ where: { id, shopId }, select: { draftJson: true } });
  if (!quiz) return { ok: false as const, error: "Quiz not found.", status: 404 };
  const current = Quiz.safeParse(quiz.draftJson);
  if (!current.success || current.data.logic_model !== "decider") {
    return { ok: false as const, error: "Published history is available for decider quizzes.", status: 400 };
  }
  if (current.data.build_session?.gen_progress || ["generating", "typing", "templating"].includes(current.data.build_session?.stage ?? "")) {
    return { ok: false as const, error: "Wait for quiz generation to finish before restoring.", status: 409 };
  }
  const version = await prisma.quizVersion.findFirst({
    where: { id: input.data.versionId, quiz: { id, shopId } },
    select: { version: true, publishedJson: true },
  });
  if (!version) return { ok: false as const, error: "Version no longer available. Reload history.", status: 404 };
  const parsed = Quiz.safeParse(version.publishedJson);
  if (!parsed.success || parsed.data.logic_model !== "decider") {
    return { ok: false as const, error: "This version cannot be restored into this builder.", status: 400 };
  }
  // Atomic compare-and-swap: a save or publish since the history page loaded
  // must not be silently overwritten. Never write publishedJson/status/version.
  const result = await prisma.quiz.updateMany({
    where: { id, shopId, updatedAt: new Date(input.data.updatedAt), OR: [{ buildState: null }, { buildState: { not: "building" } }] },
    data: { draftJson: parsed.data as never },
  });
  if (!result.count) return { ok: false as const, error: "The quiz changed or is being generated. Reload history before restoring.", status: 409 };
  return { ok: true as const, restoredVersion: version.version, status: 200 };
}
