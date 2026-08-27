// ════════════════════════════════════════════════════════════════════════════
// Logic-step handoff §2 + the artifact's Live pane (screen A) — the style
// chooser, mock-exact. First entry to Logic, once per quiz: h1, the scan
// line, three cards, one of them inert.
//
//   Rules only          → logic_style "rules"      (decider doc, no filter roles)
//   Attributes + Rules  → logic_style "attributes" (recommended; ch-why line)
//   Point based         → NOTHING. The card renders and is clickable; clicking
//                         does nothing and stays on the page (§2 "inert").
//
// Live-exact details: the worked example sits behind a "Show more" details
// (three open at once made the cards hard to compare); each card carries a
// "Best for" line; the recommended card cites the scan ("Your N products
// carry N attributes that split them cleanly"). The scan line and ch-why
// read from the §10 attribute read-out when the caller supplies it.
// ════════════════════════════════════════════════════════════════════════════

import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import { buildAttributeReadout } from "../../../../lib/attributeClustering";

export type LogicStyle = "rules" | "attributes";

export interface ChooserScan {
  productCount: number;
  /** Attributes graded "splits well" (§10e "good"). */
  strongCount: number;
  /** Top three splitting attribute names, grade order. */
  strongNames: string[];
}

/** The chooser's scan over the catalog — the §10 attribute read-out
 *  (buildAttributeReadout) behind the Live scan line and the rec card's
 *  ch-why. Pure + memoized by the caller. */
export function buildChooserScan(index: readonly IndexedProduct[]): ChooserScan {
  const readout = buildAttributeReadout(index);
  return {
    productCount: index.length,
    strongCount: readout.strongCount,
    strongNames: readout.strongNames,
  };
}

function SynLine({ parts }: { parts: Array<[cls: string, text: string]> }) {
  return (
    <span className="qz-lsc-synline">
      {parts.map(([cls, text], i) => (
        <span key={i} className={cls}>
          {text}
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
  const { productCount, strongCount, strongNames } = scan;
  return (
    <section className="qz-lsc" data-testid="logic-style-chooser">
      <h1 className="qz-lsc-h1">How should this quiz pick results?</h1>
      {/* Live .scanline — one fact, never capped to a measure. */}
      <p className="qz-lsc-scanline">
        <span className="qz-lsc-dotk" aria-hidden />
        We scanned your catalog: <b>{productCount}</b>{" "}
        {productCount === 1 ? "product" : "products"}
        {strongCount > 0 ? (
          <>
            , <b>{strongCount}</b> attribute{strongCount === 1 ? "" : "s"} that split
            them well{strongNames.length ? <> — {strongNames.join(", ")}</> : null}.
          </>
        ) : (
          <>.</>
        )}
      </p>
      <div className="qz-lsc-cards">
        <button type="button" className="qz-lsc-card" onClick={() => onPick("rules")}>
          <span className="qz-lsc-cardhead">
            <span className="qz-lsc-cardtitle">Rules only</span>
          </span>
          <span className="qz-lsc-sub">Typically smaller catalogs</span>
          <span className="qz-lsc-desc">
            You decide what each combination of answers shows. Nothing is read from
            your product data.
          </span>
          <details className="qz-lsc-more" onClick={(e) => e.stopPropagation()}>
            <summary>Show more</summary>
            <span className="qz-lsc-syn">
              <SynLine
                parts={[
                  ["qz-lsc-synq", "Q1 = A"],
                  ["qz-lsc-op", "and"],
                  ["qz-lsc-synq", "Q2 = B"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synv", "show these products"],
                ]}
              />
              <SynLine
                parts={[
                  ["qz-lsc-synq", "Q1 = C"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synv", "show those products"],
                ]}
              />
              <span className="qz-lsc-synnote">
                You write every outcome. Nothing is read from your catalog.
              </span>
            </span>
          </details>
          <span className="qz-lsc-best">
            <b>Best for</b> under ~25 products, or a catalog without useful tags.
          </span>
          <span className="qz-lsc-go">Use rules only</span>
        </button>

        <button
          type="button"
          className="qz-lsc-card is-rec"
          onClick={() => onPick("attributes")}
        >
          <span className="qz-lsc-cardhead">
            <span className="qz-lsc-cardtitle">Attributes + Rules</span>
            <span className="qz-lsc-badge">Recommended</span>
          </span>
          <span className="qz-lsc-sub">Typically bigger catalogs</span>
          {strongCount > 0 ? (
            <span className="qz-lsc-why">
              Your {productCount} products carry {strongCount} attribute
              {strongCount === 1 ? "" : "s"} that split them cleanly.
            </span>
          ) : null}
          <span className="qz-lsc-desc">
            One question maps to your catalog and picks the starting set. Other
            questions narrow it using tags and attributes. Rules cover the
            exceptions.
          </span>
          <details className="qz-lsc-more" onClick={(e) => e.stopPropagation()}>
            <summary>Show more</summary>
            <span className="qz-lsc-syn">
              <SynLine
                parts={[
                  ["qz-lsc-synq", "Q1"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synv", "picks the starting set"],
                ]}
              />
              <SynLine
                parts={[
                  ["qz-lsc-synq", "Q2, Q3"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synv", "narrow by tags & attributes"],
                ]}
              />
              <SynLine
                parts={[
                  ["qz-lsc-synr", "λ rules"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synv", "handle the exceptions"],
                ]}
              />
              <span className="qz-lsc-synnote">
                Add products later and they are covered without touching the quiz.
              </span>
            </span>
          </details>
          <span className="qz-lsc-best">
            <b>Best for</b> ~25+ products that differ in ways you have already
            recorded.
          </span>
          <span className="qz-lsc-go">Use attributes + rules</span>
        </button>

        {/* §2 — inert on purpose: renders, is clickable, does nothing. */}
        <button
          type="button"
          className="qz-lsc-card is-soon"
          aria-disabled="true"
          title="Point based logic is coming later."
        >
          <span className="qz-lsc-cardhead">
            <span className="qz-lsc-cardtitle">Point based</span>
          </span>
          <span className="qz-lsc-sub">Personality &amp; archetype quizzes</span>
          <span className="qz-lsc-desc">
            Every answer adds points to one or more results. The highest score wins,
            so no single answer decides the outcome on its own.
          </span>
          <details className="qz-lsc-more" onClick={(e) => e.stopPropagation()}>
            <summary>Show more</summary>
            <span className="qz-lsc-syn">
              <SynLine
                parts={[
                  ["qz-lsc-synq", "Q1 = A"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synr", "+2 Everyday"],
                  ["qz-lsc-synr", "+1 Statement"],
                ]}
              />
              <SynLine
                parts={[
                  ["qz-lsc-synq", "Q2 = B"],
                  ["qz-lsc-op", "→"],
                  ["qz-lsc-synr", "+3 Statement"],
                ]}
              />
              <span className="qz-lsc-synnote">
                Highest total wins, so no single answer decides the outcome.
              </span>
            </span>
          </details>
          <span className="qz-lsc-best">
            <b>Best for</b> personality quizzes, archetypes, and &ldquo;which one
            are you&rdquo; formats.
          </span>
          <span className="qz-lsc-go">Use point based</span>
        </button>
      </div>
    </section>
  );
}
