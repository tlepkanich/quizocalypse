// Results handoff §9 — the fixed consent wording. ONE module, versioned,
// imported by the builder preview and the live quiz alike, so what a merchant
// previews is what a shopper reads. Merchants cannot edit these sentences:
// "If there is something standard we have to say, don't make it editable."
// Change them only with counsel sign-off, and bump CONSENT_VERSION — the
// version is recorded with every capture (analytics.ts CapturePayload).
//
// Kept OUT of CHROME_TOKENS on purpose: adding tokens marks every locale of
// every quiz stale, and the translation guard does not protect {…}
// placeholders, so a locale that dropped {terms} would silently lose its link.
// First release: English legal lines on every locale (§17.5).

export const CONSENT_VERSION = "2026-09-17";

export const DEFAULT_TERMS_LABEL = "Terms & Conditions";
export const DEFAULT_PRIVACY_LABEL = "Privacy Policy";
export const DEFAULT_TERMS_PATH = "/policies/terms-of-service";
export const DEFAULT_PRIVACY_PATH = "/policies/privacy-policy";

export type PolicyLink = "terms" | "privacy";
/** A sentence with its two policy links left as slots for the renderer. */
export type WordingPart = string | { link: PolicyLink };

const TERMS = { link: "terms" } as const;
const PRIVACY = { link: "privacy" } as const;

/** Terms as a passive line. A privacy notice is ACKNOWLEDGED, never agreed
 *  to — "agreeing" to it is not a lawful basis. */
export const TERMS_LINE: readonly WordingPart[] = [
  "By continuing, you agree to our ",
  TERMS,
  " and acknowledge our ",
  PRIVACY,
  ".",
];

/** Terms as a box the form will not submit without. */
export const TERMS_BOX: readonly WordingPart[] = [
  "I agree to the ",
  TERMS,
  " and acknowledge the ",
  PRIVACY,
  ".",
];

// With no store name baked (a quiz published before shop_name existed), each
// sentence falls back to wording that still names the sender as "us".
export function unsubscribeLine(storeName: string | undefined): string {
  const name = storeName?.trim();
  return name
    ? `You can unsubscribe from ${name} emails at any time.`
    : "You can unsubscribe from our emails at any time.";
}

export function smsBoxLabel(storeName: string | undefined): string {
  const name = storeName?.trim();
  return name ? `Text me offers from ${name}.` : "Text me offers from us.";
}

export function smsSmallPrint(storeName: string | undefined): string {
  const sender = storeName?.trim() || "us";
  return (
    `By ticking “Text me offers”, you agree to receive recurring automated marketing texts from ${sender} ` +
    "at the number provided. Consent isn’t a condition of purchase. Msg frequency varies; " +
    "msg & data rates may apply. Reply HELP for help, STOP to cancel."
  );
}

/** The brand's own marketing-checkbox text, written ONCE at quiz creation as
 *  ordinary text (never re-filled later). */
export function defaultMarketingCopy(storeName: string | undefined): string {
  const name = storeName?.trim();
  return name ? `Email me news and offers from ${name}.` : "Email me news and offers.";
}

/** The sentence as plain text — the evidence string a capture records. */
export function wordingText(
  parts: readonly WordingPart[],
  labels: { terms: string; privacy: string },
): string {
  return parts.map((p) => (typeof p === "string" ? p : labels[p.link])).join("");
}

export type LinkCheck =
  | { ok: true; href: string; onStore: boolean }
  | { ok: false; empty: boolean; why: string };

function storeOrigin(shopDomain: string | undefined): string | null {
  const domain = shopDomain?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return domain ? `https://${domain}` : null;
}

/**
 * Where a policy link actually goes. The quiz is served from the APP's
 * domain, so a store path ("/policies/…") resolves against the STORE's
 * domain — resolved against the app it 404s. A custom link must be https://.
 * Refused: javascript:, http://, bare domains, //host, and empty links.
 */
export function checkPolicyLink(raw: string | undefined, shopDomain: string | undefined): LinkCheck {
  const value = (raw ?? "").trim();
  if (!value) return { ok: false, empty: true, why: "Add a link." };
  if (value.startsWith("/") && !value.startsWith("//")) {
    const origin = storeOrigin(shopDomain);
    if (!origin) return { ok: false, empty: false, why: "Your store's domain is unknown, so use a full https:// link." };
    return { ok: true, href: new URL(value, origin).href, onStore: true };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, empty: false, why: "Start with https:// or with / for a page on your store." };
  }
  if (url.protocol !== "https:") return { ok: false, empty: false, why: "Use a secure https:// link." };
  const origin = storeOrigin(shopDomain);
  return { ok: true, href: url.href, onStore: origin !== null && url.origin === origin };
}

/** The two links a shopper clicks: the merchant's own, or — when a key is
 *  absent — the store's default policy pages. Undefined when unusable. */
export function resolvePolicyLinks(
  config: { termsUrl?: string; privacyUrl?: string },
  shopDomain: string | undefined,
): { terms: string | undefined; privacy: string | undefined } {
  const pick = (value: string | undefined, fallback: string) => {
    const check = checkPolicyLink(value?.trim() ? value : fallback, shopDomain);
    return check.ok ? check.href : undefined;
  };
  return {
    terms: pick(config.termsUrl, DEFAULT_TERMS_PATH),
    privacy: pick(config.privacyUrl, DEFAULT_PRIVACY_PATH),
  };
}
