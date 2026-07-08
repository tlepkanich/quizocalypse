import { useMemo, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import type { BuilderCategory } from "../builder/stepProps";
import {
  enumeratePaths,
  groupPathsByResult,
  type EnumeratedPath,
} from "../../lib/pathEnumeration";

// ════════════════════════════════════════════════════════════════════════════
// QZY-R8 (LV3) — the Logic view's "Paths" tab. A LIVE projection of the R1
// path engine: one horizontal lane per distinct shopper path, grouped by
// result. Read-only in R8-1 (structure + status); the step-chip jump-to-Map +
// result-chip override-writes-a-rule land in R8-2 / R9 (both reuse this same
// enumeratePaths dataset, so any Map/Table edit redraws these lanes with no
// refresh — the single-source-of-truth acceptance).
//
// "A lane never renders a skipped question" is guaranteed by construction: the
// engine only emits steps for questions the runtime router actually visits.
// ════════════════════════════════════════════════════════════════════════════

const GROUP_PREVIEW = 3; // spec §6 — collapse a group to 3 lanes + "show N more".

export function LogicPathsTab({
  doc,
  questions,
  deciderId,
  categories,
  onSelectNode,
}: {
  doc: Quiz;
  /** Ordered questions — we read `node.id` + the canonical `qIndex` (matches
   *  the Map's Q# numbering) for each step chip. */
  questions: ReadonlyArray<{ node: { id: string }; qIndex: number }>;
  deciderId: string | null;
  categories: BuilderCategory[];
  onSelectNode: (nodeId: string | null) => void;
}) {
  const { paths, truncated, count } = useMemo(() => enumeratePaths(doc), [doc]);
  const groups = useMemo(() => groupPathsByResult(paths), [paths]);

  // Q# ordinal by question id (the canonical qIndex — matches the Map).
  const ordinalById = useMemo(() => {
    const m = new Map<string, number>();
    questions.forEach((q) => m.set(q.node.id, q.qIndex));
    return m;
  }, [questions]);
  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  // Result-node headline fallback: when a target category can't be resolved to
  // a name (e.g. a shop without a synced catalog), the result node's own
  // headline ("Your board match") still identifies where the path lands.
  const headlineById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of doc.nodes) {
      if ((n.type === "result" || n.type === "end") && n.data.headline) {
        m.set(n.id, n.data.headline);
      }
    }
    return m;
  }, [doc]);

  if (count === 0) {
    return (
      <div className="qz-card" style={{ padding: 16 }}>
        <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
          No paths yet — add a deciding question and route its answers in the Map tab.
        </p>
      </div>
    );
  }

  return (
    <div className="qz-paths">
      <div className="qz-paths-head">
        <span className="qz-dim" style={{ fontSize: 12.5 }}>
          {count} path{count === 1 ? "" : "s"} → {groups.length} result
          {groups.length === 1 ? "" : "s"}
        </span>
        {truncated ? (
          <span className="qz-paths-trunc" title="Enumeration hit its responsiveness cap">
            showing the first {count} — refine the flow to see every path
          </span>
        ) : null}
      </div>
      {groups.map((g) => {
        const cat = g.targetId ? catById.get(g.targetId) : undefined;
        const resultNodeId = g.paths.find((p) => p.resultNodeId)?.resultNodeId ?? null;
        // Label chain: category name → result-node headline → "Result".
        const label =
          g.targetId === null
            ? null
            : cat?.name ?? (resultNodeId ? headlineById.get(resultNodeId) : undefined) ?? "Result";
        return (
          <PathGroupBlock
            key={g.targetId ?? "__fallback"}
            targetName={label}
            productCount={cat?.productIds.length ?? 0}
            paths={g.paths}
            deadEndCount={g.deadEndCount}
            deciderId={deciderId}
            ordinalById={ordinalById}
            onSelectNode={onSelectNode}
          />
        );
      })}
    </div>
  );
}

function PathGroupBlock({
  targetName,
  productCount,
  paths,
  deadEndCount,
  deciderId,
  ordinalById,
  onSelectNode,
}: {
  targetName: string | null;
  productCount: number;
  paths: EnumeratedPath[];
  deadEndCount: number;
  deciderId: string | null;
  ordinalById: Map<string, number>;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? paths : paths.slice(0, GROUP_PREVIEW);
  const hidden = paths.length - shown.length;
  const ruled = paths.some((p) => p.ruleOverridden);
  // The group chip class: fallback/dead-end = amber, rule-overridden = indigo,
  // otherwise the neutral "black" result chip (spec §5).
  const resultKind = targetName === null ? "deadend" : ruled ? "ruled" : "result";

  return (
    <section className="qz-path-group">
      <header className="qz-path-group-head">
        <span className={`qz-path-result is-${resultKind}`}>
          {targetName === null ? (
            <>⚠ no result → fallback</>
          ) : (
            <>
              {targetName}
              <span className="qz-path-result-meta">
                {productCount > 0 ? ` · ${productCount} product${productCount === 1 ? "" : "s"}` : ""}
                {ruled ? " · ruled" : ""}
              </span>
            </>
          )}
        </span>
        <span className="qz-dim" style={{ fontSize: 11.5 }}>
          {paths.length} path{paths.length === 1 ? "" : "s"}
          {deadEndCount > 0 && targetName !== null ? ` · ⚠ ${deadEndCount} dead-end` : ""}
        </span>
      </header>
      <div className="qz-path-lanes">
        {shown.map((p, i) => (
          <Lane
            key={i}
            path={p}
            deciderId={deciderId}
            ordinalById={ordinalById}
            onSelectNode={onSelectNode}
          />
        ))}
      </div>
      {hidden > 0 ? (
        <button type="button" className="qz-path-more" onClick={() => setExpanded(true)}>
          show {hidden} more path{hidden === 1 ? "" : "s"}
        </button>
      ) : expanded && paths.length > GROUP_PREVIEW ? (
        <button type="button" className="qz-path-more" onClick={() => setExpanded(false)}>
          show fewer
        </button>
      ) : null}
    </section>
  );
}

function Lane({
  path,
  deciderId,
  ordinalById,
  onSelectNode,
}: {
  path: EnumeratedPath;
  deciderId: string | null;
  ordinalById: Map<string, number>;
  onSelectNode: (nodeId: string | null) => void;
}) {
  return (
    <div className={`qz-path-lane${path.deadEnd ? " is-deadend" : ""}`}>
      {path.steps.map((s, i) => {
        const ord = ordinalById.get(s.questionId);
        const isDecider = s.questionId === deciderId;
        return (
          <span key={i} className="qz-path-seg">
            <button
              type="button"
              className={`qz-path-chip${isDecider ? " is-decider" : ""}${s.branch ? " is-branch" : ""}`}
              title="Open this question in the Map"
              onClick={() => onSelectNode(s.questionId)}
            >
              {s.branch ? <span aria-hidden>⋔ </span> : null}
              <b>Q{ord ?? "?"}</b>
              <span className="qz-path-chip-ans">{s.answerText}</span>
            </button>
            <span className="qz-path-arrow" aria-hidden>→</span>
          </span>
        );
      })}
      {path.deadEnd ? (
        <span className="qz-path-chip is-deadend" title={path.deadEndReason ?? "dead end"}>
          ⚠ dead end
        </span>
      ) : (
        <span className="qz-path-chip is-terminal" aria-hidden>
          ✓
        </span>
      )}
    </div>
  );
}
