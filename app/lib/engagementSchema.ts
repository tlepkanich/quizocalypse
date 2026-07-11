import { z } from "zod";

// ════════════════════════════════════════════════════════════════════════════
// §L — Engagement / conversion settings. Per-quiz config lives on the quiz doc
// as ONE `.optional()` field (`engagement`), baked into publishedJson at publish
// (§J3). Account-level defaults live on Shop.engagementDefaults. Read-time
// defaults live in ENGAGEMENT_DEFAULTS — NEVER `.default()` in the schema (the
// dual-model invariant: a default would inject keys into every legacy doc on the
// next parse→save and break the byte-pin). Every leaf is optional so a legacy /
// unconfigured doc carries nothing and stays byte-identical.
//
// Precedence (resolveEngagement): per-quiz override > account default > read-time
// default. Tasteful mechanics default ON; loud ones (reward, urgency) default
// OFF (§L5 ethics).
// ════════════════════════════════════════════════════════════════════════════

export const InterstitialSettings = z.object({
  enabled: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(6000).optional(),
  style: z.enum(["spinner", "progress", "stepped"]).optional(),
  steps: z.array(z.string().max(60)).max(5).optional(),
  headline: z.string().max(80).optional(),
});

export const FeedbackSettings = z.object({
  enabled: z.boolean().optional(),
  type: z.enum(["thumbs", "stars"]).optional(),
  openText: z.boolean().optional(),
  placement: z.enum(["results", "email"]).optional(), // v1 = results only (Y3)
  prompt: z.string().max(80).optional(),
});

export const RewardSettings = z.object({
  enabled: z.boolean().optional(),
  type: z.enum(["percentage", "fixed", "free_shipping"]).optional(),
  value: z.number().min(0).optional(), // fixed value / single %
  rangeMin: z.number().min(0).optional(), // mystery range
  rangeMax: z.number().min(0).optional(),
  odds: z.enum(["equal", "weighted"]).optional(),
  reveal: z.enum(["tap", "spin"]).optional(),
  expiryHours: z.number().int().min(1).max(8760).optional(),
  usageCap: z.number().int().min(1).optional(),
  minSpend: z.number().min(0).optional(),
  emailGated: z.boolean().optional(), // E2/Y2 — reward is the capture incentive
  // Build-tab §10 — message shown when the reward is fully claimed (usageCap
  // reached). Prevents a blank/vanishing block; a default is used if unset.
  fallbackText: z.string().max(200).optional(),
});

export const SocialProofSettings = z.object({
  matchedCount: z.boolean().optional(),
  threshold: z.number().int().min(0).optional(), // floor; hide below (E7)
  popularMatch: z.boolean().optional(),
  reviewStars: z.boolean().optional(),
  reviewSource: z.string().max(40).optional(), // dependency; hide if absent
  minReviews: z.number().int().min(0).optional(),
});

export const ShareSettings = z.object({
  enabled: z.boolean().optional(),
  channels: z.array(z.enum(["copy", "x", "facebook", "ig_story"])).max(4).optional(),
  cardContent: z.enum(["persona", "persona_product"]).optional(),
});

export const UrgencySettings = z.object({
  lowStock: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(1).optional(),
  countdown: z.boolean().optional(), // ties to reward expiry (real-only)
});

export const EmailFlowsSettings = z.object({
  recap: z.boolean().optional(),
  reminder: z.boolean().optional(),
  reminderHours: z.number().int().min(1).optional(),
  abandoned: z.boolean().optional(),
  abandonedHours: z.number().int().min(1).optional(),
  sendVia: z.enum(["native", "klaviyo"]).optional(),
});

// §M6 — referral give-get. Loud/opt-in. give = the referrer's reward (granted on
// the friend's qualifying order); get = the friend's reward. Both mint via the
// same single-use discount machinery as §M3.
export const ReferralSettings = z.object({
  enabled: z.boolean().optional(),
  giveType: z.enum(["percentage", "fixed", "free_shipping"]).optional(),
  giveValue: z.number().min(0).optional(),
  getType: z.enum(["percentage", "fixed", "free_shipping"]).optional(),
  getValue: z.number().min(0).optional(),
  redemptionCap: z.number().int().min(1).optional(), // max friends rewarded per referrer
  expiryHours: z.number().int().min(1).max(8760).optional(),
  qualifyingSubtotal: z.number().min(0).optional(), // order threshold to grant (E fraud guard)
});

// §M1.1 — build-a-routine / bundle add-all. Loud/opt-in. discountValue is the
// "save X%" label on the add-all button; minItems gates when it shows.
export const BundleSettings = z.object({
  enabled: z.boolean().optional(),
  discountValue: z.number().min(0).optional(),
  minItems: z.number().int().min(2).optional(),
});

export const EngagementSettings = z.object({
  interstitial: InterstitialSettings.optional(),
  feedback: FeedbackSettings.optional(),
  reward: RewardSettings.optional(),
  referral: ReferralSettings.optional(),
  bundle: BundleSettings.optional(),
  socialProof: SocialProofSettings.optional(),
  share: ShareSettings.optional(),
  urgency: UrgencySettings.optional(),
  progressiveReveal: z.object({ enabled: z.boolean().optional() }).optional(),
  emailFlows: EmailFlowsSettings.optional(),
});
export type EngagementSettingsT = z.infer<typeof EngagementSettings>;

