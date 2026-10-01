import { useRef, useState } from "react";
import type { Quiz, RecPageGlobal } from "../../../lib/quizSchema";
import { setRecPageGlobal } from "../../../lib/quizMutations";
import { placementPatch, stampConsent, type Placement } from "../../../lib/captureMode";
import {
  DEFAULT_PRIVACY_LABEL,
  DEFAULT_TERMS_LABEL,
  TERMS_BOX,
  TERMS_LINE,
  smsBoxLabel,
  wordingText,
} from "../../../lib/consentWording";
import { resolveGuided } from "../resultsGuided/state";
import { QzModal } from "../../qz-overlays";

// Results handoff §10 — this step and the Results step edit the SAME keys
// through the same helpers (placementPatch, stampConsent), so what is chosen
// here is already set when the merchant reaches Results. Terms can be a line
// or a checkbox but never off; SMS always carries its own checkbox; the
// wording is fixed (consentWording.ts).
export function emailSummary(doc: Quiz): string {
  const c = resolveGuided(doc);
  const placement =
    c.where === "before" ? "Before results" : c.where === "inline" ? "On the results page" : "Not collecting";
  if (c.where === "none") return placement;
  return [
    placement,
    c.where === "before" ? (c.captureRequired ? "required" : "optional") : null,
    `terms ${c.captureTermsMode === "checkbox" ? "checkbox" : "notice"}`,
    c.capturePhone ? "SMS" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function EmailScreen({
  doc,
  commit,
}: {
  doc: Quiz;
  commit: (doc: Quiz) => void;
}) {
  const cfg = resolveGuided(doc);
  const [confirmOff, setConfirmOff] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const off = cfg.where === "none";
  const before = cfg.where === "before";
  const patch = (p: Partial<RecPageGlobal>) => commit(setRecPageGlobal(doc, stampConsent(p)));
  const setPlacement = (placement: Placement) => patch(placementPatch(placement));
  const labels = {
    terms: cfg.termsLabel?.trim() || DEFAULT_TERMS_LABEL,
    privacy: cfg.privacyLabel?.trim() || DEFAULT_PRIVACY_LABEL,
  };
  const termsMode = cfg.captureTermsMode === "checkbox" ? "checkbox" : "notice";
  const termsModes = (
    <div className="qz-walk-mode">
      <div className="qz-segmented" role="group" aria-label="Terms consent mode">
        {(["checkbox", "notice"] as const).map((v) => (
          <button
            type="button"
            key={v}
            aria-pressed={termsMode === v}
            onClick={() => patch({ captureTermsMode: v })}
          >
            {v === "checkbox" ? "Checkbox" : "Notice only"}
          </button>
        ))}
      </div>
      <p>
        {termsMode === "checkbox" ? "Beside a checkbox: " : "Under the email field: "}
        {wordingText(termsMode === "checkbox" ? TERMS_BOX : TERMS_LINE, labels)}
      </p>
    </div>
  );
  return (
    <>
      <h2 className="qz-walk-email-title">Email capture</h2>
      <p className="qz-walk-description">
        Wording, consent links, discounts and email targeting are configured
        later.
      </p>
      <section className="qz-walk-settings">
        <h3>When to ask</h3>
        <div className="qz-segmented" role="group" aria-label="Email placement">
          <button
            type="button"
            aria-pressed={before}
            onClick={() => setPlacement("before")}
          >
            Before results
          </button>
          <button
            type="button"
            aria-pressed={cfg.where === "inline"}
            onClick={() => setPlacement("inline")}
          >
            On the results page
          </button>
          <button
            type="button"
            aria-pressed={cfg.where === "none"}
            onClick={() =>
              cfg.capturePhone ? setConfirmOff(true) : setPlacement("none")
            }
          >
            Don’t collect
          </button>
        </div>
        {cfg.capturePhone && (
          <p className="qz-walk-description">
            Choosing “Don’t collect” also removes the SMS collection setting.
          </p>
        )}
        {cfg.where === "inline" ? (
          <p className="qz-walk-description">Email is set to inline capture on the Results step.</p>
        ) : null}
      </section>
      <fieldset className="qz-walk-settings" disabled={off}>
        <legend>Options</legend>
        <label className="qz-walk-toggle">
          <input
            type="checkbox"
            checked={cfg.captureRequired}
            disabled={!before}
            onChange={(e) => patch({ captureRequired: e.target.checked })}
          />
          <span>
            Require email to see results
            {!before && <small>Only when asked before results</small>}
          </span>
        </label>
        {/* The privacy notice cannot be switched off while an email is
            collected (GDPR art. 13 / CCPA): terms is a line or a box. */}
        <div className="qz-walk-toggle is-static">
          <span>Terms and conditions</span>
        </div>
        {termsModes}
        <label className="qz-walk-toggle">
          <input
            type="checkbox"
            checked={cfg.capturePhone}
            onChange={(e) => patch({ capturePhone: e.target.checked ? true : undefined })}
          />
          <span>
            Collect a phone number for SMS
            {cfg.capturePhone && (
              <small>Shoppers get their own unticked box: “{smsBoxLabel(undefined)}”</small>
            )}
          </span>
        </label>
        <label className="qz-walk-toggle">
          <input
            type="checkbox"
            checked={cfg.loadingOn}
            onChange={(e) =>
              patch({
                loadingOn: e.target.checked,
                ...(e.target.checked ? { loadingMs: cfg.loadingMs } : {}),
              })
            }
          />
          <span>
            Loading screen before results
            {cfg.loadingOn && (
              <small>
                Adds a few-second delay screen before the results page.
              </small>
            )}
          </span>
        </label>
      </fieldset>
      <QzModal
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        destructive
        size="sm"
        title="Stop collecting email and SMS?"
        initialFocusRef={cancel}
        footer={
          <>
            <button
              ref={cancel}
              type="button"
              className="qz-btn"
              onClick={() => setConfirmOff(false)}
            >
              Keep collecting
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-danger"
              onClick={() => {
                setPlacement("none");
                setConfirmOff(false);
              }}
            >
              Don’t collect
            </button>
          </>
        }
      >
        This also removes the phone-number collection setting. Turning email
        back on will not restore SMS collection.
      </QzModal>
    </>
  );
}
