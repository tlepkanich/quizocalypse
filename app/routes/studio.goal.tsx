import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzCard } from "../components/qz";
import { createGoalQuizForShop } from "../lib/home.server";
import { EMPTY_GOAL_BRIEF, GoalBox, useGoalCreate, type GoalBrief } from "../components/studio/GoalBox";

// FLOW-1 (funnel-reconfig Flow 1) — the "Write Your Goal" front door. The
// merchant writes their goal BEFORE anything else; submitting claims/seeds the
// decider draft, kicks the detached AI product pre-pick, and lands them on the
// recs surface pre-populated for refinement.
// HOME-3 (first-run handoff §9) — the page mounts the shared GoalBox: goal,
// question count (Auto | 3–12), intro screen. Audience and deciding factors
// are no longer asked for anywhere.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const productCount = await prisma.product.count({ where: { shopId: shop.id } });
  // Owner 2026-07-25 — a goal box elsewhere may land here with ?goal= filled.
  const prefillGoal = new URL(request.url).searchParams.get("goal")?.trim().slice(0, 500) ?? "";
  return json({ prefillGoal, productCount });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const result = await createGoalQuizForShop(shop, await request.formData());
  if (!result.ok) return json(result, { status: 400 });
  return redirect(`/studio/onboarding/${result.quizId}`);
};

export default function StudioGoal() {
  const { prefillGoal, productCount } = useLoaderData<typeof loader>();
  const { create, busy, error } = useGoalCreate();
  const [brief, setBriefState] = useState<GoalBrief>({ ...EMPTY_GOAL_BRIEF, goal: prefillGoal });
  const setBrief = (next: Partial<GoalBrief>) => setBriefState((b) => ({ ...b, ...next }));

  return (
    <QzPage>
      <div className="qz-goal-page">
        <Link to="/studio" className="qz-sm-back">
          ← Back
        </Link>
        <h1 className="qz-h1" style={{ margin: "0 0 6px" }}>
          Write your goal
        </h1>
        <p className="qz-muted" style={{ margin: "0 0 18px", maxWidth: 520, fontSize: 14 }}>
          Tell us what your quiz should do — our AI picks the products it should recommend, then
          builds the questions around them. You review everything before it goes live.
        </p>

        <QzCard style={{ maxWidth: 620 }}>
          <GoalBox
            id="qz-goal"
            density="page"
            brief={brief}
            setBrief={setBrief}
            onCreate={() => create(brief)}
            busy={busy}
            error={error}
          />
        </QzCard>

        <p className="qz-dim" style={{ margin: "14px 0 0", fontSize: 12.5, maxWidth: 620 }}>
          Next: our AI picks the products your quiz should recommend
          {productCount > 0 ? ` from your ${productCount}-product catalog` : ""} — you refine the
          selection, then the questions are generated for you.
        </p>
      </div>
    </QzPage>
  );
}
