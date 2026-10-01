import type { Quiz, RecPageGlobal, DiscountConfig } from "../../../lib/quizSchema";
import {
  GUIDED_LOADING_STEPS,
  resolveRecPageGlobal,
  type ResolvedRecPageConfig,
} from "../../../lib/recommendDecider";
import { setRecPageGlobal } from "../../../lib/quizMutations";
import { placementPatch, readPlacement, stampConsent, type Placement } from "../../../lib/captureMode";
import {
  DEFAULT_PRIVACY_LABEL,
  DEFAULT_PRIVACY_PATH,
  DEFAULT_TERMS_LABEL,
  DEFAULT_TERMS_PATH,
} from "../../../lib/consentWording";

/* Results-guided handoff (docs/design/results-guided/DEV-HANDOFF.md) — the
   guided flow's read/write seam. Reads resolve defaults at READ time (the
   schema stays .optional() everywhere); writes go through setRecPageGlobal's
   sparse-patch discipline or a whole-key discount_config replace. */

// ── read-time defaults for the guided-only fields ───────────────────────────
// A builder default MUST equal what the live quiz does when the key is
// absent: patchGuided clears default-equal keys. Where new quizzes should
// start elsewhere (consent on, descriptions off), the value is written
// explicitly at draft creation (funnelDraft.server.ts), never by moving a
// default here.
export const GUIDED_DEFAULTS = {
  perRow: 2,
  captureRequired: true,
  captureCta: "Show my results",
  captureSkipLabel: "No thanks, just show my results",
  consentOn: false,
  // Empty = the live form's default text (defaultMarketingCopy).
  consentCopy: "",
  termsLabel: DEFAULT_TERMS_LABEL,
  termsUrl: DEFAULT_TERMS_PATH,
  privacyLabel: DEFAULT_PRIVACY_LABEL,
  privacyUrl: DEFAULT_PRIVACY_PATH,
  loadingOn: true,
  loadingMs: 1600,
  loadingNamed: true,
  loadingSteps: [...GUIDED_LOADING_STEPS],
  extrasOn: false,
  // The live quiz's read-time heading; the builder writes its own heading the
  // first time products are picked (EXTRAS_FIRST_PICK).
  extrasHeading: "Also worth a look",
  extrasCopy: "",
  extrasCount: 3,
  extrasProductIds: [] as string[],
};

// Handoff §4 defect 1(b) — the live quiz has no link defaults of its own for
// the old form, so these are ALWAYS stored, never sparse-cleared.
// captureCta too: the builder shows "Show my results" but the live quiz falls
// back to "Continue" when the key is absent.
const ALWAYS_STORED = new Set(["termsLabel", "termsUrl", "privacyLabel", "privacyUrl", "captureCta"]);

/** Written the first time the shelf gets products (handoff §6). */
export const EXTRAS_FIRST_PICK = {
  extrasHeading: "You might also like",
  extrasCopy: "Popular with shoppers like you.",
};

// Placement copy presets — applied while the merchant hasn't written their
// own (build_session.results_guided.copy_touched); the builder writes them
// explicitly, so the live quiz's own fallbacks stay untouched.
export const GATE_COPY: Record<Placement | "unlock", { headline: string; copy: string; cta: string }> = {
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
  unlock: {
    headline: "Submit your email to unlock the discount",
    copy: "We’ll send the code straight over. Yours to use on any match below.",
    cta: "Unlock my discount",
  },
  none: { headline: "", copy: "", cta: "" },
};

export const REVEAL_MAX_MS = 3000; // past this the wait reads as broken, not effort
/** The live interstitial clamps to 1.5 s or more (DeciderViews). */
export const LOADING_MIN_MS = 1500;
export const LOADING_MAX_MS = 5000;
export const LOADING_STEP_MS = 500;

export type GuidedConfig = ResolvedRecPageConfig &
  typeof GUIDED_DEFAULTS & { where: Placement; unlock: boolean };

