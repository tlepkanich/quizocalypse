// ════════════════════════════════════════════════════════════════════════════
// Logic-step handoff §2 + mock module 01 — the style chooser. First entry to
// Logic, once per quiz: three cards, one of them inert.
//
//   Rules only          → logic_style "rules"      (decider doc, no filter roles)
//   Attributes + Rules  → logic_style "attributes" (recommended)
//   Point based         → NOTHING. The card renders and is clickable; clicking
//                         does nothing and stays on the page (§2 "inert" —
//                         the legacy points path is re-exposed later, not now).
//
// Both live styles are the SAME logic_model ("decider") — they differ only in
// whether any question carries role: "filter", so picking here never touches
// the doc's nodes; it only records the choice (set-logic-style intent).
// The mock's scan line ("N attributes that split them well") depends on the
// attribute read-out (module 16), which does not exist yet — until it does,
// the strip reports the product count alone.
// ════════════════════════════════════════════════════════════════════════════

export type LogicStyle = "rules" | "attributes";

export function LogicStyleChooser({
  productCount,
  onPick,
}: {
  productCount: number;
  onPick: (style: LogicStyle) => void;
}) {
  return (
    <section className="qz-lsc" data-testid="logic-style-chooser">
      <header className="qz-lsc-hd">
        <h2>How should this quiz decide?</h2>
        <p className="qz-lsc-scan">
          {productCount > 0
            ? `Your catalog: ${productCount} product${productCount === 1 ? "" : "s"} in scope.`
            : "Pick how answers turn into results — you can switch later without losing work."}
        </p>
      </header>
      <div className="qz-lsc-cards">
        <button type="button" className="qz-lsc-card" onClick={() => onPick("rules")}>
          <span className="qz-lsc-cardhead">
            <span className="qz-lsc-cardtitle">Rules only</span>
          </span>
          <span className="qz-lsc-sub">Typically smaller catalogs</span>
          <span className="qz-lsc-desc">You decide what each combination of answers shows.</span>
          <span className="qz-lsc-syn" aria-hidden>
            <span className="qz-lsc-synline">
              <span className="qz-lsc-chip">Q1 = answer</span>
              <span className="qz-lsc-op">and</span>
              <span className="qz-lsc-chip">Q2 = answer</span>
              <span className="qz-lsc-op">→</span>
              <span className="qz-lsc-chip is-cat">show result</span>
            </span>
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
          <span className="qz-lsc-desc">One question picks the starting set; others narrow it.</span>
          <span className="qz-lsc-syn" aria-hidden>
            <span className="qz-lsc-synline">
              <span className="qz-lsc-chip">Q1</span>
              <span className="qz-lsc-op">→</span>
              <span className="qz-lsc-chip is-cat">starting set</span>
            </span>
            <span className="qz-lsc-synline">
              <span className="qz-lsc-chip">Q2, Q3</span>
              <span className="qz-lsc-op">→</span>
              <span className="qz-lsc-chip is-cat">narrow by values</span>
            </span>
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
            <span className="qz-lsc-badge is-soon">Coming soon</span>
          </span>
          <span className="qz-lsc-sub">Personality &amp; archetype quizzes</span>
          <span className="qz-lsc-desc">Every answer adds points; the highest score wins.</span>
          <span className="qz-lsc-syn" aria-hidden>
            <span className="qz-lsc-synline">
              <span className="qz-lsc-chip">Q1 = answer</span>
              <span className="qz-lsc-op">→</span>
              <span className="qz-lsc-chip is-act">+3 result</span>
            </span>
          </span>
          <span className="qz-lsc-go">Use point based</span>
        </button>
      </div>
    </section>
  );
}
