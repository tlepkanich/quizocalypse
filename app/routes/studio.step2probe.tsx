import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { generateStep2Types, generateStep2Templates } from "../lib/step2Build.server";

// TEMPORARY (Step 2 T2) — a headless JSON probe for the deploy: run the two-tier
// generation against the real identity + catalog (web research → 3-4 quiz types →
// pick the first → 2-3 rich battle-card templates). Records whether web_search
// was live or degraded. Deleted at T3 when the funnel wiring lands.
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const goal = String(form.get("goal") ?? "Help shoppers find the right products for them");
  const struggle = String(form.get("struggle") ?? "");

  const { types, webResearchSummary } = await generateStep2Types(shop.id, {
    goal,
    struggle: struggle || undefined,
  });
  const first = types[0];
  const templates = first
    ? await generateStep2Templates(shop.id, first, { goal, struggle: struggle || undefined })
    : [];

  return json({
    ok: true,
    web_research_live: webResearchSummary.length > 0,
    web_research_chars: webResearchSummary.length,
    web_research_preview: webResearchSummary.slice(0, 240),
    types: types.map((t) => ({
      name: t.name,
      experience_type: t.experience_type,
      achieves: t.achieves,
      question_range: t.question_range,
      best_practice_note: t.best_practice_note,
    })),
    picked_type: first?.name ?? null,
    templates: templates.map((t) => ({
      title: t.title,
      experience_type: t.experience_type,
      feature_notes: t.feature_notes,
      dials: t.dials,
      rec_defaults: t.rec_defaults,
      question_count: t.question_count,
    })),
  });
};
