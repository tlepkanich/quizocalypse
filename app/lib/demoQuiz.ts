import { Quiz } from "./quizSchema";
import type { Quiz as QuizDoc } from "./quizSchema";
import { HOUSE_TOKENS } from "./themePresets";

// ───────────────────────────────────────────────────────────────────────────
// One-click DEMO quiz — a complete, publishable showcase that exercises the
// Phase 1–5 features in a single flow so the merchant can publish it and click
// through everything:
//   • mixed question types — dropdown, multi-select (min/max), single-select
//   • an email gate that also collects phone (SMS)
//   • an A/B branch (50/50) → two result variants (analytics on both)
//   • result A with a recommendation discount badge
//   • result B as a multi-stage (Advanced) page
//   • a quiz-level discount (15% off, once per customer)
// Result pages are tag-based with the shop's first collection injected as the
// fallback, so they recommend the merchant's REAL products out of the box.
// ───────────────────────────────────────────────────────────────────────────

const PLACEHOLDER_COLLECTION = "gid://shopify/Collection/0";
const uid = (p: string): string => `demo_${p}_${Math.random().toString(36).slice(2, 9)}`;

export const DEMO_QUIZ_NAME = "Demo — Find your match";

export function buildDemoQuiz(fallbackCollectionId: string): QuizDoc {
  const fb =
    fallbackCollectionId && fallbackCollectionId.length > 0
      ? fallbackCollectionId
      : PLACEHOLDER_COLLECTION;

  const ids = {
    intro: "intro",
    q1: uid("q"),
    q2: uid("q"),
    q3: uid("q"),
    gate: uid("eg"),
    branch: uid("br"),
    rA: uid("r"),
    rB: uid("r"),
  };
  const answer = (text: string, tags: string[]) => ({
    id: uid("a"),
    text,
    tags,
    edge_handle_id: uid("h"),
  });

  const nodes: unknown[] = [
    {
      id: ids.intro,
      type: "intro",
      position: { x: 0, y: 0 },
      data: {
        headline: "Find your perfect match",
        subtext: "A 30-second quiz — answer a few questions and we'll recommend what fits.",
        button_label: "Start",
      },
    },
    {
      id: ids.q1,
      type: "question",
      position: { x: 320, y: 0 },
      data: {
        text: "What are you shopping for?",
        question_type: "dropdown",
        required: true,
        answers: [
          answer("Something for everyday", ["everyday"]),
          answer("A special treat", ["premium"]),
          answer("A gift", ["gift"]),
        ],
        show_preview_after: false,
      },
    },
    {
      id: ids.q2,
      type: "question",
      position: { x: 640, y: 0 },
      data: {
        text: "What matters most? (pick up to 2)",
        question_type: "multi_select",
        required: true,
        min_selections: 1,
        max_selections: 2,
        answers: [
          answer("Quality", ["quality"]),
          answer("Value", ["value"]),
          answer("Style", ["style"]),
          answer("Sustainability", ["eco"]),
        ],
        show_preview_after: true,
      },
    },
    {
      id: ids.q3,
      type: "question",
      position: { x: 960, y: 0 },
      data: {
        text: "Pick a vibe",
        question_type: "single_select",
        required: true,
        answers: [
          answer("Classic & timeless", ["classic"]),
          answer("Bold & modern", ["bold"]),
          answer("Soft & minimal", ["minimal"]),
        ],
        show_preview_after: false,
      },
    },
    {
      id: ids.gate,
      type: "email_gate",
      position: { x: 1280, y: 0 },
      data: {
        headline: "Where should we send your picks?",
        subtext: "Get your results + an exclusive discount.",
        email_required: true,
        name_optional: true,
        skip_allowed: true,
        collect_phone: true,
      },
    },
    {
      id: ids.branch,
      type: "branch",
      position: { x: 1600, y: 0 },
      data: {
        label: "A/B: results layout",
        mode: "ab_split",
        slots: [
          { id: "sl_a", label: "Variant A", weight: 50 },
          { id: "sl_b", label: "Variant B", weight: 50 },
        ],
      },
    },
    {
      id: ids.rA,
      type: "result",
      position: { x: 1920, y: -160 },
      data: {
        headline: "Your top picks",
        subtext: "Hand-matched to your answers — with a little something off.",
        cta_label: "Shop now",
        fallback_collection_id: fb,
        match_ladder: ["tag"],
        include_discount: true,
      },
    },
    {
      id: ids.rB,
      type: "result",
      position: { x: 1920, y: 160 },
      data: {
        headline: "Your curated edit",
        subtext: "A multi-section results page.",
        cta_label: "Shop now",
        fallback_collection_id: fb,
        match_ladder: ["tag"],
        stages: [
          {
            id: uid("st"),
            headline: "Start here",
            subtext: "The essentials for you.",
            match_ladder: ["tag"],
            min_products: 1,
            max_products: 3,
          },
          {
            id: uid("st"),
            headline: "Complete the look",
            subtext: "Pairs well with your picks.",
            match_ladder: ["tag"],
            min_products: 1,
            max_products: 3,
          },
        ],
      },
    },
  ];

  const edges: unknown[] = [
    { id: uid("e"), source: ids.intro, target: ids.q1 },
    { id: uid("e"), source: ids.q1, target: ids.q2 },
    { id: uid("e"), source: ids.q2, target: ids.q3 },
    { id: uid("e"), source: ids.q3, target: ids.gate },
    { id: uid("e"), source: ids.gate, target: ids.branch },
    { id: uid("e"), source: ids.branch, target: ids.rA, source_handle: "sl_a" },
    { id: uid("e"), source: ids.branch, target: ids.rB, source_handle: "sl_b" },
  ];

  return Quiz.parse({
    quiz_id: `quiz_${Math.random().toString(36).slice(2, 10)}`,
    status: "draft",
    scope: { collection_ids: [] },
    nodes,
    edges,
    discount_config: {
      enabled: true,
      kind: "percentage",
      value: 15,
      once_per_customer: true,
      title: "Quiz reward",
    },
    design_tokens: HOUSE_TOKENS,
  });
}
