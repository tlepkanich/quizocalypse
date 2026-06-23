import { Quiz } from "./quizSchema";
import { HOUSE_TOKENS } from "./themePresets";
import { stripAutoQuizDate } from "./dialDirectives";

// Minimal valid quiz a fresh "New quiz" creates — an intro + one starter
// question, wired. The merchant then groups products into buckets (Step 1),
// which creates result pages, and builds questions manually or via Smart Build.
//
// The starter question carries `sb_` ids so Smart Build cleanly replaces it
// when the merchant generates a flow (the `sb_` prefix is the Smart Build
// marker; see app/lib/smartBuild.ts). To a manual builder the prefix is just
// an opaque id.
export function buildSeedQuiz(
  name: string,
  experienceType?: "product_match" | "personality" | "lead_capture" | "survey",
): Quiz {
  const title = name.trim() || "Find your match";
  return Quiz.parse({
    ...(experienceType ? { experience_type: experienceType } : {}),
    quiz_id: `quiz_${Math.random().toString(36).slice(2, 10)}`,
    status: "draft",
    scope: { collection_ids: [] },
    design_tokens: HOUSE_TOKENS,
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: {
          // Shopper-facing: a dated auto-name ("… 6/22/26") must not leak into
          // the headline — strip the date here; the quiz NAME keeps it.
          headline: stripAutoQuizDate(title) || "Find your match",
          subtext: "Answer a few quick questions and we'll point you to the right products.",
          button_label: "Start",
        },
      },
      {
        id: "sb_q_seed",
        type: "question",
        position: { x: 320, y: 0 },
        data: {
          text: "What are you shopping for today?",
          question_type: "single_select",
          required: true,
          answers: [
            { id: "sb_a_seed_1", text: "Option A", tags: [], edge_handle_id: "sb_h_seed_1" },
            { id: "sb_a_seed_2", text: "Option B", tags: [], edge_handle_id: "sb_h_seed_2" },
          ],
        },
      },
    ],
    edges: [{ id: "sb_e_seed", source: "intro", target: "sb_q_seed" }],
  });
}
