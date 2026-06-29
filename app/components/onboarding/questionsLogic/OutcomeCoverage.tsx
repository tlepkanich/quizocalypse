import type { BuilderCategory } from "../../builder/stepProps";
import { bucketColor } from "./bucketPalette";

// Questions & Logic spec §2.3 — the Outcome Coverage row in the left panel. One
// pill per Step-1 bucket: green (its colour) when ≥1 answer maps to it, amber
// when orphaned (0 answers map here → shoppers may never see those products).
// Read-only derived UI over the doc — the counts come from the SAME points-based
// predicate the left amber dot + the Continue-dialog use.
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
          const orphaned = count === 0;
          const color = bucketColor(i);
          return (
            <span
              key={c.id}
              className={`qz-ql-cov-pill ${orphaned ? "is-orphan" : "is-covered"}`}
              style={
                orphaned
                  ? undefined
                  : { color: color.solid, background: color.bg, borderColor: color.mid }
              }
              title={
                orphaned
                  ? `${c.name}: no answers map here yet`
                  : `${c.name}: ${count} answer${count === 1 ? "" : "s"} mapped`
              }
            >
              <span
                className="qz-ql-cov-dot"
                style={{ background: orphaned ? "var(--ql-warn)" : color.solid }}
                aria-hidden
              />
              {c.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
