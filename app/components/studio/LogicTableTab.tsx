import { useMemo, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import type { BuilderCategory } from "../builder/stepProps";
import {
  enumeratePaths,
  groupPathsByResult,
  type EnumeratedPath,
} from "../../lib/pathEnumeration";

// ════════════════════════════════════════════════════════════════════════════
// QZY-R9 (LV4) — the Logic view's "Table" tab. Same enumeratePaths dataset as
// the Paths tab, laid out as a grid: collapsed = one row per result (decider
// answer · result+N · path count · ✓/⚠N status); expanded = every path with a
// COLUMN per question — and here a skipped question renders "–" (the complement
// of the Paths lanes, which omit it). Answer cells jump to the Map.
//
// R9-1 is read-only. Result-cell "override → writes a path-signature rule"
// (LV4) rides `draftRule` + `addDecisionRule` and lands in R9-2 — both the
// Table and the Paths result chips will reuse it.
// ════════════════════════════════════════════════════════════════════════════

export function LogicTableTab({
  doc,
  questions,
  categories,
  onSelectNode,
}: {
  doc: Quiz;
  questions: ReadonlyArray<{ node: { id: string }; qIndex: number }>;
  categories: BuilderCategory[];
  onSelectNode: (nodeId: string | null) => void;
}) {
  const { paths, truncated, count } = useMemo(() => enumeratePaths(doc), [doc]);
  const groups = useMemo(() => groupPathsByResult(paths), [paths]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const headlineById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of doc.nodes) {
      if ((n.type === "result" || n.type === "end") && n.data.headline) m.set(n.id, n.data.headline);
    }
    return m;
  }, [doc]);

  // Which result groups are expanded (targetId key; "__fallback" for the null group).
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (count === 0) {
    return (
      <div className="qz-card" style={{ padding: 16 }}>
        <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
          No paths yet — add a deciding question and route its answers in the Map tab.
        </p>
      </div>
    );
  }

  const cols = questions.map((q) => ({ id: q.node.id, label: `Q${q.qIndex}` }));

  const resultLabel = (g: (typeof groups)[number]): string | null => {
    if (g.targetId === null) return null;
    const cat = catById.get(g.targetId);
    const resultNodeId = g.paths.find((p) => p.resultNodeId)?.resultNodeId ?? null;
    return cat?.name ?? (resultNodeId ? headlineById.get(resultNodeId) : undefined) ?? "Result";
  };

  return (
    <div className="qz-ltable-wrap">
      <div className="qz-paths-head" style={{ marginBottom: 8 }}>
        <span className="qz-dim" style={{ fontSize: 12.5 }}>
          {count} path{count === 1 ? "" : "s"} → {groups.length} result{groups.length === 1 ? "" : "s"}
        </span>
        {truncated ? (
          <span className="qz-paths-trunc">showing the first {count} — refine to see every path</span>
        ) : null}
      </div>
      <table className="qz-ltable">
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            <th>Result</th>
            {cols.map((c) => (
              <th key={c.id}>{c.label}</th>
            ))}
            <th>Paths</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const key = g.targetId ?? "__fallback";
            const isOpen = open.has(key);
            const label = resultLabel(g);
            const ok = g.deadEndCount === 0 && g.targetId !== null;
            return (
              <ResultRows
                key={key}
                groupKey={key}
                label={label}
                paths={g.paths}
                deadEndCount={g.deadEndCount}
                ok={ok}
                cols={cols}
                isOpen={isOpen}
                onToggle={() => toggle(key)}
                onSelectNode={onSelectNode}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultRows({
  groupKey,
  label,
  paths,
  deadEndCount,
  ok,
  cols,
  isOpen,
  onToggle,
  onSelectNode,
}: {
  groupKey: string;
  label: string | null;
  paths: EnumeratedPath[];
  deadEndCount: number;
  ok: boolean;
  cols: Array<{ id: string; label: string }>;
  isOpen: boolean;
  onToggle: () => void;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const status = ok ? (
    <span className="qz-ltable-ok">✓</span>
  ) : label === null ? (
    <span className="qz-ltable-warn">⚠ → fallback</span>
  ) : (
    <span className="qz-ltable-warn">⚠ {deadEndCount} dead-end</span>
  );

  return (
    <>
      <tr className="qz-ltable-group" onClick={onToggle}>
        <td>
          <button
            type="button"
            className="qz-ltable-caret"
            aria-expanded={isOpen}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td>
          <span className={`qz-path-result${label === null ? " is-deadend" : ""}`}>
            {label ?? "⚠ no result → fallback"}
          </span>
        </td>
        {cols.map((c) => (
          <td key={c.id} className="qz-dim">
            {/* Column values live on the per-path rows below. */}
          </td>
        ))}
        <td className="qz-ltable-num">{paths.length}</td>
        <td>{status}</td>
      </tr>
      {isOpen
        ? paths.map((p, i) => {
            const byQ = new Map(p.steps.map((s) => [s.questionId, s]));
            return (
              <tr key={`${groupKey}-${i}`} className="qz-ltable-path">
                <td />
                <td className="qz-dim qz-ltable-idx">#{i + 1}</td>
                {cols.map((c) => {
                  const step = byQ.get(c.id);
                  return (
                    <td key={c.id}>
                      {step ? (
                        <button
                          type="button"
                          className="qz-ltable-ans"
                          title="Open this question in the Map"
                          onClick={() => onSelectNode(c.id)}
                        >
                          {step.answerText}
                        </button>
                      ) : (
                        // Skipped on this path — spec §4: render "–".
                        <span className="qz-ltable-skip" aria-label="skipped">–</span>
                      )}
                    </td>
                  );
                })}
                <td />
                <td>
                  {p.deadEnd ? (
                    <span className="qz-ltable-warn" title={p.deadEndReason ?? "dead end"}>⚠</span>
                  ) : (
                    <span className="qz-ltable-ok">✓</span>
                  )}
                </td>
              </tr>
            );
          })
        : null}
    </>
  );
}
