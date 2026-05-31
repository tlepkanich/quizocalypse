import { Quiz } from "./quizSchema";
import type { Quiz as QuizDoc, DesignTokens } from "./quizSchema";

// ───────────────────────────────────────────────────────────────────────────
// Prebuilt quiz TEMPLATES (Phase 4) — the four vertical starter quizzes
// (Skincare, Gifting, Clothing, Vitamins) offered in onboarding. Each is
// authored as a compact data spec; `buildTemplate` assembles a runtime-valid
// QuizDoc that mirrors how Smart Build wires a flow (app/lib/smartBuild.ts):
// intro → questions → a rules-branch (tag-conditioned slots) → archetype
// result pages + an unconditioned default. Archetypes are TAG-BASED
// (match_ladder ["tag"]) so they recommend via tag overlap out of the box; the
// merchant binds their real products by grouping in Studio Step 1.
//
// fallback_collection_id (required by ResultData) is injected at instantiation
// from the shop's first synced collection.
// ───────────────────────────────────────────────────────────────────────────

export type TemplateId = "skincare" | "gifting" | "clothing" | "vitamins";

interface TemplateAnswer {
  text: string;
  tags: string[];
}
interface TemplateQuestion {
  text: string;
  type: "single_select" | "multi_select";
  answers: TemplateAnswer[];
}
interface TemplateArchetype {
  headline: string;
  subtext: string;
  // The dominant tag that routes a shopper to this archetype. MUST appear in
  // some answer's tags (a test guards this) so the branch condition is reachable.
  tag: string;
  cta?: string;
}
export interface TemplateSpec {
  id: TemplateId;
  label: string;
  description: string;
  defaultName: string;
  accent: string; // gallery card accent color
  intro: { headline: string; subtext: string; button_label: string };
  questions: TemplateQuestion[];
  archetypes: TemplateArchetype[];
  tokens: DesignTokens;
}

