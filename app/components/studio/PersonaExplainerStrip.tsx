import type { CSSProperties } from "react";
import { ChevronRight, Package, User } from "lucide-react";

/**
 * Persona Explainer Strip — a 3-step animated explainer that replaces the
 * "Personas & Groups" page title. It autoplays once on mount (~9s) and settles
 * into a gentle chip idle-pulse.
 *
 * The whole timeline is pure CSS (see `.qz-pexplain` in quizocalypse.css) — no
 * JS timers — so it survives re-renders, unmounts cleanly, and fires once per
 * mount. Reduced-motion callers get the final rested state with no motion.
 *
 * A11y: the strip is decorative — the animated viz + number chips are
 * aria-hidden and the three step <h3>s carry the meaning, with a
 * visually-hidden <h1> preserving the page title. Locked step copy per spec
 * (docs handoff: personaexplainerstripspec.md) — do not reword.
 */

// CSS custom-property style helper (keeps the raw values in CSS, not the TSX).
const vars = (v: Record<string, string | number>) => v as CSSProperties;

export function PersonaExplainerStrip() {
  return (
    <section className="qz-pexplain" aria-labelledby="qz-pexplain-title">
      <h1 id="qz-pexplain-title" className="qz-sr-only">
        Personas &amp; Groups
      </h1>

      <div className="qz-pex-row">
        {/* Step 1 — many products merge into one bundle */}
        <article className="qz-pex-card" data-step="1">
          <span className="qz-pex-chip" aria-hidden>1</span>
          <div className="qz-pex-viz qz-pex-viz-1" aria-hidden>
            <span className="qz-pex-fly" style={vars({ "--fx": "-62px", "--fy": "-28px" })} />
            <span className="qz-pex-fly" style={vars({ "--fx": "62px", "--fy": "-28px" })} />
            <span className="qz-pex-fly" style={vars({ "--fx": "-62px", "--fy": "28px" })} />
            <span className="qz-pex-fly" style={vars({ "--fx": "62px", "--fy": "28px" })} />
            <span className="qz-pex-icon">
              <Package size={20} aria-hidden />
            </span>
          </div>
          <h3 className="qz-pex-title">Bundle your products</h3>
          <p className="qz-pex-desc">Group items that belong together.</p>
        </article>

        <span className="qz-pex-chev" data-chev="1" aria-hidden>
          <ChevronRight size={20} />
        </span>

        {/* Step 2 — a bundle becomes a named persona */}
        <article className="qz-pex-card" data-step="2">
          <span className="qz-pex-chip" aria-hidden>2</span>
          <div className="qz-pex-viz qz-pex-viz-2" aria-hidden>
            <span className="qz-pex-icon">
              <Package size={20} aria-hidden />
            </span>
            <span className="qz-pex-pill qz-pex-pill-2">Quiz Lover</span>
          </div>
          <h3 className="qz-pex-title">Give it a personality</h3>
          <p className="qz-pex-desc">Turn a group into a shopper persona.</p>
        </article>

        <span className="qz-pex-chev" data-chev="2" aria-hidden>
          <ChevronRight size={20} />
        </span>

        {/* Step 3 — the persona is matched out to shoppers */}
        <article className="qz-pex-card" data-step="3">
          <span className="qz-pex-chip" aria-hidden>3</span>
          <div className="qz-pex-viz qz-pex-viz-3" aria-hidden>
            <span className="qz-pex-icon">
              <Package size={20} aria-hidden />
            </span>
            <span className="qz-pex-fan">
              <span className="qz-pex-line" />
              <span className="qz-pex-line" />
              <span className="qz-pex-line" />
            </span>
            <span className="qz-pex-avatars">
              <span className="qz-pex-av">
                <User size={13} aria-hidden />
              </span>
              <span className="qz-pex-av">
                <User size={13} aria-hidden />
              </span>
              <span className="qz-pex-av">
                <User size={13} aria-hidden />
              </span>
            </span>
            <span className="qz-pex-pill qz-pex-pill-3">Quiz Lover</span>
          </div>
          <h3 className="qz-pex-title">Match it to shoppers</h3>
          <p className="qz-pex-desc">Serve the right persona in your quiz.</p>
        </article>
      </div>
    </section>
  );
}
