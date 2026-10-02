import {
  CONSENT_VERSION,
  DEFAULT_PRIVACY_LABEL,
  DEFAULT_PRIVACY_PATH,
  DEFAULT_TERMS_LABEL,
  DEFAULT_TERMS_PATH,
  defaultMarketingCopy,
} from "./consentWording";
import type { RecPageGlobal } from "./quizSchema";
import type { ResolvedRecPageConfig } from "./recommendDecider";
export function captureMode(
  config: ResolvedRecPageConfig,
): "gate" | "inline" | "none" {
  if (
    config.captureInlineOn === true &&
    config.capturePlacement === "inline" &&
    config.captureEmail
  )
    return "inline";
  return config.captureEmail || config.captureName || config.capturePhone
    ? "gate"
    : "none";
}

// ── Results handoff §7/§10 — ONE writer for the placement, shared by the
// Questions step and the Results step, so the two can never disagree about
// the three keys that move together.

export type Placement = "before" | "inline" | "none";

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

/**
 * Results handoff §7, unsettled case 1 — the unlock is on but no discount is
 * active: the live quiz must not promise one, so the ask renders as if the
 * unlock were off. Only the builder's own unlock preset is swapped; words the
 * merchant wrote are theirs and stay.
 */
export function plainAskCopy<
  T extends { captureHeadline?: string; captureSubtext?: string; captureCta?: string },
>(config: T, where: "before" | "inline"): T {
  const promise = GATE_COPY.unlock;
  const plain = GATE_COPY[where];
  return {
    ...config,
    ...(config.captureHeadline === promise.headline ? { captureHeadline: plain.headline } : {}),
    ...(config.captureSubtext === promise.copy ? { captureSubtext: plain.copy } : {}),
    ...(config.captureCta === promise.cta ? { captureCta: plain.cta } : {}),
  };
}


/** The builder's reading of the stored placement. "discount" (the retired
 *  fourth option) reads as inline with the unlock on. */
export function readPlacement(g: Partial<RecPageGlobal>): { where: Placement; unlock: boolean } {
  if (g.capturePlacement === "discount") return { where: "inline", unlock: true };
  if (g.capturePlacement === "inline" || g.capturePlacement === "none") {
    return { where: g.capturePlacement, unlock: g.captureUnlocksOffer === true };
  }
  if (g.captureEmail === false) return { where: "none", unlock: false };
  return { where: "before", unlock: g.captureUnlocksOffer === true };
}

/** The keys a placement change writes, together. `none` turns the unlock
 *  off (nothing to unlock behind); the "discount" value is normalised away. */
export function placementPatch(where: Placement): Partial<RecPageGlobal> {
  return {
    capturePlacement: where,
    captureEmail: where === "none" ? false : undefined,
    captureInlineOn: where === "inline" ? true : undefined,
    ...(where === "none" ? { captureUnlocksOffer: undefined } : {}),
  };
}

const CONSENT_KEYS = [
  "consentOn",
  "consentCopy",
  "termsLabel",
  "termsUrl",
  "privacyLabel",
  "privacyUrl",
  "captureTermsMode",
  "captureTermsOn",
  "capturePhone",
  "smsConsentMode",
] as const;

/**
 * Results handoff §9/§10 — every consent write moves the quiz onto the fixed
 * wording: it stamps the current consentVersion, holds terms on (the privacy
 * notice cannot be switched off while an email is collected), and gives SMS
 * its own checkbox. A patch touching no consent key passes through unchanged.
 */
export function stampConsent(patch: Partial<RecPageGlobal>): Partial<RecPageGlobal> {
  if (!CONSENT_KEYS.some((k) => k in patch)) return patch;
  return {
    ...patch,
    consentVersion: CONSENT_VERSION,
    captureTermsOn: true,
    ...(patch.capturePhone === true ? { smsConsentMode: "checkbox" as const } : {}),
  };
}

/**
 * Results handoff §3 — where a NEW quiz starts. Written explicitly at draft
 * creation (funnelDraft.server.ts) because the read-time defaults must keep
 * matching what already-published quizzes do: marketing consent on, with the
 * brand's box text written once as ordinary text; descriptions off; the four
 * policy-link keys always stored; the fixed-wording form from the start.
 */
export function creationRecPageGlobal(storeName?: string): Partial<RecPageGlobal> {
  return {
    consentOn: true,
    consentCopy: defaultMarketingCopy(storeName),
    showDesc: false,
    termsLabel: DEFAULT_TERMS_LABEL,
    termsUrl: DEFAULT_TERMS_PATH,
    privacyLabel: DEFAULT_PRIVACY_LABEL,
    privacyUrl: DEFAULT_PRIVACY_PATH,
    captureTermsOn: true,
    captureTermsMode: "notice",
    consentVersion: CONSENT_VERSION,
  };
}
