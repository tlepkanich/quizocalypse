import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { buildSeedQuiz } from "../lib/seedQuiz";

// Builder Re-work Step 1 — the creation funnel's FRONT DOOR. Grouping is stage 1
// and is quiz-scoped (Categories bind to a quiz), so the funnel can't run without
// a draft. This loader resumes the most recent in-flight Step-1 draft (refresh /
// back returns to the same quiz + its confirmed groups), or creates a fresh one,
// then redirects to the nested resumable funnel at /studio/onboarding/:quizId.
// The "step1" buildState marks it in-flight; the dashboard filters it out until
// the merchant picks a direction (S5 flips it into the normal build).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  const inFlight = await prisma.quiz.findFirst({
    where: { shopId: shop.id, buildState: "step1" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (inFlight) return redirect(`/studio/onboarding/${inFlight.id}`);

  const doc = Quiz.parse({
    ...buildSeedQuiz("New quiz"),
    build_session: { stage: "grouping" },
  });
  const created = await prisma.quiz.create({
    data: {
      shopId: shop.id,
      name: "New quiz",
      status: "draft",
      buildState: "step1",
      draftJson: doc as never,
    },
    select: { id: true },
  });
  return redirect(`/studio/onboarding/${created.id}`);
};