const PLACEHOLDER_COLLECTION = "gid://shopify/Collection/0";
const tuid = (p: string): string => `t_${p}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Assemble a runtime-valid QuizDoc from a template spec, injecting the shop's
 * fallback collection into every result node. Pure (modulo random ids).
 */
export function buildTemplate(spec: TemplateSpec, fallbackCollectionId: string): QuizDoc {
  const fallback =
    fallbackCollectionId && fallbackCollectionId.length > 0
      ? fallbackCollectionId
      : PLACEHOLDER_COLLECTION;

  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  const xAt = (c: number) => c * 320;
  let col = 1;
  let prev = "intro";
  const connect = (target: string) => {
    edges.push({ id: tuid("e"), source: prev, target });
    prev = target;
  };

  nodes.push({
    id: "intro",
    type: "intro",
    position: { x: 0, y: 0 },
    data: {
      headline: spec.intro.headline,
      subtext: spec.intro.subtext,
      button_label: spec.intro.button_label,
    },
  });

  spec.questions.forEach((q) => {
    const id = tuid("q");
    nodes.push({
      id,
      type: "question",
      position: { x: xAt(col++), y: 0 },
      data: {
        text: q.text,
        question_type: q.type,
        required: true,
        answers: q.answers.map((a) => ({
          id: tuid("a"),
          text: a.text,
          tags: a.tags,
          edge_handle_id: tuid("h"),
        })),
        show_preview_after: false,
      },
    });
    connect(id);
  });

  // Archetype result pages (tag-based).
  const resultIds = spec.archetypes.map(() => tuid("r"));
  spec.archetypes.forEach((arch, i) => {
    nodes.push({
      id: resultIds[i],
      type: "result",
      position: { x: xAt(col + 1), y: i * 220 },
      data: {
        headline: arch.headline,
        subtext: arch.subtext,
        cta_label: arch.cta ?? "Shop now",
        fallback_collection_id: fallback,
        match_ladder: ["tag"],
      },
    });
  });

  // Routing branch: one tag-conditioned slot per archetype + a default
  // catch-all (last, so conditioned slots win). Mirrors applyQuestionFlow.
  const branchId = tuid("br");
  const slots = spec.archetypes.map((a, i) => ({
    id: `sl_${i + 1}`,
    label: a.headline,
    weight: 1,
  }));
  slots.push({ id: "sl_default", label: "Other", weight: 1 });
  nodes.push({
    id: branchId,
    type: "branch",
    position: { x: xAt(col++), y: 0 },
    data: { label: "Route to result", mode: "rules", slots },
  });
  connect(branchId);

  spec.archetypes.forEach((arch, i) => {
    edges.push({
      id: tuid("e"),
      source: branchId,
      target: resultIds[i],
      source_handle: `sl_${i + 1}`,
      condition: { tag: arch.tag },
    });
  });
  edges.push({
    id: tuid("e"),
    source: branchId,
    target: resultIds[0],
    source_handle: "sl_default",
  });

  return Quiz.parse({
    quiz_id: `quiz_${Math.random().toString(36).slice(2, 10)}`,
    status: "draft",
    scope: { collection_ids: [] },
    nodes,
    edges,
    design_tokens: spec.tokens,
  });
}

// ── The four template specs ──────────────────────────────────────────────────

const SKINCARE: TemplateSpec = {
  id: "skincare",
  label: "Skincare",
  description: "Match shoppers to a routine by skin type, concern, and ritual length.",
  defaultName: "Find your skincare routine",
  accent: "#2F6B4F",
  intro: {
    headline: "Find your skincare routine",
    subtext: "Answer 3 quick questions and we'll build a routine for your skin.",
    button_label: "Start",
  },
  questions: [
    {
      text: "What's your skin type?",
      type: "single_select",
      answers: [
        { text: "Dry", tags: ["dry", "hydrating"] },
        { text: "Oily", tags: ["oily", "clarifying"] },
        { text: "Combination", tags: ["combination", "balancing"] },
        { text: "Sensitive", tags: ["sensitive", "soothing"] },
      ],
    },
    {
      text: "What's your top concern?",
      type: "single_select",
      answers: [
        { text: "Fine lines & firmness", tags: ["anti-aging", "brightening"] },
        { text: "Breakouts", tags: ["acne", "clarifying"] },
        { text: "Dullness & uneven tone", tags: ["brightening"] },
        { text: "Redness & irritation", tags: ["soothing", "sensitive"] },
      ],
    },
    {
      text: "How involved do you want your routine?",
      type: "single_select",
      answers: [
        { text: "Keep it minimal", tags: ["hydrating", "simple"] },
        { text: "A balanced few steps", tags: ["balancing"] },
        { text: "The full ritual", tags: ["brightening", "advanced"] },
      ],
    },
  ],
  archetypes: [
    {
      headline: "Hydration heroes",
      subtext: "Lightweight moisture to plump and protect your skin barrier.",
      tag: "hydrating",
    },
    {
      headline: "Clear & balanced",
      subtext: "Gently clarify breakouts and keep oil in check.",
      tag: "clarifying",
    },
    {
      headline: "Glow & renew",
      subtext: "Brighten, smooth, and even out your tone.",
      tag: "brightening",
    },
  ],
  tokens: {
    colors: { primary: "#2F6B4F", accent: "#C98B6B", background: "#F7F4EE", text: "#1E2A23" },
    typography: {
      heading: { family: "Fraunces", source: "google" },
      body: { family: "Inter", source: "system" },
    },
    radius: "rounded",
    button_style: "filled",
    spacing: "spacious",
  },
};

const GIFTING: TemplateSpec = {
  id: "gifting",
  label: "Gifting",
  description: "Guide shoppers to the perfect gift by recipient, occasion, and budget.",
  defaultName: "Find the perfect gift",
  accent: "#B23A48",
  intro: {
    headline: "Find the perfect gift",
    subtext: "Tell us who it's for and we'll handle the rest.",
    button_label: "Start",
  },
  questions: [
    {
      text: "Who are you shopping for?",
      type: "single_select",
      answers: [
        { text: "My partner", tags: ["romantic", "premium"] },
        { text: "A friend", tags: ["everyday", "fun"] },
        { text: "Family", tags: ["everyday", "cozy"] },
        { text: "A coworker", tags: ["everyday", "professional"] },
      ],
    },
    {
      text: "What's the occasion?",
      type: "single_select",
      answers: [
        { text: "Birthday", tags: ["fun"] },
        { text: "Holiday", tags: ["festive", "cozy"] },
        { text: "Just because", tags: ["everyday"] },
        { text: "A big milestone", tags: ["premium", "romantic"] },
      ],
    },
    {
      text: "What's your budget?",
      type: "single_select",
      answers: [
        { text: "Under $25", tags: ["everyday", "budget"] },
        { text: "$25–$75", tags: ["fun"] },
        { text: "$75 and up", tags: ["premium"] },
      ],
    },
  ],
  archetypes: [
    {
      headline: "Thoughtful & personal",
      subtext: "Memorable gifts that feel made for them.",
      tag: "romantic",
      cta: "Shop gifts",
    },
    {
      headline: "Crowd-pleasers",
      subtext: "Can't-go-wrong picks for anyone on your list.",
      tag: "everyday",
      cta: "Shop gifts",
    },
    {
      headline: "Premium picks",
      subtext: "Show-stopping gifts for the big moments.",
      tag: "premium",
      cta: "Shop gifts",
    },
  ],
  tokens: {
    colors: { primary: "#B23A48", accent: "#E0A458", background: "#FBF6F0", text: "#2A1A1C" },
    typography: {
      heading: { family: "Playfair Display", source: "google" },
      body: { family: "Inter", source: "system" },
    },
    radius: "rounded",
    button_style: "filled",
    spacing: "normal",
  },
};

const CLOTHING: TemplateSpec = {
  id: "clothing",
  label: "Clothing",
  description: "Style shoppers into the right pieces by need, taste, and fit.",
  defaultName: "Find your fit",
  accent: "#111111",
  intro: {
    headline: "Find your fit",
    subtext: "A few quick taps and we'll style the pieces for you.",
    button_label: "Start",
  },
  questions: [
    {
      text: "What are you shopping for?",
      type: "single_select",
      answers: [
        { text: "Everyday basics", tags: ["basics"] },
        { text: "Statement pieces", tags: ["statement"] },
        { text: "Activewear", tags: ["active"] },
        { text: "Outerwear", tags: ["outerwear", "basics"] },
      ],
    },
    {
      text: "How would you describe your style?",
      type: "single_select",
      answers: [
        { text: "Classic", tags: ["basics", "classic"] },
        { text: "Trend-forward", tags: ["statement", "trendy"] },
        { text: "Minimal", tags: ["basics", "minimal"] },
        { text: "Bold", tags: ["statement", "bold"] },
      ],
    },
    {
      text: "Preferred fit?",
      type: "single_select",
      answers: [
        { text: "Relaxed", tags: ["active", "relaxed"] },
        { text: "Tailored", tags: ["classic", "tailored"] },
        { text: "Oversized", tags: ["statement", "oversized"] },
      ],
    },
  ],
  archetypes: [
    {
      headline: "Everyday essentials",
      subtext: "Versatile staples that work with everything you own.",
      tag: "basics",
    },
    {
      headline: "Statement style",
      subtext: "Standout pieces to build a look around.",
      tag: "statement",
    },
    {
      headline: "On the move",
      subtext: "Performance and comfort for an active day.",
      tag: "active",
    },
  ],
  tokens: {
    colors: { primary: "#111111", accent: "#6B6B6B", background: "#FFFFFF", text: "#111111" },
    typography: {
      heading: { family: "Inter", source: "system" },
      body: { family: "Inter", source: "system" },
    },
    radius: "square",
    button_style: "filled",
    spacing: "normal",
  },
};

const VITAMINS: TemplateSpec = {
  id: "vitamins",
  label: "Vitamins",
  description: "Recommend a supplement stack by goal, focus area, and diet.",
  defaultName: "Build your supplement stack",
  accent: "#0E7C7B",
  intro: {
    headline: "Build your supplement stack",
    subtext: "Answer a few questions for a routine tailored to your goals.",
    button_label: "Start",
  },
  questions: [
    {
      text: "What's your main goal?",
      type: "single_select",
      answers: [
        { text: "More energy", tags: ["energy"] },
        { text: "Better sleep", tags: ["calm", "sleep"] },
        { text: "Immune support", tags: ["immunity"] },
        { text: "Fitness & recovery", tags: ["energy", "recovery"] },
      ],
    },
    {
      text: "Any focus areas?",
      type: "multi_select",
      answers: [
        { text: "Stress & mood", tags: ["calm", "stress"] },
        { text: "Gut health", tags: ["immunity", "gut"] },
        { text: "Skin, hair & nails", tags: ["beauty"] },
        { text: "Focus & clarity", tags: ["energy", "focus"] },
      ],
    },
    {
      text: "Any dietary needs?",
      type: "single_select",
      answers: [
        { text: "No restrictions", tags: ["standard"] },
        { text: "Vegan", tags: ["vegan"] },
        { text: "Gluten-free", tags: ["glutenfree"] },
      ],
    },
  ],
  archetypes: [
    {
      headline: "Energy & focus",
      subtext: "Clean, steady energy to power your day.",
      tag: "energy",
    },
    {
      headline: "Calm & restore",
      subtext: "Wind down, manage stress, and sleep better.",
      tag: "calm",
    },
    {
      headline: "Daily defense",
      subtext: "Everyday immune and wellness support.",
      tag: "immunity",
    },
  ],
  tokens: {
    colors: { primary: "#0E7C7B", accent: "#76C893", background: "#F4FBF9", text: "#14302E" },
    typography: {
      heading: { family: "Inter", source: "system" },
      body: { family: "Inter", source: "system" },
    },
    radius: "pill",
    button_style: "filled",
    spacing: "normal",
  },
};

export const TEMPLATES: Record<TemplateId, TemplateSpec> = {
  skincare: SKINCARE,
  gifting: GIFTING,
  clothing: CLOTHING,
  vitamins: VITAMINS,
};

// Lean list for the onboarding gallery (no doc weight).
export const TEMPLATE_LIST: Array<{
  id: TemplateId;
  label: string;
  description: string;
  accent: string;
  defaultName: string;
}> = (Object.values(TEMPLATES) as TemplateSpec[]).map((t) => ({
  id: t.id,
  label: t.label,
  description: t.description,
  accent: t.accent,
  defaultName: t.defaultName,
}));

export function isTemplateId(id: string): id is TemplateId {
  return id in TEMPLATES;
}

/**
 * Instantiate a template into a fresh quiz doc + a default name for the DB row.
 */
export function buildTemplateQuiz(
  templateId: TemplateId,
  fallbackCollectionId: string,
): { doc: QuizDoc; name: string } {
  const spec = TEMPLATES[templateId];
  return { doc: buildTemplate(spec, fallbackCollectionId), name: spec.defaultName };
}
