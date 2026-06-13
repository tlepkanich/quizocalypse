import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { findOrCreateStep1Draft } from "../lib/step1Funnel.server";

// Builder Re-work Step 1 — the studio funnel's FRONT DOOR. Resumes the in-flight
// Step-1 draft or seeds a fresh one (shared with the embedded twin), then
// redirects to the nested resumable funnel at /studio/onboarding/:quizId.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizId = await findOrCreateStep1Draft(shop.id);
  return redirect(`/studio/onboarding/${quizId}`);
};
