import { useRef, useState } from "react";
import type { Quiz, RecPageGlobal } from "../../../lib/quizSchema";
import { setRecPageGlobal } from "../../../lib/quizMutations";
import { resolveGuided } from "../resultsGuided/state";
import { resolveRecPageGlobal } from "../../../lib/recommendDecider";
import {
  termsCopy,
  noticeText,
  SMS_CHECKBOX,
  SMS_NOTICE,
} from "../../runtime/views/ConsentNotice";
import { QzModal } from "../../qz-overlays";
export function emailSummary(doc: Quiz): string {
  const c = resolveGuided(doc);
  const placement =
    c.capturePlacement === "before"
      ? c.captureEmail
        ? "Before results"
        : "Not collecting"
      : c.capturePlacement === "none"
        ? "Not collecting"
        : c.capturePlacement === "inline"
          ? "On the results page"
          : "Discount capture";
  return [
    placement,
    c.captureEmail && c.capturePlacement === "before"
      ? c.captureRequired
        ? "required"
        : "optional"
      : null,
    c.captureTermsOn ? `terms ${c.captureTermsMode ?? "checkbox"}` : null,
    c.capturePhone
      ? `SMS ${c.smsConsentMode ?? "no consent configured"}`
      : null,
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
  const runtimeCfg = resolveRecPageGlobal(doc.rec_page_settings);
  const [confirmOff, setConfirmOff] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const termsMode = useRef(cfg.captureTermsMode ?? "checkbox");
  const smsMode = useRef(cfg.smsConsentMode ?? "checkbox");
  const off = cfg.capturePlacement === "none" || !cfg.captureEmail;
  const before = cfg.capturePlacement === "before" && cfg.captureEmail;
  const patch = (p: Partial<RecPageGlobal>) => commit(setRecPageGlobal(doc, p));
  const setPlacement = (placement: "before" | "inline" | "none") =>
    patch({
      capturePlacement: placement,
      captureEmail: placement !== "none",
      captureInlineOn: placement === "inline" ? true : undefined,
    });
  const modes = (kind: "terms" | "sms") => {
    const mode =
      kind === "terms"
        ? (cfg.captureTermsMode ?? "checkbox")
        : (cfg.smsConsentMode ?? "checkbox");
    return (
      <div className="qz-walk-mode">
        <div
          className="qz-segmented"
          role="group"
          aria-label={`${kind === "terms" ? "Terms" : "SMS"} consent mode`}
        >
          {(["checkbox", "notice"] as const).map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={mode === v}
              onClick={() => {
                if (kind === "terms") {
                  termsMode.current = v;
                  patch({ captureTermsMode: v });
                } else {
                  smsMode.current = v;
                  patch({ smsConsentMode: v });
                }
              }}
            >
              {v === "checkbox" ? "Checkbox" : "Notice only"}
            </button>
          ))}
        </div>
        <p>
          {mode === "checkbox" ? "Beside a checkbox: " : "Under the button: "}
          {kind === "terms"
            ? mode === "notice"
              ? noticeText(runtimeCfg)
              : termsCopy(runtimeCfg)
            : cfg.smsConsentText ||
              (mode === "notice" ? SMS_NOTICE : SMS_CHECKBOX)}
        </p>
      </div>
    );
  };
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
            aria-pressed={
              cfg.capturePlacement === "inline" && cfg.captureInlineOn === true
            }
            onClick={() => setPlacement("inline")}
          >
            On the results page
          </button>
          <button
            type="button"
            aria-pressed={cfg.capturePlacement === "none"}
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
        {cfg.capturePlacement === "inline" ||
        cfg.capturePlacement === "discount" ? (
          <p className="qz-walk-description">
            Email is set to{" "}
            {cfg.capturePlacement === "inline"
              ? "inline capture"
              : "discount capture"}{" "}
            on the Results step.
          </p>
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
        <label className="qz-walk-toggle">
          <input
            type="checkbox"
            checked={cfg.captureTermsOn}
            onChange={(e) =>
              patch({
                captureTermsOn: e.target.checked,
                ...(e.target.checked
                  ? { captureTermsMode: termsMode.current }
                  : {}),
              })
            }
          />
          <span>Terms and conditions</span>
        </label>
        {cfg.captureTermsOn && modes("terms")}
        <label className="qz-walk-toggle">
          <input
            type="checkbox"
            checked={cfg.capturePhone}
            onChange={(e) =>
              patch({
                capturePhone: e.target.checked,
                ...(e.target.checked
                  ? { smsConsentMode: smsMode.current }
                  : {}),
              })
            }
          />
          <span>Collect a phone number for SMS</span>
        </label>
        {cfg.capturePhone && modes("sms")}
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