/** The whole guided config, defaults resolved. */
export function resolveGuided(doc: Quiz): GuidedConfig {
  const base = resolveRecPageGlobal(doc.rec_page_settings);
  const g = (doc.rec_page_settings?.global ?? {}) as RecPageGlobal;
  const merged = { ...GUIDED_DEFAULTS, ...base } as GuidedConfig;
  // .optional() fields need explicit presence checks (undefined must not
  // clobber the ship default the way a spread of the raw global would).
  for (const k of Object.keys(GUIDED_DEFAULTS) as (keyof typeof GUIDED_DEFAULTS)[]) {
    const v = g[k as keyof RecPageGlobal];
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  // Explicit older loading configurations used a two-second fallback;
  // wholly absent loading settings still use the original 1.6-second beats.
  if (g.loadingMs === undefined && (g.loadingOn === true || g.loadingNamed !== undefined || (g.loadingSteps?.length ?? 0) > 0)) merged.loadingMs = 2000;
  const placement = readPlacement(g);
  merged.where = placement.where;
  merged.unlock = placement.unlock;
  return merged;
}

/** Sparse global patch: a value equal to its default clears the key (except
 *  the policy links, always stored). A placement change writes its three
 *  keys together; any consent key stamps the fixed-wording version. */
export function patchGuided(
  doc: Quiz,
  patch: Partial<RecPageGlobal> & { where?: Placement },
): Quiz {
  const { where: whereIn, ...rest } = patch;
  // A raw capturePlacement patch is routed through the same writer, so the
  // three placement keys always move together. "discount" is never written.
  const raw = rest.capturePlacement;
  const where = whereIn ?? (raw && raw !== "discount" ? raw : undefined);
  if (raw !== undefined) delete rest.capturePlacement;
  const full: Partial<RecPageGlobal> = stampConsent({
    ...rest,
    ...(where !== undefined ? placementPatch(where) : {}),
  });
  const sparse: Record<string, unknown> = {};
  const defaults = { ...GUIDED_DEFAULTS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(full)) {
    const keep = k === "loadingMs" || ALWAYS_STORED.has(k);
    sparse[k] = keep ? v : deepEqual(v, defaults[k]) ? undefined : v;
  }
  return setRecPageGlobal(doc, sparse as Partial<RecPageGlobal>);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  return false;
}

/** Snap a loading duration onto the 0.5 s grid inside the live clamp. */
export function snapLoadingMs(ms: number): number {
  const snapped = Math.round(ms / LOADING_STEP_MS) * LOADING_STEP_MS;
  return Math.min(LOADING_MAX_MS, Math.max(LOADING_MIN_MS, snapped));
}

// ── builder-only state, persisted in build_session (stripped at publish) ────
export type GuidedSession = NonNullable<NonNullable<Quiz["build_session"]>["results_guided"]>;

export function readSession(doc: Quiz): GuidedSession {
  return doc.build_session?.results_guided ?? {};
}

export function writeSession(doc: Quiz, next: Partial<GuidedSession>): Quiz {
  const session = doc.build_session;
  if (!session) return doc;
  return {
    ...doc,
    build_session: { ...session, results_guided: { ...(session.results_guided ?? {}), ...next } },
  };
}

// ── discount ────────────────────────────────────────────────────────────────
// Read-time defaults for the editor. Only keys a Shopify field (or the app's
// own mint) reads live here; the retired guided keys (auto_apply,
// eligibility, segment, scope, exclude_sale, deliver_*) still parse forever
// but are never written again (handoff §8 "Cut from main's editor").
export const DISCOUNT_DEFAULTS = {
  code_mode: "dynamic" as NonNullable<DiscountConfig["code_mode"]>,
  code_prefix: "QUIZ-",
  static_code: "",
  existing_code: "",
  expiry_mode: "hours" as NonNullable<DiscountConfig["expiry_mode"]>,
  expiry_hours: 24,
  purchase: "onetime" as NonNullable<DiscountConfig["purchase"]>,
  recurring_limit: 1,
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

/** Handoff §7 — "a discount exists": the editor's first Save stamps
 *  `configured`; quizzes that used the retired presets only have `enabled`. */
export function discountExists(doc: Quiz): boolean {
  const d = doc.discount_config;
  return d?.configured === true || d?.enabled === true;
}

/**
 * Replace the stored discount with the editor's result. Handoff §4: MERGE
 * FIRST, THEN STRIP — keys equal to their read-time default are removed from
 * the merged object, so resetting a field to its default really clears the
 * stored value (the old strip-before-merge let a stored shared code survive a
 * switch back to per-shopper). Keys are deleted, never set to undefined:
 * resolveDiscount spreads an explicit undefined over the default.
 */
export function writeDiscount(doc: Quiz, next: Partial<DiscountConfig>): Quiz {
  const merged: Record<string, unknown> = { ...(doc.discount_config ?? {}), ...next };
  for (const [k, v] of Object.entries(DISCOUNT_DEFAULTS)) {
    if (merged[k] === v) delete merged[k];
  }
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  return { ...doc, discount_config: merged as Quiz["discount_config"] };
}

/** Handoff §7 — a shared or existing code must never sit behind the email
 *  ask (the published quiz is public). Unlock forces per-shopper codes. */
export function forcePerShopperCode(doc: Quiz): Quiz {
  const d = doc.discount_config;
  if (!d || d.code_mode === undefined || d.code_mode === "dynamic") return doc;
  const next = writeDiscount(doc, { code_mode: "dynamic" });
  const { static_code: _s, existing_code: _e, ...rest } = next.discount_config as Record<string, unknown>;
  void _s;
  void _e;
  return { ...next, discount_config: rest as Quiz["discount_config"] };
}

/* ── WIRED MAP — the owner's no-dead-ends rule ──────────────────────────────
   A control whose live reader has not landed carries a quiet "not connected
   yet" tag (handoff §2 release rule). The decider results page reads nothing
   from discount_config today, and publish no longer mints a shared code for
   decider quizzes (handoff §4 defect 2): every discount control waits on the
   per-shopper pipeline (handoff §12). */
export const WIRED: Record<string, boolean> = {
  headline: true,
  whyCopy: true,
  layout: true,
  showAtc: true,
  showDesc: true,
  descOverrides: true,
  showAddAll: true,
  discount: false, // the offer bar + per-shopper mint (handoff §12)
  unlock: false, // the locked offer card (handoff §7 + §12)
  placement_before: true,
  placement_none: true,
  placement_inline: true,
  captureRequired: true,
  captureWording: true,
  captureCtaSkip: true,
  consent: true, // the fixed-wording form (consentVersion)
  loading: true,
  extras: true,
  fallbackOn: true,
};
