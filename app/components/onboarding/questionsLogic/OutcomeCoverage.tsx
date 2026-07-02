import type { BuilderCategory } from "../../builder/stepProps";
import { bucketColor } from "./bucketPalette";
import { bucketCoverageTier } from "./questionOrder";

// Questions & Logic spec §2.3 — the Outcome Coverage row in the left panel. One
// pill per Step-1 bucket, 3-state (roadmap green/yellow/red): GREEN (its colour)
// when well-covered · YELLOW "weak" when mapped to fewer than half the top bucket's
// answers · RED orphaned when 0 answers map here. Read-only derived UI over the doc;
// the counts + tier come from the SAME points-based helpers the left amber dot + the
// Continue dialog use — those stay binary (count===0); only the pill gains "weak".
//
// LOGIC v2 (`deciderMode`): counts = deciding answers + rules pointing at the
// target, and the §5 RE-SCOPE applies — an UNUSED target is FINE (neutral grey,
// never red; it may be rule-only later or deliberately unpicked). The blocking
// state in v2 is an unmapped DECIDER ANSWER, which lives on the question list +
// the Continue guard, not here.
export function OutcomeCoverage({
  categories,
  counts,
  deciderMode = false,
}: {
  categories: BuilderCategory[];
  counts: Map<string, number>;
  deciderMode?: boolean;
}) {
  if (categories.length === 0) return null;
  if (deciderMode) {
    return (
      <div className="qz-ql-coverage">
        <div className="qz-ql-label">Result coverage</div>
        <div className="qz-ql-coverage-pills">
          {categories.map((c, i) => {
            const count = counts.get(c.id) ?? 0;
            const used = count > 0;
            const color = bucketColor(i);
            return (
              <span
                key={c.id}
                className={`qz-ql-cov-pill ${used ? "is-covered" : "is-unused"}`}
                style={
                  used
                    ? { color: color.solid, background: color.bg, borderColor: color.mid }
                    : undefined
                }
                title={
                  used
                    ? `${c.name}: ${count} ${count === 1 ? "mapping points" : "mappings point"} here (deciding answers + rules)`
                    : `${c.name}: nothing points here yet — fine if that's intentional`
                }
              >
                <span className="qz-ql-cov-dot" style={{ color: used ? color.solid : "var(--ql-txt3)" }} aria-hidden>
                  {used ? "●" : "○"}
                </span>
                {c.name}
                <span className="qz-sr-only"> — {used ? "covered" : "unused"}</span>
              </span>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="qz-ql-coverage">
      <div className="qz-ql-label">Outcome coverage</div>
      <div className="qz-ql-coverage-pills">
        {categories.map((c, i) => {
          const count = counts.get(c.id) ?? 0;
          const tier = bucketCoverageTier(counts, c.id);
          const color = bucketColor(i);
          const cls =
            tier === "orphan" ? "is-orphan" : tier === "weak" ? "is-weak" : "is-covered";
          const dotColor =
            tier === "orphan" ? "var(--ql-danger)" : tier === "weak" ? "var(--ql-warn)" : color.solid;
          // WCAG 1.4.1 — the tier must read without relying on colour. A shape-distinct
          // glyph (orphan ! · weak ◐ · strong ●) carries the tier visually; a
          // visually-hidden word carries it to screen readers.
          const glyph = tier === "orphan" ? "!" : tier === "weak" ? "◐" : "●";
          const tierWord =
            tier === "orphan" ? "no coverage" : tier === "weak" ? "weak coverage" : "covered";
          const title =
            tier === "orphan"
              ? `${c.name}: no answers map here yet`
              : tier === "weak"
                ? `${c.name}: only ${count} answer${count === 1 ? "" : "s"} mapped — fewer than half the top bucket`
                : `${c.name}: ${count} answer${count === 1 ? "" : "s"} mapped`;
          return (
            <span
              key={c.id}
              className={`qz-ql-cov-pill ${cls}`}
              style={
                tier === "strong"
                  ? { color: color.solid, background: color.bg, borderColor: color.mid }
                  : undefined
              }
              title={title}
            >
              <span className="qz-ql-cov-dot" style={{ color: dotColor }} aria-hidden>
                {glyph}
              </span>
              {c.name}
              <span className="qz-sr-only"> — {tierWord}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
