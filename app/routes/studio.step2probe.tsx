import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { QuizType } from "../lib/quizSchema";
import {
  runStep2WebResearch,
  generateStep2Types,
  generateStep2Templates,
} from "../lib/step2Build.server";

// TEMPORARY (Step 2 T2) — a headless JSON probe. Isolated into THREE intents so
// each AI call fits Fly's ~60s edge window (web research alone is ~40s, which is
// exactly why the funnel detaches it). research → web search only; types →
// generateQuizTypes (model-knowledge fast path); templates → generateQuizTemplates
// for a passed-in type. Deleted at T3.
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "types");
  const goal = String(form.get("goal") ?? "Help shoppers find the right products for them");
  const struggle = String(form.get("struggle") ?? "");

  if (intent === "research") {
    const text = await runStep2WebResearch(shop.id);
    return json({
      ok: true,
      web_research_live: text.length > 0,
      web_research_chars: text.length,
      web_research_preview: text.slice(0, 400),
    });
  }

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

  // intent=types — model-knowledge fast path (web research is verified separately).
  const { types } = await generateStep2Types(shop.id, {
    goal,
    struggle: struggle || undefined,
    skipWebResearch: true,
  });
  return json({ ok: true, types });
};
