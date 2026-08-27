import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { resolveApiShop } from "../lib/studioAccess.server";
import { Quiz } from "../lib/quizSchema";
import { enumeratePaths } from "../lib/pathEnumeration";
import { ruleConditionsMatch } from "../lib/recommendDecider";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4.5 + G10 + DECISIONS) — the create-rule modal's impact
// line, computed SERVER-SIDE over the real path machinery (never the mock's
// client-side paths()). The real cap is enumeratePaths' 2 000 (not the mock's
// 200 000) — `truncated` drives the "(sampled)" wording.
//
// A rule "fires" on a path when ruleConditionsMatch says so — the ONE shared
// predicate from recommendDecider (logic-step handoff §3), so this endpoint
// can never drift from the runtime. Two all-of `is` conditions on one
// question (not listed in any_of) can only co-occur for a multi-answer
// shopper, and enumeration forks ONE answer per question — that case returns
// notEstimable (§4.5 "Needs multi-answer shoppers"). An any-of column IS
// estimable: each enumerated path carries one of its answers at a time.
// ════════════════════════════════════════════════════════════════════════════

const BodySchema = z.object({
  quizId: z.string().min(1),
  conditions: z
    .array(
      z.object({
        question_id: z.string().min(1),
        answer_id: z.string().min(1),
        op: z.enum(["is", "is_not"]),
      }),
    )
    .min(1)
    .max(24),
  match: z.enum(["all", "any"]).optional(),
  any_of: z.array(z.string().min(1)).optional(),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  const shop = await resolveApiShop(request);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const { quizId, conditions, match, any_of } = parsed.data;

  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId: shop.id },
    select: { draftJson: true },
  });
  if (!quiz?.draftJson) return json({ ok: false, error: "Quiz not found" }, { status: 404 });
  const doc = Quiz.safeParse(quiz.draftJson);
  if (!doc.success) return json({ ok: false, error: "Draft not parseable" }, { status: 422 });

  // A question group with ≥2 all-of `is` conditions can only be satisfied by
  // a multi-answer shopper, and enumeration forks ONE answer per question.
  // match all: one such group makes the whole rule unenumerable; match any:
  // only when EVERY group is (an estimable group can still fire the rule).
  const anyOf = new Set(any_of ?? []);
  const isByQuestion = new Map<string, number>();
  const questionIds = new Set<string>();
  for (const c of conditions) {
    questionIds.add(c.question_id);
    if (c.op !== "is") continue;
    isByQuestion.set(c.question_id, (isByQuestion.get(c.question_id) ?? 0) + 1);
  }
  const unenumerable = (qid: string) =>
    (isByQuestion.get(qid) ?? 0) > 1 && !anyOf.has(qid);
  const notEstimable =
    match === "any"
      ? [...questionIds].every(unenumerable)
      : [...questionIds].some(unenumerable);
  if (notEstimable) {
    return json({ ok: true, notEstimable: true });
  }

  const result = enumeratePaths(doc.data);
  const candidate = {
    conditions,
    ...(match ? { match } : {}),
    ...(any_of?.length ? { any_of } : {}),
  };
  const fires = result.paths.filter((p) =>
    ruleConditionsMatch(candidate, new Set(p.selectedAnswerIds)),
  ).length;

  return json({
    ok: true,
    fires,
    total: result.paths.length,
    truncated: result.truncated,
  });
}
