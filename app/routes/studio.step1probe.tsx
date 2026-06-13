import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { recordIdentitySignals } from "../lib/brandIdentityBuild.server";
import { generateStep1TemplateOptions } from "../lib/step1Build.server";

// TEMPORARY (Step 1 S3) — a headless JSON probe for the deploy: fold a struggle
// signal into the identity, then generate the 2-3 template directions from the
// real identity + catalog. Deleted at S4 when the real funnel lands.
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const goal = String(form.get("goal") ?? "Help shoppers find the right products for them");
  const struggle = String(form.get("struggle") ?? "");

  const recorded = struggle ? await recordIdentitySignals(shop.id, { struggle }) : null;
  const options = await generateStep1TemplateOptions(shop.id, { goal, struggle: struggle || undefined });

  return json({
    ok: true,
    pain_points: recorded?.ok ? recorded.identity.pain_points : null,
    pain_points_locked: recorded?.ok ? recorded.identity.locked_fields.includes("pain_points") : null,
    options,
  });
};
