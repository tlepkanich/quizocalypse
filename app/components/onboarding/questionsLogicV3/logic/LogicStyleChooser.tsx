// ════════════════════════════════════════════════════════════════════════════
// Onboarding step 03 · module 01 — the Logic style chooser, rebuilt to the
// "Chooser Rebuild Handoff" (artifact c1368ca1) against the reference build
// (artifact 1e1ceaeb). First entry to Logic, once per quiz: the step title
// and three engine ROWS, one of them inert.
//
//   Rules only          → logic_style "rules"      (decider doc, no filter roles)
//   Attributes + Rules  → logic_style "attributes"
//   Point based         → NOTHING is written. The row renders and is clickable;
//                         the click fires a toast so the control never lies
//                         (handoff open decision 2).
//
// Each row is one <button> of spans: name + "Best when…" line | the mechanic
// diagram (trigger → outcome, arrows in one subgrid column) | the commit
// label. Nothing on the page interpolates catalog facts any more — the only
// decision is recommendEngine(), which picks the row that renders first and
// carries the wash, the badge and the solid button.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from "react";

import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import { buildAttributeReadout } from "../../../../lib/attributeClustering";
import { useQzToast } from "../../../qz-toast";

export type LogicStyle = "rules" | "attributes";
type Engine = LogicStyle | "points";
type Confidence = "strong" | "thin";

export interface ChooserScan {
  productCount: number;
  /** Attributes graded "splits well" (§10e "good"). */
  strongCount: number;
}

/** The chooser's scan over the catalog — the §10 attribute read-out
 *  (buildAttributeReadout). Pure + memoized by the caller. */
export function buildChooserScan(index: readonly IndexedProduct[]): ChooserScan {
  const readout = buildAttributeReadout(index);
  return { productCount: index.length, strongCount: readout.strongCount };
}

/** The only decision on the page (handoff §04). `engine` decides which row
 *  is first and which one gets the wash, the badge and the solid button;
 *  `confidence` decides which badge. It never disables anything — both live
 *  engines stay one click away in every state. An empty catalog needs no
 *  branch: strongCount is 0, so it lands on rules, the only engine that
 *  works without product data anyway. */
export function recommendEngine({ productCount, strongCount }: ChooserScan): {
  engine: LogicStyle;
  confidence: Confidence;
} {
  if (strongCount === 0) return { engine: "rules", confidence: "strong" };
  if (productCount < 25) return { engine: "rules", confidence: "strong" };
  if (strongCount === 1) return { engine: "attributes", confidence: "thin" };
  return { engine: "attributes", confidence: "strong" };
}

type TokKind = "q" | "v" | "r" | "op";
type Tok = [kind: TokKind, text: string];
interface Line {
  lhs: Tok[];
  rhs: Tok[];
}

// The three engines are fixed copy; only the order and the badge move.
const ENGINES: Record<Engine, { name: string; when: string; mech: Line[] }> = {
  attributes: {
    name: "Attributes + Rules",
    when: "Best when your catalog is already well tagged",
    mech: [
      { lhs: [["q", "Q1"]], rhs: [["v", "picks the starting set"]] },
      { lhs: [["q", "Q2, Q3"]], rhs: [["v", "narrow by tags & attributes"]] },
      { lhs: [["r", "λ rules"]], rhs: [["v", "handle the exceptions"]] },
    ],
  },
  rules: {
    name: "Rules only",
    when: "Best when you can list every outcome yourself",
    mech: [
      {
        lhs: [
          ["q", "Q1 = A"],
          ["op", "and"],
          ["q", "Q2 = B"],
        ],
        rhs: [["v", "show these products"]],
      },
      { lhs: [["q", "Q1 = C"]], rhs: [["v", "show those products"]] },
      { lhs: [["op", "nothing matches"]], rhs: [["v", "your fallback"]] },
    ],
  },
  points: {
    name: "Point based",
    when: "Best when answers overlap across several questions",
    mech: [
      {
        lhs: [["q", "Q1 = A"]],
        rhs: [
          ["r", "+2 Everyday"],
          ["r", "+1 Statement"],
        ],
      },
      { lhs: [["q", "Q2 = B"]], rhs: [["r", "+3 Statement"]] },
      { lhs: [["op", "highest total"]], rhs: [["v", "wins"]] },
    ],
  },
};

const ENGINE_ORDER: readonly Engine[] = ["attributes", "rules", "points"];

const TOK_CLASS: Record<TokKind, string> = {
  q: "qz-tok-q",
  v: "qz-tok-v",
  r: "qz-tok-r",
  op: "qz-lsc-op",
};

function Toks({ toks }: { toks: Tok[] }) {
  return (
    <>
      {toks.map(([kind, text], i) => (
        <span key={i} className={TOK_CLASS[kind]}>
          {text}
        </span>
      ))}
    </>
  );
}

function Mechanic({ lines }: { lines: Line[] }) {
  return (
    <span className="qz-lsc-mech">
      {lines.map((line, i) => (
        <span key={i} className="qz-lsc-ml">
          <span className="qz-lsc-lhs">
            <Toks toks={line.lhs} />
          </span>
          <span className="qz-lsc-arw" aria-hidden="true">
            →
          </span>
          <span className="qz-lsc-rhs">
            <Toks toks={line.rhs} />
          </span>
        </span>
      ))}
    </span>
  );
}

export function LogicStyleChooser({
  scan,
  onPick,
}: {
  scan: ChooserScan;
  onPick: (style: LogicStyle) => void;
}) {
  const toast = useQzToast();
  const rec = recommendEngine(scan);
  // Commit state: the click writes build_session.logic_style through the
  // set-logic-style intent while Step3Shell renders the workspace from its
  // local pick. Between those two the merchant could click a second engine,
  // so the row takes the click visibly and the other rows disable.
  const [busy, setBusy] = useState<LogicStyle | null>(null);

  const order: Engine[] = [rec.engine, ...ENGINE_ORDER.filter((e) => e !== rec.engine)];

  const pick = (engine: Engine) => {
    if (engine === "points") {
      toast("Point based isn't available yet.");
      return;
    }
    if (busy) return;
    setBusy(engine);
    onPick(engine);
  };

  return (
    <section className="qz-lsc" data-testid="logic-style-chooser">
      <h1 className="qz-h2">How should this quiz pick results?</h1>
      <div className="qz-lsc-engs">
        {order.map((engine) => {
          const e = ENGINES[engine];
          const isRec = engine === rec.engine;
          const isBusy = busy === engine;
          const className = [
            "qz-lsc-eng",
            isRec ? "is-rec" : "",
            isBusy ? "is-busy" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={engine}
              type="button"
              className={className}
              data-pick={engine}
              disabled={busy !== null && !isBusy}
              onClick={() => pick(engine)}
            >
              <span className="qz-lsc-head">
                {isRec ? (
                  <span className={`qz-lsc-badge${rec.confidence === "thin" ? " is-soft" : ""}`}>
                    {rec.confidence === "thin" ? "Probably right" : "Recommended"}
                  </span>
                ) : null}
                <span className="qz-lsc-nm">{e.name}</span>
                <span className="qz-lsc-q">{e.when}</span>
              </span>
              <Mechanic lines={e.mech} />
              <span className={`qz-lsc-go${isRec ? "" : " is-secondary"}`}>
                {isBusy ? (
                  <>
                    <span className="qz-lsc-spin" aria-hidden="true" />
                    Setting up…
                  </>
                ) : (
                  `Use ${e.name.toLowerCase()}`
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
