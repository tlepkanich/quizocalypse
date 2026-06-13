import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { QuizType } from "../lib/quizSchema";
import { generateStep2Types, generateStep2Templates } from "../lib/step2Build.server";

// TEMPORARY (Step 2 T2) — a headless JSON probe for the deploy. Split into two
// intents because the combined pass (web research + types + templates) outruns
// Fly's ~60s edge window — which is exactly why the real funnel (T3) detaches
// both. intent=types → web research + 3-4 quiz types; intent=templates (with a
// type_json) → 2-3 rich battle-card templates. Deleted at T3.
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "types");
  const goal = String(form.get("goal") ?? "Help shoppers find the right products for them");
  const struggle = String(form.get("struggle") ?? "");

  if (intent === "templates") {
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("type_json") ?? "null"));
    } catch {
      return json({ ok: false, error: "type_json not JSON" }, { status: 400 });
    }
    const parsed = QuizType.safeParse(raw);
    if (!parsed.success) return json({ ok: false, error: "type_json failed QuizType parse" }, { status: 400 });
    const templates = await generateStep2Templates(shop.id, parsed.data, {
      goal,
      struggle: struggle || undefined,
    });
    return json({
      ok: true,
      templates: templates.map((t) => ({
        title: t.title,
        experience_type: t.experience_type,
        feature_notes: t.feature_notes,
        dials: t.dials,
        rec_defaults: t.rec_defaults,
        question_count: t.question_count,
      })),
    });
  }

  // intent=types — returns FULL type objects so one can be fed back to the
  // templates intent.
  const { types, webResearchSummary } = await generateStep2Types(shop.id, {
    goal,
    struggle: struggle || undefined,
  });
  return json({
    ok: true,
    web_research_live: webResearchSummary.length > 0,
    web_research_chars: webResearchSummary.length,
    web_research_preview: webResearchSummary.slice(0, 240),
    types,
  });
};
