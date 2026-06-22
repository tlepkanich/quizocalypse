// Pure helper: propose a starter quiz GOAL from the store's profile so the AI
// funnel's goal stage is an APPROVAL, not a blank box (Dev Spec: "every screen
// is a reaction or an approval, never a creation"). Deterministic — NO AI call,
// so it's instant and works regardless of API credit state.
//
// The goal seeds mirror the built-in quiz TEMPLATES' intent (quizTemplates.ts:
// skincare / gifting / clothing / vitamins), matched to the store by keyword,
// with a generic product-match fallback tailored to the merchant's confirmed
// groups. "Generate a goal based on the templates."

const MIN_GOAL_LEN = 24;

interface TemplateGoalSeed {
  templateId: string;
  // Pattern (sources, compiled case-insensitively) that signal this vertical in
  // the brand-identity summary. Mirrors the corresponding quizTemplates.ts spec.
  pattern: string;
  goal: string;
}

const TEMPLATE_GOAL_SEEDS: TemplateGoalSeed[] = [
  {
    templateId: "skincare",
    pattern: "skin|serum|beauty|cosmetic|cream|lotion|spf|acne|moistur|cleanser|complexion|fragrance",
    goal: "Help shoppers find the right skincare routine for their skin type, concerns, and how much time they want to spend.",
  },
  {
    templateId: "gifting",
    pattern: "gift|gifting|present|occasion|hamper|recipient",
    goal: "Help shoppers find the perfect gift by matching the recipient, the occasion, and their budget.",
  },
  {
    templateId: "clothing",
    pattern: "cloth|apparel|fashion|wear|outfit|garment|tee\\b|shirt|dress|denim|footwear|shoe|sneaker|jacket",
    goal: "Help shoppers find clothing that suits their style, needs, and fit.",
  },
  {
    templateId: "vitamins",
    pattern: "vitamin|supplement|nutrition|wellness|protein|capsule|nootropic|probiotic|collagen",
    goal: "Help shoppers build the right supplement routine for their goals, focus areas, and diet.",
  },
];

function joinGroups(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean).slice(0, 3);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]} and ${clean[2]}`;
}

/**
 * Suggest a quiz goal from the store's brand-identity summary + confirmed product
 * groups. Always returns a non-empty sentence of at least MIN_GOAL_LEN chars
 * (the funnel's gate), so the goal stage is always immediately submittable.
 */
export function suggestQuizGoal(input: {
  identitySummary?: string | null;
  groupNames?: string[];
}): string {
  const groupNames = input.groupNames ?? [];

  // The merchant's EXPLICITLY chosen recommendation buckets ARE the quiz's
  // subject, so they drive the vertical match; the store-wide brand-identity
  // summary is only a fallback for all-products quizzes (no buckets chosen).
  // Without this, a broad "beauty/cosmetics" summary always trips the skincare
  // seed and overrides the buckets the merchant just picked (e.g. a lipstick
  // bucket → a "skin" goal — the reported bug on a real makeup catalog).
  const signal = (groupNames.length
    ? groupNames.join(" ")
    : input.identitySummary ?? ""
  ).toLowerCase();

  // Score each template seed by how many keyword hits the signal mentions; the
  // best-matching vertical wins. Ties resolve to declaration order (skincare → …).
  let best: TemplateGoalSeed | null = null;
  let bestScore = 0;
  for (const seed of TEMPLATE_GOAL_SEEDS) {
    const hits = signal.match(new RegExp(seed.pattern, "gi"));
    const score = hits ? hits.length : 0;
    if (score > bestScore) {
      best = seed;
      bestScore = score;
    }
  }
  if (best) return best.goal;

  // No vertical signal — generic product match, tailored to the groups when known.
  const groups = joinGroups(groupNames);
  const generic = groups
    ? `Help shoppers find the right product for their needs by matching their answers to the best fit across your ${groups} collections.`
    : "Help shoppers find the right product for their needs by matching their answers to the best option in your catalog.";
  // Defensive: the constants above are all well over the gate, but never return
  // something the funnel would reject.
  return generic.length >= MIN_GOAL_LEN ? generic : `${generic} `.padEnd(MIN_GOAL_LEN, ".");
}