// §L Layer-2 defaults — tasteful ON, loud OFF (§L5). Read-time only. Union
// fields are typed to their full union (NOT narrowed by `as const`) so the
// resolved config keeps the union type — a runtime override can be any member.
export const ENGAGEMENT_DEFAULTS = {
  interstitial: {
    enabled: true,
    delayMs: 2500,
    style: "stepped" as "spinner" | "progress" | "stepped",
    steps: ["Reading your answers", "Matching products", "Finalizing"] as string[],
    headline: "Calculating your results…",
  },
  feedback: {
    enabled: true,
    type: "thumbs" as "thumbs" | "stars",
    openText: false,
    placement: "results" as "results" | "email",
    prompt: "Was this helpful?",
  },
  reward: {
    enabled: false,
    type: "percentage" as "percentage" | "fixed" | "free_shipping",
    odds: "equal" as "equal" | "weighted",
    reveal: "tap" as "tap" | "spin",
    expiryHours: 24,
    emailGated: true,
    // Audit hardening (M4) — a read-time DEFAULT mint ceiling. Without one, a
    // merchant enabling rewards without a cap exposes unbounded code farming
    // (session_id is client-chosen; per-IP rate limits don't bound a
    // distributed client). Merchants can raise it explicitly in the panel.
    usageCap: 100,
  },
  referral: {
    enabled: false,
    giveType: "percentage" as "percentage" | "fixed" | "free_shipping",
    giveValue: 10,
    getType: "percentage" as "percentage" | "fixed" | "free_shipping",
    getValue: 10,
    redemptionCap: 10,
    expiryHours: 720, // 30 days
    qualifyingSubtotal: 0,
  },
  bundle: { enabled: false, minItems: 2 },
  socialProof: { matchedCount: true, threshold: 50, popularMatch: false, reviewStars: false, minReviews: 5 },
  share: {
    enabled: true,
    channels: ["copy", "x"] as Array<"copy" | "x" | "facebook" | "ig_story">,
    cardContent: "persona" as "persona" | "persona_product",
  },
  urgency: { lowStock: false, lowStockThreshold: 5, countdown: false },
  progressiveReveal: { enabled: false },
  emailFlows: {
    recap: true,
    reminder: false,
    reminderHours: 24,
    abandoned: false,
    abandonedHours: 1,
    sendVia: "klaviyo" as "native" | "klaviyo",
  },
};

export type ResolvedEngagement = {
  interstitial: typeof ENGAGEMENT_DEFAULTS.interstitial;
  feedback: typeof ENGAGEMENT_DEFAULTS.feedback;
  reward: typeof ENGAGEMENT_DEFAULTS.reward & Partial<EngagementSettingsT["reward"]>;
  referral: typeof ENGAGEMENT_DEFAULTS.referral & Partial<EngagementSettingsT["referral"]>;
  bundle: typeof ENGAGEMENT_DEFAULTS.bundle & Partial<EngagementSettingsT["bundle"]>;
  socialProof: typeof ENGAGEMENT_DEFAULTS.socialProof & Partial<EngagementSettingsT["socialProof"]>;
  share: typeof ENGAGEMENT_DEFAULTS.share;
  urgency: typeof ENGAGEMENT_DEFAULTS.urgency;
  progressiveReveal: typeof ENGAGEMENT_DEFAULTS.progressiveReveal;
  emailFlows: typeof ENGAGEMENT_DEFAULTS.emailFlows;
};

// Set the whole engagement object on a doc (the settings panel holds the full
// object and commits it). Clearing to empty drops the field so an unconfigured
// quiz carries no `engagement` key (byte-safe). `doc` stays loosely typed here
// so this is usable from any doc-shaped object without a quizSchema import cycle.
export function setEngagement<T extends { engagement?: EngagementSettingsT }>(
  doc: T,
  engagement: EngagementSettingsT | undefined,
): T {
  if (!engagement || Object.keys(engagement).length === 0) {
    const { engagement: _drop, ...rest } = doc;
    return rest as T;
  }
  return { ...doc, engagement };
}

// Deep-merge each section: default → account → quiz (override-wins), copying only
// PRESENT keys so an absent override never shadows a lower layer with undefined.
export function resolveEngagement(
  quiz?: EngagementSettingsT | null,
  account?: EngagementSettingsT | null,
): ResolvedEngagement {
  const section = <K extends keyof typeof ENGAGEMENT_DEFAULTS>(key: K) => {
    const base = ENGAGEMENT_DEFAULTS[key] as Record<string, unknown>;
    const out: Record<string, unknown> = { ...base };
    for (const src of [account?.[key], quiz?.[key]]) {
      if (!src) continue;
      for (const [k, v] of Object.entries(src)) if (v !== undefined) out[k] = v;
    }
    return out;
  };
  return {
    interstitial: section("interstitial"),
    feedback: section("feedback"),
    reward: section("reward"),
    referral: section("referral"),
    bundle: section("bundle"),
    socialProof: section("socialProof"),
    share: section("share"),
    urgency: section("urgency"),
    progressiveReveal: section("progressiveReveal"),
    emailFlows: section("emailFlows"),
  } as ResolvedEngagement;
}
