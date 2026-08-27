import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useFocusTrap } from "../../qz-overlays";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab — the two stepped explainer sheets, ported from the UNIFIED mock
// (docs/design/logic-tab/unified/_x.js — byte-identical to rules-tab/_x.js).
// Static content, no engine dependency. Four steps each, a clickable titled
// progress rail (done steps get ✓ + a green connector), N of 4 · Back ·
// Next/Done footer, and a cross-link on each closing split-card that swaps
// the sheet and resets to step 1.
//
// Copy corrections (DECISIONS.md, engine-is-right — the mock copy must NOT
// ship where it disagrees):
// - "Top rule wins" teaches strict first-match-wins (at most ONE rule applies
//   — never "excludes and pins always apply"); the figure's rule 3 is
//   therefore "skipped", not the mock's "also applies".
// - Logic-step handoff §4 (supersedes the earlier Show/Highlight/Exclude
//   set): the verbs are Show (these become the results), Pin (move to the
//   top) and Hide (never show). The legacy replace rule is not taught — new
//   UI never writes it.
// - "Both together" teaches that questions narrow first and the winning
//   rule then edits what is left (§3 operators: or within a question,
//   one and ⇄ or between questions).
// ════════════════════════════════════════════════════════════════════════════

export type ExplainerKind = "rules" | "questions";

interface Step {
  title: string;
  body: ReactNode | null;
  figure: ReactNode;
}

// ── the little in/out diagram on both closing cards (mock inOutSVG) ─────────
function InOutSvg({ dir }: { dir: "in" | "out" }) {
  const isIn = dir === "in";
  const col = isIn ? "var(--qz-ok)" : "var(--qz-crit)";
  const markerId = `qz-xpl-m-${dir}`;
  return (
    <svg viewBox="0 0 170 46" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="5.5"
          markerHeight="5.5"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 z" fill={col} />
        </marker>
      </defs>
      <rect x="1" y="4" width="106" height="38" rx="11" fill="none" stroke="var(--qz-rule)" strokeWidth="1.4" />
      {[16, 38, 60].map((x) => (
        <rect key={x} x={x} y="14" width="17" height="17" rx="5.5" fill="var(--qz-rule)" />
      ))}
      {isIn ? (
        <>
          <rect x="82" y="14" width="17" height="17" rx="5.5" fill="var(--qz-ok)" />
          <line x1="166" y1="23" x2="112" y2="23" stroke={col} strokeWidth="1.8" markerEnd={`url(#${markerId})`} />
        </>
      ) : (
        <>
          <rect
            x="82"
            y="14"
            width="17"
            height="17"
            rx="5.5"
            fill="none"
            stroke="var(--qz-ink-25)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line x1="116" y1="23" x2="166" y2="23" stroke={col} strokeWidth="1.8" markerEnd={`url(#${markerId})`} />
        </>
      )}
    </svg>
  );
}

// The two comparison cards (mock .sc r / .sc q). `crossTo` renders the mock's
// in-card cross-link on the card naming the OTHER sheet.
function SplitCards({
  order,
  onCross,
}: {
  order: ExplainerKind; // which sheet is showing (its own card leads)
  onCross: (kind: ExplainerKind) => void;
}) {
  const rules = (withLink: boolean) => (
    <div className="qz-xpl-sc is-r">
      <InOutSvg dir="in" />
      <div className="qz-xpl-k2">Rules</div>
      <h5>Name products in</h5>
      <p>You choose them, by name. Best for hero sets and exceptions.</p>
      {withLink ? (
        <button type="button" className="qz-xpl-cross" onClick={() => onCross("rules")}>
          How rules work →
        </button>
      ) : null}
    </div>
  );
  const questions = (withLink: boolean) => (
    <div className="qz-xpl-sc is-q">
      <InOutSvg dir="out" />
      <div className="qz-xpl-k2">Questions</div>
      <h5>Rule products out</h5>
      <p>
        Your data does the work. Start with a bigger set of products, then narrow with tags,
        metafields and the rest.
      </p>
      {withLink ? (
        <button type="button" className="qz-xpl-cross" onClick={() => onCross("questions")}>
          How questions work →
        </button>
      ) : null}
    </div>
  );
  return (
    <div className="qz-xpl-split">
      {order === "rules" ? (
        <>
          {rules(false)}
          {questions(true)}
        </>
      ) : (
        <>
          {questions(false)}
          {rules(true)}
        </>
      )}
    </div>
  );
}

