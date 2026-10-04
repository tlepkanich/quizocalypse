import { creditTagText, type AiFeatureKey } from "../lib/billing/catalog";

// Account & Billing — the credit tag (BILLING-HANDOFF.md, "Credit tag"): a
// small grey pill on a control that turns on an AI feature charged per use.
// It states a cost and is not a warning, so it is the same grey on every
// feature. The text comes from the one feature list in billing/catalog.ts.
export function CreditTag({ feature }: { feature: AiFeatureKey }) {
  return (
    <span className="qz-ctag" data-credit-tag={feature}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M19 15v4" />
        <path d="M17 17h4" />
      </svg>
      {creditTagText(feature)}
    </span>
  );
}
