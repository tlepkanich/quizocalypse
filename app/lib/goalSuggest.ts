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
  // HOME-3 — the Home catalog starter's chip name for the whole catalog, and
  // what decides a pick in this vertical (the tail of a per-collection goal).
  label: string;
  criteria: string;
}

const TEMPLATE_GOAL_SEEDS: TemplateGoalSeed[] = [
  {
    templateId: "skincare",
    pattern: "skin|serum|beauty|cosmetic|cream|lotion|spf|acne|moistur|cleanser|complexion|fragrance",
    goal: "Help shoppers find the right skincare routine for their skin type, concerns, and how much time they want to spend.",
    label: "Skincare routine",
    criteria: "their skin type and concerns",
  },
  {
    templateId: "gifting",
    pattern: "gift|gifting|present|occasion|hamper|recipient",
    goal: "Help shoppers find the perfect gift by matching the recipient, the occasion, and their budget.",
    label: "Gift finder",
    criteria: "the recipient, the occasion, and their budget",
  },
  {
    templateId: "clothing",
    pattern: "cloth|apparel|fashion|wear|outfit|garment|tee\\b|shirt|dress|denim|footwear|shoe|sneaker|jacket",
    goal: "Help shoppers find clothing that suits their style, needs, and fit.",
    label: "Style finder",
    criteria: "their style, needs, and fit",
  },
  {
    templateId: "vitamins",
    pattern: "vitamin|supplement|nutrition|wellness|protein|capsule|nootropic|probiotic|collagen",
    goal: "Help shoppers build the right supplement routine for their goals, focus areas, and diet.",
    label: "Supplement routine",
    criteria: "their goals, focus areas, and diet",
  },
];

function joinGroups(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean).slice(0, 3);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean[0]}, ${clean[1]} and ${clean[2]}`;
}

// Score each template seed by how many keyword hits the signal mentions; the
// best-matching vertical wins. Ties resolve to declaration order (skincare → …).
function matchSeed(signal: string): TemplateGoalSeed | null {
  let best: TemplateGoalSeed | null = null;
  let bestScore = 0;
  for (const seed of TEMPLATE_GOAL_SEEDS) {
    const hits = signal.toLowerCase().match(new RegExp(seed.pattern, "gi"));
    const score = hits ? hits.length : 0;
    if (score > bestScore) {
      best = seed;
      bestScore = score;
    }
  }
  return best;
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
  const best = matchSeed(signal);
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

/**
 * HOME-3 — the whole-catalog starter chip on Home: a short name, the goal it
 * writes, and the vertical's deciding criteria (reused by the per-collection
 * starters). Same store-wide signal as suggestQuizGoal with no groups.
 */
export function suggestCatalogStarter(identitySummary: string | null): {
  label: string;
  goal: string;
  criteria: string;
} {
  const seed = matchSeed(identitySummary ?? "");
  if (seed) return { label: seed.label, goal: seed.goal, criteria: seed.criteria };
  return {
    label: "Product match",
    goal: suggestQuizGoal({ identitySummary }),
    criteria: "their needs and preferences",
  };
}

/**
 * Singular form of a collection name's last word, for a goal sentence
 * ("Moisturizers" → "Moisturizer", "Accessories" → "Accessory",
 * "Brushes" → "Brush"). Words that are not plain plurals pass through.
 */
export function singularizeName(name: string): string {
  const trimmed = name.trim();
  const match = trimmed.match(/^(.*?)([A-Za-z]+)$/);
  if (!match) return trimmed;
  const [, head, word] = match as unknown as [string, string, string];
  const lower = word.toLowerCase();
  let singular = word;
  if (/(ss|us|is)$/.test(lower) || lower.length <= 3) singular = word;
  else if (lower.endsWith("ies")) singular = `${word.slice(0, -3)}${word.slice(-3) === "IES" ? "Y" : "y"}`;
  else if (/(sh|ch|x|z)es$/.test(lower)) singular = word.slice(0, -2);
  else if (lower.endsWith("s")) singular = word.slice(0, -1);
  return `${head}${singular}`;
}
