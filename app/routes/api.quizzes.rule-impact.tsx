import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { resolveApiShop } from "../lib/studioAccess.server";
import { Quiz } from "../lib/quizSchema";
import { enumeratePaths } from "../lib/pathEnumeration";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4.5 + G10 + DECISIONS) — the create-rule modal's impact
// line, computed SERVER-SIDE over the real path machinery (never the mock's
// client-side paths()). The real cap is enumeratePaths' 2 000 (not the mock's
// 200 000) — `truncated` drives the "(sampled)" wording.
//
// A rule "fires" on a path when every condition matches the path's selected
// answers. Two `is` conditions on one question can only co-occur for a
// multi-answer shopper, and enumeration forks ONE answer per question — that
// case returns notEstimable (§4.5 "Needs multi-answer shoppers").
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
  const { quizId, conditions } = parsed.data;

  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId: shop.id },
    select: { draftJson: true },
  });
  if (!quiz?.draftJson) return json({ ok: false, error: "Quiz not found" }, { status: 404 });
  const doc = Quiz.safeParse(quiz.draftJson);
  if (!doc.success) return json({ ok: false, error: "Draft not parseable" }, { status: 422 });

  // ≥2 `is` on one question ⇒ only multi-answer shoppers can match.
  const isByQuestion = new Map<string, number>();
  for (const c of conditions) {
    if (c.op !== "is") continue;
    isByQuestion.set(c.question_id, (isByQuestion.get(c.question_id) ?? 0) + 1);
  }
  if ([...isByQuestion.values()].some((n) => n > 1)) {
    return json({ ok: true, notEstimable: true });
  }

  const result = enumeratePaths(doc.data);
  const fires = result.paths.filter((p) => {
    const selected = new Set(p.selectedAnswerIds);
    return conditions.every((c) =>
      c.op === "is" ? selected.has(c.answer_id) : !selected.has(c.answer_id),
    );
  }).length;

  return json({
    ok: true,
    fires,
    total: result.paths.length,
    truncated: result.truncated,
  });
}