// One cell of the three-part path figure (mock chunk()).
function Chunk({
  variant,
  ty,
  children,
}: {
  variant?: "show" | "inc" | "exc";
  ty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`qz-xpl-chunk${variant ? ` v-${variant}` : ""}`}>
      {ty ? <i className="qz-xpl-ty">{ty}</i> : null}
      {children}
    </span>
  );
}

const J = ({ children }: { children: ReactNode }) => (
  <span className="qz-xpl-j">{children}</span>
);

// The verb pills of the ledger figures — logic-step §4 vocabulary: Show /
// Pin / Hide (the keys keep their historical names so the row markup and
// CSS classes stand). QRTZ-OB1: "nar" reads "Narrows" (the mock's ex-badge,
// shared.mjs line 1031). "set" KEEPS "Starting set" — here it names the
// POOL the questions narrow from (the mock's own is-start badge, shared.mjs
// ~1032), not a question role; the role is "Picks the result" (ROLE_JOBS).
const VERB_PILL: Record<string, { cls: string; label: string }> = {
  show: { cls: "v-show", label: "Show" },
  inc: { cls: "v-inc", label: "Pin" },
  exc: { cls: "v-exc", label: "Hide" },
  nar: { cls: "v-nar", label: "Narrows" },
  ask: { cls: "v-ask", label: "Asked only" },
  set: { cls: "v-set", label: "Starting set" },
};

function LedgerRow({
  n,
  when,
  verb,
  ty,
  target,
  math,
  rowClass,
  withMath,
}: {
  n: ReactNode;
  when: ReactNode;
  verb: keyof typeof VERB_PILL;
  ty?: string;
  target: ReactNode;
  math?: ReactNode;
  rowClass?: string;
  withMath?: boolean;
}) {
  const v = VERB_PILL[verb]!;
  return (
    <div className={`qz-xpl-qb${withMath ? " has-math" : ""}${rowClass ? ` ${rowClass}` : ""}`}>
      <span className="qz-xpl-qn">{n}</span>
      <span className="qz-xpl-qwhen">{when}</span>
      <span className={`qz-xpl-vp ${v.cls}`}>{v.label}</span>
      <span className="qz-xpl-tg">
        {ty ? <i>{ty}: </i> : null}
        {target}
      </span>
      {withMath ? <span className="qz-xpl-mth">{math}</span> : null}
    </div>
  );
}

const Drop = ({ n, left }: { n: number; left: number }) => (
  <>
    <em>−{n}</em> · <b>{left}</b>
  </>
);

// One stage of the top-to-bottom flow figure (mock node()).
function FlowNode({
  label,
  variant,
  src,
  value,
  sub,
}: {
  label: string;
  variant?: "start" | "end";
  src?: string;
  value: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div className={`qz-xpl-fcol${variant ? ` is-${variant}` : ""}`}>
      <span className="qz-xpl-flab">{label}</span>
      <span className={`qz-xpl-node${variant ? ` is-${variant}` : ""}`}>
        {src ? <span className="qz-xpl-nsrc">{src}</span> : null}
        {value}
        <span className="qz-xpl-nsub">{sub}</span>
      </span>
    </div>
  );
}

const FlowArrow = () => (
  <div className="qz-xpl-farw" aria-hidden>
    ↓
  </div>
);

