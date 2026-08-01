import type { Quiz, RecPageGlobal, DiscountConfig } from "../../../lib/quizSchema";
import { resolveRecPageGlobal, type ResolvedRecPageConfig } from "../../../lib/recommendDecider";
import { setRecPageGlobal } from "../../../lib/quizMutations";

/* Results-guided handoff (master.md) — the guided flow's read/write seam.
   Reads resolve the mock's ship defaults at READ time (the schema stays
   .optional() everywhere); writes go through setRecPageGlobal's sparse-patch
   discipline or a whole-key discount_config replace. */

// ── read-time defaults for the guided-only fields (mock §4) ─────────────────
export const GUIDED_DEFAULTS = {
  perRow: 2,
  showVerified: true,
  capturePlacement: "before" as NonNullable<RecPageGlobal["capturePlacement"]>,
  captureRequired: false,
  captureCta: "Show my results",
  captureSkipLabel: "No thanks, just show my results",
  consentOn: true,
  consentCopy: "Email me offers and updates. Unsubscribe anytime.",
  termsLabel: "Terms & Conditions",
  termsUrl: "/policies/terms-of-service",
  privacyLabel: "Privacy Policy",
  privacyUrl: "/policies/privacy-policy",
  loadingOn: false,
  loadingMs: 2000,
  loadingNamed: true,
  loadingSteps: ["Reading your answers", "Scoring products", "Picking your best matches"],
  extrasOn: true,
  extrasHeading: "You might also like",
  extrasCopy: "Popular with riders like you.",
  extrasCount: 3,
  extrasProductIds: [] as string[],
};

// Placement copy presets (mock GATE_COPY) — applied while the merchant hasn't
// written their own; their copy is never overwritten once touched.
export const GATE_COPY: Record<string, { headline: string; copy: string; cta: string }> = {
  before: {
    headline: "Your matches are ready",
    copy: "Tell us where to send them and we’ll unlock your results.",
    cta: "Show my results",
  },
  inline: {
    headline: "Want these emailed to you?",
    copy: "We’ll send this match list to your inbox.",
    cta: "Email me my matches",
  },
  discount: {
    headline: "Submit your email to unlock the discount",
    copy: "We’ll send the code straight over. Yours to use on any match below.",
    cta: "Unlock my discount",
  },
};

export const REVEAL_MAX_MS = 3000; // past this the wait reads as broken, not effort

export type GuidedConfig = ResolvedRecPageConfig & typeof GUIDED_DEFAULTS;

