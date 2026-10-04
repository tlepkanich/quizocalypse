// Account & Billing — the ONE list of plans and per-use AI features
// (docs/design/settings/billing/BILLING-HANDOFF.md, "The AI feature list").
// Account, Change plan, the credit tag and the usage record all read this
// file; a new plan or AI feature is added here and nowhere else.
//
// EVERY NUMBER HERE IS A PLACEHOLDER (handoff decision 2): credits per plan,
// the price of a credit, the AI rates, the trial length and the slider
// ranges are the mock's example values until the owner sets them. Plan names
// and feature lists are placeholders too (decisions 3 and 6).

export type SelfServePlanKey = "starter" | "growth";
export type PlanKey = SelfServePlanKey | "enterprise";

/** The "More credits" amount control: slider steps, field limits, opening value. */
export interface AddRange {
  min: number;
  max: number;
  step: number;
  def: number;
}

interface PlanBase {
  name: string;
  /** USD a month. */
  price: number;
  /** Credits included in each cycle. */
  credits: number;
  creditsLabel: string;
  feats: string[];
}

/** A plan a merchant can pick by themselves. */
export interface SelfServePlan extends PlanBase {
  key: SelfServePlanKey;
  selfServe: true;
  /** USD for one more credit on this plan (top-up and overage; decision 8). */
  rate: number;
  add: AddRange;
}

/** The top plan: priced and set up with the Wiskr team. */
export interface CustomPlan extends PlanBase {
  key: "enterprise";
  selfServe: false;
}

export type Plan = SelfServePlan | CustomPlan;

export const PLANS: { starter: SelfServePlan; growth: SelfServePlan; enterprise: CustomPlan } = {
  starter: {
    key: "starter",
    selfServe: true,
    name: "Starter",
    price: 50,
    credits: 400,
    rate: 0.15,
    add: { min: 50, max: 2000, step: 50, def: 250 },
    creditsLabel: "400 credits each cycle",
    feats: ["2 live quizzes", "AI on your quizzes", "Klaviyo and Shopify sync", "Analytics"],
  },
  growth: {
    key: "growth",
    selfServe: true,
    name: "Growth",
    price: 200,
    credits: 2200,
    rate: 0.1,
    add: { min: 100, max: 5000, step: 100, def: 500 },
    creditsLabel: "2,200 credits each cycle",
    feats: ["Everything in Starter", "Unlimited quizzes", "A/B testing", "Custom CSS"],
  },
  enterprise: {
    key: "enterprise",
    selfServe: false,
    name: "Enterprise",
    price: 500,
    credits: 7250,
    creditsLabel: "7,250+ credits, or unlimited",
    feats: [
      "Everything in Growth",
      "A dedicated account manager",
      "Monthly strategy call",
      "Quiz review and tuning",
    ],
  },
};

/** Lowest to highest. The bigger plan is always the better deal per credit. */
export const PLAN_ORDER: PlanKey[] = ["starter", "growth", "enterprise"];

/** The plan a shop gets when it has no plan record yet (owner, 2026-10-04). */
export const DEFAULT_PLAN: SelfServePlanKey = "starter";
export const TRIAL_DAYS = 14;
/** Shopify's app billing cycle, not the calendar month. */
export const CYCLE_DAYS = 30;
/** The share of a cycle's credits at which the "nearly out" signal shows. */
export const NEAR_OUT_SHARE = 0.8;

/** A stored plan key → its self-serve plan. An unknown key (or the top plan,
    which no shop can hold until it is sold) reads as the default plan. */
export function selfServePlan(key: string | null | undefined): SelfServePlan {
  return key === "growth" ? PLANS.growth : key === "starter" ? PLANS.starter : PLANS[DEFAULT_PLAN];
}

/** The next plan up, or null on the top plan. */
export function nextPlanUp(key: PlanKey): Plan | null {
  const nextKey = PLAN_ORDER[PLAN_ORDER.indexOf(key) + 1];
  return nextKey ? PLANS[nextKey] : null;
}

export function isUpgrade(from: PlanKey, to: PlanKey): boolean {
  return PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
}

/* ── Per-use AI features ─────────────────────────────────────────────────
   Only AI that runs each time a SHOPPER uses a live quiz. Merchant-side AI
   (quiz generation, why-copy, path review, brand guidelines, builder help)
   is not charged in credits (handoff decision 12). Product recommendations
   come from the quiz logic and are never charged. */

export type AiFeatureKey = "rec_copy" | "ask_ai";

export interface AiFeature {
  /** The name the usage record stores it under. */
  key: AiFeatureKey;
  name: string;
  /** Column heading in the By quiz table. */
  short: string;
  /** Plural of one use, for "643 results pages". */
  unit: string;
  /** Singular of one use, for "per results page". */
  per: string;
  /** Credits for one use. */
  rate: number;
}

export const AI_FEATURES: AiFeature[] = [
  {
    key: "rec_copy",
    name: "AI-written personalization",
    short: "AI personalization",
    unit: "results pages",
    per: "results page",
    rate: 0.2,
  },
  { key: "ask_ai", name: "Ask AI", short: "Ask AI", unit: "replies", per: "reply", rate: 0.1 },
];

export function aiFeature(key: AiFeatureKey): AiFeature {
  const feature = AI_FEATURES.find((f) => f.key === key);
  if (!feature) throw new Error(`Unknown AI feature: ${key}`);
  return feature;
}

/** One use of a feature in thousandths of a credit — the unit the usage
    record stores, so sums stay whole numbers (0.1 × 3 is not 0.3 in floats). */
export function featureMilliCredits(key: AiFeatureKey): number {
  return Math.round(aiFeature(key).rate * 1000);
}

/** The lowest and highest AI rate, for the "i" on Account: "0.1–0.2 credit". */
export function aiRateRange(): string {
  const rates = AI_FEATURES.map((f) => f.rate);
  const low = Math.min(...rates);
  const high = Math.max(...rates);
  return `${low === high ? low : `${low}–${high}`} credit`;
}
