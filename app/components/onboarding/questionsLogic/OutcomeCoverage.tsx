import type { BuilderCategory } from "../../builder/stepProps";
import { bucketColor } from "./bucketPalette";
import { bucketCoverageTier } from "./questionOrder";

// Questions & Logic spec §2.3 — the Outcome Coverage row in the left panel. One
// pill per Step-1 bucket, 3-state (roadmap green/yellow/red): GREEN (its colour)
// when well-covered · YELLOW "weak" when mapped to fewer than half the top bucket's
// answers · RED orphaned when 0 answers map here. Read-only derived UI over the doc;
// the counts + tier come from the SAME points-based helpers the left amber dot + the
// Continue dialog use — those stay binary (count===0); only the pill gains "weak".
export function OutcomeCoverage({
  categories,
  counts,
}: {
  categories: BuilderCategory[];
  counts: Map<string, number>;
}) {
  if (categories.length === 0) return null;
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
              <span className="qz-ql-cov-dot" style={{ background: dotColor }} aria-hidden />
              {c.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
