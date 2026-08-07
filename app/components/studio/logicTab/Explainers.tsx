import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useFocusTrap } from "../../qz-overlays";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §7 + DECISIONS "copy corrections") — the two stepped
// explainer sheets. Static content, no engine dependency. Four steps each,
// clickable numbered progress, N of 4 · Back · Next/Done footer, and a
// cross-link on each closing step that swaps the sheet and resets to step 1.
//
// Copy corrections (engine-is-right): step "Top rule wins" teaches strict
// first-match-wins (at most ONE rule applies — never "excludes always
// apply"); "Both together" teaches that Show replaces the STARTING SET and
// Narrows still apply.
// ════════════════════════════════════════════════════════════════════════════

export type ExplainerKind = "rules" | "questions";

interface Step {
  title: string;
  body: ReactNode;
  figure: ReactNode;
}

function rulesSteps(): Step[] {
  return [
    {
      title: "One sentence, three parts",
      body: (
        <>
          Every rule reads the same way: who it applies to, what it does, and
          what it acts on.
        </>
      ),
      figure: (
        <div className="qz-xpl-grid3">
          <div className="qz-xpl-grid3-head">When they answer</div>
          <div className="qz-xpl-grid3-head">Do this</div>
          <div className="qz-xpl-grid3-head">To these</div>
          <div>Women <i>and</i> Smart</div>
          <div><b>Show</b></div>
          <div>Workwear Capsule</div>
          <div>Relaxed</div>
          <div><b>Exclude</b></div>
          <div>Wool Trousers</div>
          <div>Training kit <i>and</i> Under $60</div>
          <div><b>Highlight</b></div>
          <div>Performance Set</div>
        </div>
      ),
    },
    {
      title: "Top rule wins",
      body: (
        <>
          Checked top down. The first rule that matches applies — the rest are
          skipped. Drag a rule higher to give it the final word.
        </>
      ),
      figure: (
        <div className="qz-xpl-ledger">
          {[
            ["1", "When they pick Women and Smart, show Workwear Capsule.", "applies"],
            ["2", "When they pick Relaxed, exclude Wool Trousers.", "skipped"],
            ["3", "When they pick Training kit, show Performance Set.", "skipped"],
            ["4", "When they pick Under $60, highlight Sale.", "skipped"],
            ["5", "When they pick Gifts, show Gift Guide.", "skipped"],
          ].map(([n, s, tag]) => (
            <div key={n} className={`qz-xpl-lrow${tag === "applies" ? " is-lit" : ""}`}>
              <span className="qz-ltab-rnum">{n}</span>
              <span className="qz-xpl-lsent">{s}</span>
              <span className={`qz-xpl-ltag${tag === "applies" ? " is-ok" : ""}`}>{tag}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Rules can be the entire quiz",
      body: (
        <>
          A quiz can run on rules alone — no question has to touch your
          products. It suits a catalogue that is already grouped: curated
          capsules, tagged ranges, bundles, or a short list of hero products.
        </>
      ),
      figure: (
        <div className="qz-xpl-ledger">
          {[
            "When they pick Women, show Women's Edit.",
            "When they pick Men, show Men's Edit.",
            "When they pick Gifting and Under $60, show Small Gifts.",
            "When they pick Gifting and No budget, show Signature Gifts.",
            "When they pick New here, show Bestsellers.",
            "When they pick Just browsing, show New Arrivals.",
          ].map((s, i) => (
            <div key={i} className="qz-xpl-lrow">
              <span className="qz-ltab-rnum">{i + 1}</span>
              <span className="qz-xpl-lsent">{s}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Rules vs. Questions",
      body: <>Two ways to say the same kind of thing — pick per situation.</>,
      figure: (
        <div className="qz-xpl-cards">
          <div className="qz-xpl-card">
            <b>Rules</b>
            <span>
              Name products <i>in</i>. Best for hero sets, curated capsules and
              exceptions you can say out loud.
            </span>
          </div>
          <div className="qz-xpl-card">
            <b>Questions</b>
            <span>
              Rule products <i>out</i>. Your data does the work — tags,
              collections and fields narrow what survives.
            </span>
          </div>
        </div>
      ),
    },
  ];
}

function questionsSteps(): Step[] {
  return [
    {
      title: "One question, three parts",
      body: (
        <>
          A narrowing question is a matcher: the answer they pick, the field it
          is matched against, and what survives.
        </>
      ),
      figure: (
        <div className="qz-xpl-grid3">
          <div className="qz-xpl-grid3-head">The answer they pick</div>
          <div className="qz-xpl-grid3-head">Matched against</div>
          <div className="qz-xpl-grid3-head">What survives</div>
          <div><b>Women's</b></div>
          <div>metafield · custom.gender</div>
          <div>18 of 32</div>
        </div>
      ),
    },
    {
      title: "What each question narrows by",
      body: (
        <>
          Each switched-on question removes what doesn't match. The count only
          ever goes down — until your rules act on what's left.
        </>
      ),
      figure: (
        <div className="qz-xpl-ledger">
          {[
            ["Who is it for?", "custom.gender", "18"],
            ["How do they like it to fit?", "fit tags", "12"],
            ["What size?", "Size option", "9"],
            ["Which fabrics?", "fabric tags", "6"],
            ["What's the budget?", "price", "4"],
          ].map(([q, dim, n], i) => (
            <div key={i} className="qz-xpl-lrow">
              <span className="qz-xpl-lsent">
                {q} <span className="qz-ltab-join">· {dim}</span>
              </span>
              <span className="qz-xpl-ltag">→ {n}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "Questions vs. Rules",
      body: <>The same two cards, from the other side.</>,
      figure: (
        <div className="qz-xpl-cards">
          <div className="qz-xpl-card">
            <b>Questions</b>
            <span>
              Rule products <i>out</i>. Your data does the work — tags,
              collections and fields narrow what survives.
            </span>
          </div>
          <div className="qz-xpl-card">
            <b>Rules</b>
            <span>
              Name products <i>in</i>. Best for hero sets, curated capsules and
              exceptions you can say out loud.
            </span>
          </div>
        </div>
      ),
    },
    {
      title: "Both together",
      body: (
        <>
          Questions cut the catalogue down. Your rules then decide what to show
          out of what is left — and a <b>Show</b> rule replaces the starting
          set, so your Narrows still apply to it.
        </>
      ),
      figure: (
        <div className="qz-xpl-pipe">
          <span>Starting set</span>
          <span aria-hidden>→</span>
          <span>Questions narrow</span>
          <span aria-hidden>→</span>
          <span>Rules decide</span>
          <span aria-hidden>→</span>
          <b>Results</b>
        </div>
      ),
    },
  ];
}

export function ExplainerSheet({
  kind,
  open,
  onClose,
  onSwap,
}: {
  kind: ExplainerKind;
  open: boolean;
  onClose: () => void;
  /** The closing cross-link: swap to the other explainer, reset to step 1. */
  onSwap: (kind: ExplainerKind) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useFocusTrap(boxRef, open);

  // Document-level Esc — a scrim onKeyDown dies once focus lands on a
  // non-focusable region (review L2-4).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStep(0);
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  const steps = kind === "rules" ? rulesSteps() : questionsSteps();
  const cur = steps[step]!;
  const other: ExplainerKind = kind === "rules" ? "questions" : "rules";

  const close = () => {
    setStep(0);
    onClose();
  };

  return createPortal(
    <div
      className="qz-modal-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        ref={boxRef}
        className="qz-xpl"
        role="dialog"
        aria-modal="true"
        aria-label={kind === "rules" ? "How rules work" : "How questions work"}
      >
        <header className="qz-xpl-hd">
          <h2>{kind === "rules" ? "How rules work" : "How questions work"}</h2>
          <button type="button" className="qz-ltab-rbtn" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        {/* Clickable numbered progress; done steps get ✓. */}
        <div className="qz-xpl-progress">
          {steps.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`qz-xpl-dot${i === step ? " is-on" : ""}${i < step ? " is-done" : ""}`}
              aria-label={`Step ${i + 1}: ${s.title}`}
              onClick={() => setStep(i)}
            >
              {i < step ? "✓" : i + 1}
            </button>
          ))}
        </div>
        <div className="qz-xpl-body">
          <h3>{cur.title}</h3>
          <p>{cur.body}</p>
          {cur.figure}
          {step === steps.length - 1 ? (
            <button
              type="button"
              className="qz-xpl-cross"
              onClick={() => {
                setStep(0);
                onSwap(other);
              }}
            >
              {other === "rules" ? "How rules work →" : "How questions work →"}
            </button>
          ) : null}
        </div>
        <footer className="qz-xpl-ft">
          <span className="qz-ltab-soft">
            {step + 1} of {steps.length}
          </span>
          <span className="qz-xpl-ft-btns">
            <button
              type="button"
              className="qz-btn"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              Back
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              onClick={() => (step === steps.length - 1 ? close() : setStep((s) => s + 1))}
            >
              {step === steps.length - 1 ? "Done" : "Next"}
            </button>
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
