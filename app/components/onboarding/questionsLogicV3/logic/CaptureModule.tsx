import type { z } from "zod";
import type { Quiz, RecPageGlobal } from "../../../../lib/quizSchema";
import { resolveRecPageGlobal } from "../../../../lib/recommendDecider";

type QuizDoc = z.infer<typeof Quiz>;

/* QZY-2 (owner supplement) — the flow's TERMINAL config: instead of a bare
   "End quiz", the flow ends at "Email capture / End quiz". Pre-populated,
   always last, and editable in place at the settings level (email / SMS /
   terms toggles — the same RecPageGlobal fields the phone's capture screen
   edits, so both surfaces save to one place). QRTZ-G3 relocated its mount
   from the Logic step to the Questions step's Email-capture rail row
   (LeftRail capturePanel) — the component itself is unchanged. Copy editing
   lives on the phone's capture screen. */

export function CaptureModule({
  doc,
  captureOn,
  onCommit,
}: {
  doc: QuizDoc;
  captureOn: boolean;
  onCommit: (doc: QuizDoc) => void;
}) {
  const cfg = resolveRecPageGlobal(doc.rec_page_settings);
  const patch = (p: Partial<RecPageGlobal>) =>
    onCommit({
      ...doc,
      rec_page_settings: {
        global: { ...(doc.rec_page_settings?.global ?? {}), ...p },
        overrides: doc.rec_page_settings?.overrides ?? {},
      },
    });

  return (
    <section className="qz-s3-capmod" aria-label="Quiz ending">
      <div className="qz-s3-capmod-head">
        <span className="qz-s3-numchip is-capture" aria-hidden>
          ✉
        </span>
        <h3 className="qz-s3-capmod-title">
          {captureOn ? "Email capture / End quiz" : "End quiz"}
        </h3>
        <span className="qz-s3-capmod-note">always the last step</span>
      </div>
      <div className="qz-s3-capmod-body">
        <label className="qz-s3-capmod-toggle">
          <input
            type="checkbox"
            checked={cfg.captureEmail}
            onChange={(e) => patch({ captureEmail: e.target.checked })}
          />
          <span>Collect email before the reveal</span>
        </label>
        <label className={`qz-s3-capmod-toggle${!captureOn ? " is-dim" : ""}`}>
          <input
            type="checkbox"
            disabled={!captureOn}
            checked={cfg.capturePhone}
            onChange={(e) => patch({ capturePhone: e.target.checked })}
          />
          <span>SMS collection (phone)</span>
        </label>
        <label className={`qz-s3-capmod-toggle${!captureOn ? " is-dim" : ""}`}>
          <input
            type="checkbox"
            disabled={!captureOn}
            checked={cfg.captureTermsOn}
            onChange={(e) => patch({ captureTermsOn: e.target.checked })}
          />
          <span>Terms &amp; conditions checkbox</span>
        </label>
        <p className="qz-s3-capmod-hint">
          Wording lives on the Content view&rsquo;s capture screen.
        </p>
      </div>
    </section>
  );
}
