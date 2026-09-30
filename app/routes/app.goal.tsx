import type { ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { createGoalQuizForShop } from "../lib/home.server";

// HOME-3 (first-run handoff §12) — the embedded twin of /studio/goal's action.
// The shared GoalBox on the /app Home posts here; Shopify admin auth instead of
// the studio cookie, same shared create, lands in the embedded setup funnel.
// Action only: /app has no standalone goal page.

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) return json({ ok: false as const, error: "Shop not found" }, { status: 404 });
  const result = await createGoalQuizForShop(shop, await request.formData());
  if (!result.ok) return json(result, { status: 400 });
  return redirect(`/app/onboarding/${result.quizId}`);
};
