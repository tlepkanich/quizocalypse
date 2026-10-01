import type { ResolvedRecPageConfig } from "../../../lib/recommendDecider";
import {
  DEFAULT_PRIVACY_LABEL,
  DEFAULT_TERMS_LABEL,
  TERMS_BOX,
  TERMS_LINE,
  defaultMarketingCopy,
  resolvePolicyLinks,
  smsBoxLabel,
  smsSmallPrint,
  unsubscribeLine,
  wordingText,
  type WordingPart,
} from "../../../lib/consentWording";

// Results handoff §9 — the fixed-wording consent form, rendered by
// DeciderCaptureView ONLY when config.consentVersion is present (absent →
// today's form, DOM-identical). Every sentence comes from consentWording.ts;
// the merchant supplies the marketing box's text and the two links. All text
// goes in as React text children, never as raw HTML.

export type FixedConsentState = {
  marketing: boolean;
  sms: boolean;
  terms: boolean;
};

export function fixedConsentFacts(
  config: ResolvedRecPageConfig,
  shopDomain: string | undefined,
  storeName: string | undefined,
  smsReady: boolean,
) {
  const links = resolvePolicyLinks(config, shopDomain);
  const labels = {
    terms: config.termsLabel?.trim() || DEFAULT_TERMS_LABEL,
    privacy: config.privacyLabel?.trim() || DEFAULT_PRIVACY_LABEL,
  };
  const termsIsBox = config.captureTermsMode === "checkbox";
  const termsParts = termsIsBox ? TERMS_BOX : TERMS_LINE;
  return {
    links,
    labels,
    termsIsBox,
    termsParts,
    termsText: wordingText(termsParts, labels),
    marketingOn: config.consentOn === true,
    marketingText: config.consentCopy?.trim() || defaultMarketingCopy(storeName),
    // §14 guardrail 2 — the phone field (and so its box) reaches the live quiz
    // only while an SMS destination can take the number.
    smsOn: config.capturePhone === true && smsReady,
    smsLabel: smsBoxLabel(storeName),
    unsubscribe: unsubscribeLine(storeName),
    smsFine: smsSmallPrint(storeName),
  };
}

export type FixedConsentFacts = ReturnType<typeof fixedConsentFacts>;

// "Clear and conspicuous" (the SMS rule) — the theme's small size, never
// below 11px.
const SMALL = "max(11px, calc(var(--qz-base-size) * 0.85))";

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  fontSize: SMALL,
  fontFamily: "var(--qz-font-body)",
  color: "var(--qz-color-muted)",
  cursor: "pointer",
  textAlign: "left",
};

function Sentence({ parts, facts }: { parts: readonly WordingPart[]; facts: FixedConsentFacts }) {
  return (
    <>
      {parts.map((part, i) => {
        if (typeof part === "string") return part;
        const href = facts.links[part.link];
        const label = facts.labels[part.link];
        return href ? (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            {label}
          </a>
        ) : (
          <span key={i}>{label}</span>
        );
      })}
    </>
  );
}

/** Every checkbox together: email marketing · SMS · terms (last, only when
 *  it is a box). Marketing and SMS start unticked and never block submit. */
export function FixedConsentChecks({
  facts,
  state,
  onChange,
}: {
  facts: FixedConsentFacts;
  state: FixedConsentState;
  onChange: (next: FixedConsentState) => void;
}) {
  const box = (key: keyof FixedConsentState, label: React.ReactNode) => (
    <label style={rowStyle} data-qz-consent={key}>
      <input
        type="checkbox"
        checked={state[key]}
        onChange={(e) => onChange({ ...state, [key]: e.target.checked })}
        style={{ marginTop: 3 }}
      />
      <span>{label}</span>
    </label>
  );
  return (
    <>
      {facts.marketingOn ? box("marketing", facts.marketingText) : null}
      {facts.smsOn ? box("sms", facts.smsLabel) : null}
      {facts.termsIsBox ? box("terms", <Sentence parts={facts.termsParts} facts={facts} />) : null}
    </>
  );
}

/** The legal text, above the button: the terms line (when not a box), the
 *  unsubscribe line (while marketing consent is on), the SMS small print. */
export function FixedLegalText({ facts }: { facts: FixedConsentFacts }) {
  const lines: React.ReactNode[] = [];
  if (!facts.termsIsBox) lines.push(<Sentence key="t" parts={facts.termsParts} facts={facts} />);
  if (facts.marketingOn) lines.push(facts.unsubscribe);
  if (facts.smsOn) lines.push(facts.smsFine);
  if (lines.length === 0) return null;
  return (
    <div
      data-qz-consent="legal"
      style={{
        display: "grid",
        gap: 6,
        fontSize: SMALL,
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-color-muted)",
        textAlign: "left",
      }}
    >
      {lines.map((line, i) => (
        <p key={i} style={{ margin: 0 }}>
          {line}
        </p>
      ))}
    </div>
  );
}