function rulesSteps(onCross: (kind: ExplainerKind) => void): Step[] {
  return [
    {
      title: "One sentence, three parts",
      // Logic-step §3 — the operator story in one line: or within a
      // question, one and ⇄ or between questions, no brackets anywhere.
      body: (
        <>
          Between answers of one question, <b>or</b> means any of them
          (multi‑selects can ask for <b>all of</b>). Between questions the
          rule keeps ONE join — <b>and</b> or <b>or</b> — so it reads exactly
          as it runs.
        </>
      ),
      figure: (
        <div className="qz-xpl-fig">
          <div className="qz-xpl-paths">
            <div className="qz-xpl-plab">When they answer</div>
            <div />
            <div className="qz-xpl-plab">Do this</div>
            <div />
            <div className="qz-xpl-plab">To these</div>

            <Chunk>
              Oily <J>and</J> Sensitive
            </Chunk>
            <span className="qz-xpl-sarw" aria-hidden>→</span>
            <Chunk variant="show">Show</Chunk>
            <span className="qz-xpl-sarw" aria-hidden>→</span>
            <Chunk ty="tag">quiz-gentle</Chunk>

            <Chunk>
              Polos <J>or</J> Beachwear <J>and</J> Slim Fit
            </Chunk>
            <span className="qz-xpl-sarw" aria-hidden>→</span>
            <Chunk variant="exc">Hide</Chunk>
            <span className="qz-xpl-sarw" aria-hidden>→</span>
            <Chunk ty="collection">Plus Size Streetwear</Chunk>

            <Chunk>
              Lemon Flavor <J>and</J> Hydration <J>and</J> Powder
            </Chunk>
            <span className="qz-xpl-sarw" aria-hidden>→</span>
            <Chunk variant="inc">Pin</Chunk>
            <span className="qz-xpl-sarw" aria-hidden>→</span>
            <Chunk ty="product">
              IV Hydration
              <i className="qz-xpl-ty is-mt">collection</i>
              Tropical Variation Pack
            </Chunk>
          </div>
        </div>
      ),
    },
    {
      title: "Top rule wins",
      // DECISIONS copy correction 1 — strict first-match-wins, never the
      // mock's "excludes and pins always apply".
      body: (
        <>
          Checked top down. The first rule that matches applies — the rest are
          skipped. Move a rule higher to give it the final word.
        </>
      ),
      figure: (
        <div className="qz-xpl-ledger">
          {[
            ["1", <>Low energy <b>and</b> Vegan → show <b>supp-iron-vegan</b></>, "wins", "is-lit"],
            ["2", <>Low energy → show <b>supp-b12</b></>, "skipped", "is-dim"],
            // Mock says "also applies" — engine-corrected: one rule per shopper.
            ["3", <>Pregnant → hide <b>supp-herbal</b></>, "skipped", "is-dim"],
            ["4", <>Athlete → show <b>supp-electrolyte</b></>, "skipped", "is-dim"],
            ["5", <>Sleep support → show <b>supp-magnesium</b></>, "skipped", "is-dim"],
          ].map(([n, s, tag, cls]) => (
            <div key={n as string} className={`qz-xpl-lrow ${cls as string}`}>
              <span className="qz-ltab-rnum">{n}</span>
              <span className="qz-xpl-lsent">{s}</span>
              <span className={`qz-xpl-ltag${tag === "wins" ? " is-ok" : ""}`}>{tag}</span>
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
        <div className="qz-xpl-qlist">
          <LedgerRow n="1" when={<>Petite <b>and</b> Slim fit</>} verb="show" ty="tag" target="fit-petite-slim" />
          <LedgerRow
            n="2"
            when={<>Women&rsquo;s <b>and</b> Slim fit <b>and</b> Petite <b>and</b> Under $80</>}
            verb="show"
            ty="products"
            target="Field Trouser · Weekend Jean · Easy Chino"
          />
          <LedgerRow
            n="3"
            when={<>Wide leg <b>or</b> Relaxed <b>or</b> Straight <b>and</b> Tall</>}
            verb="show"
            ty="tag"
            target="fit-roomy"
          />
          <LedgerRow n="4" when="Sensitive skin" verb="exc" ty="tag" target="fabric-wool" />
          <LedgerRow n="5" when="Vegan" verb="exc" ty="products" target="Shearling Coat · Leather Belt" />
          <LedgerRow n="6" when="First order" verb="inc" ty="product" target="Starter Tee" />
        </div>
      ),
    },
    {
      title: "Rules vs. Questions",
      body: null,
      figure: <SplitCards order="rules" onCross={onCross} />,
    },
  ];
}

function questionsSteps(onCross: (kind: ExplainerKind) => void): Step[] {
  return [
    {
      title: "One question, three parts",
      body: (
        <>
          A question that narrows does one thing: it matches the answer against
          a piece of your product data and keeps only what matches.
        </>
      ),
      figure: (
        <div className="qz-xpl-flow">
          <FlowNode
            label="The answer they pick"
            variant="start"
            value={<>Women&rsquo;s</>}
            sub={<>one answer on &ldquo;Who is it for?&rdquo;</>}
          />
          <FlowArrow />
          <FlowNode
            label="Matched against"
            src="metafield"
            value="custom.gender"
            sub="a metafield your products already carry"
          />
          <FlowArrow />
          <FlowNode
            label="What survives"
            variant="end"
            value="18 of 32"
            sub="the other 14 are gone for this shopper"
          />
        </div>
      ),
    },
    {
      title: "What each question narrows on",
      body: (
        <>
          One shopper answering down the list. Every switched-on question is
          wired to one piece of your product data, and the count on the right
          is what is left after it has had its turn.
        </>
      ),
      figure: (
        <>
          <div className="qz-xpl-qlist">
            <LedgerRow
              n="✦"
              when="Electrolyte Range"
              verb="set"
              ty="collection"
              target="18 products"
              rowClass="is-startrow"
              withMath
              math={<b>18</b>}
            />
            <LedgerRow
              n="1"
              when="What are you using it for?"
              verb="nar"
              ty="metafield"
              target="custom.use_case"
              withMath
              math={<Drop n={6} left={12} />}
            />
            <LedgerRow
              n="2"
              when="Any flavours to avoid?"
              verb="nar"
              ty="tag"
              target="flavor:*"
              withMath
              math={<Drop n={3} left={9} />}
            />
            <LedgerRow
              n="3"
              when="Powder or ready-to-drink?"
              verb="nar"
              ty="variant option"
              target="Format"
              withMath
              math={<Drop n={3} left={6} />}
            />
            <LedgerRow
              n="4"
              when="Caffeine or caffeine-free?"
              verb="nar"
              ty="metafield"
              target="custom.caffeine"
              withMath
              math={<Drop n={2} left={4} />}
            />
            <LedgerRow
              n="5"
              when="How did you hear about us?"
              verb="ask"
              target="collects the answer, changes nothing"
              withMath
              math={<b>4</b>}
            />
          </div>
          <div className="qz-xpl-tot">
            This shopper reaches the results with <b>4 products</b> — and that
            is what your rules then work with.
          </div>
        </>
      ),
    },
    {
      title: "Questions vs. Rules",
      body: null,
      figure: <SplitCards order="questions" onCross={onCross} />,
    },
    {
      title: "Both together",
      // Logic-step §4 — questions narrow first; the ONE winning rule then
      // edits what is left: Show forces its products in, Pin moves them to
      // the top, Hide takes them out.
      body: (
        <>
          Questions cut the catalogue down. The first rule that matches then
          edits what is left — <b>Show</b> forces its products in, <b>Pin</b>{" "}
          moves them to the top, <b>Hide</b> takes them out.
        </>
      ),
      figure: (
        <div className="qz-xpl-flow">
          <FlowNode
            label="Starting set"
            variant="start"
            src="collection"
            value="Summer Skincare"
            sub="24 products"
          />
          <FlowArrow />
          <FlowNode
            label="Questions narrow"
            src="metafield · custom.skin_type + tag · concern-*"
            value="Oily · Sensitive"
            sub={
              <>
                <em>−15</em> · 9 left
              </>
            }
          />
          <FlowArrow />
          <FlowNode
            label="Rules edit"
            src="rule 1"
            value="Hide fragranced"
            sub={
              <>
                <em>−2</em> of those 9
              </>
            }
          />
          <FlowArrow />
          <FlowNode label="Results" variant="end" value="7 products" sub="what this shopper sees" />
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

  const swap = (next: ExplainerKind) => {
    setStep(0);
    onSwap(next);
  };
  const steps = kind === "rules" ? rulesSteps(swap) : questionsSteps(swap);
  const cur = steps[step]!;

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
          <span className="qz-xpl-badge">✦ Explainer</span>
          <h2>{kind === "rules" ? "How rules work" : "How questions work"}</h2>
          <button type="button" className="qz-ltab-rbtn" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        {/* The titled progress rail (mock progBar): every step is a named,
            clickable pill; done steps get ✓ and a green connector. */}
        <div className="qz-xpl-progress">
          {steps.map((s, i) => (
            <span key={s.title} className="qz-xpl-seg">
              {i > 0 ? (
                <span className={`qz-xpl-conn${i <= step ? " is-done" : ""}`} aria-hidden />
              ) : null}
              <button
                type="button"
                className={`qz-xpl-pstep${i === step ? " is-on" : ""}${i < step ? " is-done" : ""}`}
                aria-label={`Step ${i + 1}: ${s.title}`}
                onClick={() => setStep(i)}
              >
                <span
                  className={`qz-xpl-dot${i === step ? " is-on" : ""}${i < step ? " is-done" : ""}`}
                  aria-hidden
                >
                  {i < step ? "✓" : i + 1}
                </span>
                <span className="qz-xpl-ptitle">{s.title}</span>
              </button>
            </span>
          ))}
        </div>
        <div className="qz-xpl-body">
          {/* The rules sheet's lede rides with step 1 (mock: lede on xI===0). */}
          {kind === "rules" && step === 0 ? (
            <p className="qz-xpl-lede">
              A rule is one sentence:{" "}
              <b>when they answer this, do that to these products.</b>
            </p>
          ) : null}
          <h3>{cur.title}</h3>
          {cur.body ? <p>{cur.body}</p> : null}
          {cur.figure}
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