/** The whole guided config, defaults resolved. */
export function resolveGuided(doc: Quiz): GuidedConfig {
  const base = resolveRecPageGlobal(doc.rec_page_settings);
  const g = (doc.rec_page_settings?.global ?? {}) as RecPageGlobal;
  const merged: GuidedConfig = { ...GUIDED_DEFAULTS, ...base } as GuidedConfig;
  // .optional() fields need explicit presence checks (undefined must not
  // clobber the ship default the way a spread of the raw global would).
  for (const k of Object.keys(GUIDED_DEFAULTS) as (keyof typeof GUIDED_DEFAULTS)[]) {
    const v = g[k as keyof RecPageGlobal];
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

/** Sparse global patch (mock: value equal to its default clears the key).
 *  capturePlacement also keeps the runtime's wired `captureEmail` gate in
 *  sync: "before" → true, "none" → false (inline/discount leave it false —
 *  the runtime's gate screen is the "before" placement). */
export function patchGuided(doc: Quiz, patch: Partial<RecPageGlobal>): Quiz {
  const full: Partial<RecPageGlobal> = { ...patch };
  if (patch.capturePlacement !== undefined) {
    full.captureEmail = patch.capturePlacement === "before" ? undefined : false;
    // undefined → the read-time default (ON) renders; explicit false = off.
  }
  const sparse: Record<string, unknown> = {};
  const defaults = { ...GUIDED_DEFAULTS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(full)) {
    sparse[k] = deepEqual(v, defaults[k]) ? undefined : v;
  }
  return setRecPageGlobal(doc, sparse as Partial<RecPageGlobal>);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  return false;
}

// ── discount ────────────────────────────────────────────────────────────────
export const DISCOUNT_DEFAULTS = {
  code_mode: "dynamic" as NonNullable<DiscountConfig["code_mode"]>,
  code_prefix: "QUIZ-",
  static_code: "",
  existing_code: "",
  auto_apply: true,
  eligibility: "all" as NonNullable<DiscountConfig["eligibility"]>,
  segment: "VIP",
  expiry_mode: "hours" as NonNullable<DiscountConfig["expiry_mode"]>,
  expiry_hours: 24,
  scope: "all" as NonNullable<DiscountConfig["scope"]>,
  exclude_sale: true,
  purchase: "onetime" as NonNullable<DiscountConfig["purchase"]>,
  recurring_limit: 1,
  deliver_on_page: true,
  deliver_klaviyo: false,
  deliver_rivo: false,
};

export type GuidedDiscount = DiscountConfig & typeof DISCOUNT_DEFAULTS;

export function resolveDiscount(doc: Quiz): GuidedDiscount {
  const d = doc.discount_config ?? ({} as DiscountConfig);
  const merged = { ...DISCOUNT_DEFAULTS, ...d } as GuidedDiscount;
  for (const k of Object.keys(DISCOUNT_DEFAULTS) as (keyof typeof DISCOUNT_DEFAULTS)[]) {
    const v = (d as Record<string, unknown>)[k];
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  return merged;
}

export function writeDiscount(doc: Quiz, next: Partial<DiscountConfig>): Quiz {
  return { ...doc, discount_config: { ...(doc.discount_config ?? {}), ...next } as Quiz["discount_config"] };
}

/** The offer's display label ("10% off" / "$10 off" / "Free shipping"). */
export function offerLabel(d: GuidedDiscount): string {
  return d.kind === "free_shipping" ? "Free shipping" : d.kind === "amount" ? `$${d.value} off` : `${d.value}% off`;
}
/** The code as the merchant will see it (dynamic mode shows a sample mint). */
export function offerCode(d: GuidedDiscount): string {
  if (d.code_mode === "existing") return d.existing_code || "SPRING10";
  if (d.code_mode === "static") return d.static_code || `${d.code_prefix}SPRING`;
  return d.code ?? `${d.code_prefix}7F3K2Q`;
}
export const combinesUnset = (d: GuidedDiscount): boolean =>
  !d.combines || ["product", "order", "shipping"].some((k) => d.combines?.[k as "product"] === undefined);

/* ── WIRED MAP — the owner's no-dead-ends rule ──────────────────────────────
   Every guided setting persists to the doc, but not all of them are consumed
   by the published runtime / main builder yet. Anything false here renders a
   quiet "not connected yet" tag beside its control so it gets wired rather
   than silently dropped. Update this map as the runtime seams land. */
export const WIRED: Record<string, boolean> = {
  headline: true,
  whyCopy: true,
  layout: true,
  gridMax: true,
  perRow: false, // runtime grid is its own responsive rule today
  showStars: true,
  showVerified: false,
  showAtc: true,
  showDesc: true,
  descOverrides: false,
  showAddAll: true,
  discount_basic: true, // enabled/kind/value/limits → publish-time code (quizPublish)
  discount_advanced: false, // code_mode/eligibility/expiry-hours/scope/combines/purchase/deliver
  placement_before: true, // captureEmail gate screen
  placement_none: true,
  placement_inline: false,
  placement_discount: false, // needs the server-side mint on submit (discount.server seam exists)
  captureRequired: false,
  captureWording: true, // captureHeadline/Subtext wired; cta/skip labels are NOT
  captureCtaSkip: false,
  consent: false, // captureTermsOn/Text wired; marketing-consent row + split links are NOT
  loading: false,
  extras: false,
};
