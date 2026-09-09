import type { ResolvedRecPageConfig } from "../../../lib/recommendDecider";

export const TERMS_NOTICE =
  "By continuing you agree to our {terms} and {privacy}.";
export const TERMS_CHECKBOX =
  "I agree to the Terms of Service and Privacy Policy.";
export function termsCopy(config: ResolvedRecPageConfig): string {
  return (
    config.captureTermsText ||
    (config.captureTermsMode === "notice"
      ? TERMS_NOTICE
      : config.captureTermsMode === "checkbox"
        ? TERMS_CHECKBOX
        : "I agree to receive marketing messages and accept the terms & conditions.")
  );
}
export function noticeText(config: ResolvedRecPageConfig): string {
  return termsCopy(config)
    .replaceAll("{terms}", config.termsLabel || "Terms of Service")
    .replaceAll("{privacy}", config.privacyLabel || "Privacy Policy");
}
export const SMS_CHECKBOX =
  "I agree to receive SMS messages at the phone number provided.";
export const SMS_NOTICE =
  "By continuing, you acknowledge the SMS notice for the phone number provided.";

export function policyHref(
  value: string | undefined,
  shopDomain: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const base = shopDomain
      ? shopDomain.includes("://")
        ? shopDomain
        : `https://${shopDomain}`
      : undefined;
    const url = new URL(value, base);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Only the new notice mode uses substitution. Existing checkbox text stays
// byte-identical. React renders text safely; no merchant HTML is interpreted.
export function ConsentNotice({
  config,
  shopDomain,
}: {
  config: ResolvedRecPageConfig;
  shopDomain?: string;
}) {
  const text = termsCopy(config);
  return (
    <>
      {text.split(/(\{terms\}|\{privacy\})/g).map((part, i) => {
        if (part !== "{terms}" && part !== "{privacy}") return part;
        const terms = part === "{terms}";
        const label =
          (terms ? config.termsLabel : config.privacyLabel) ||
          (terms ? "Terms of Service" : "Privacy Policy");
        const href = policyHref(
          terms ? config.termsUrl : config.privacyUrl,
          shopDomain,
        );
        return href ? (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" style={{color:"inherit",textDecoration:"underline"}}>
            {label}
          </a>
        ) : (
          <span key={i}>{label}</span>
        );
      })}
    </>
  );
}
