import { useMemo, useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import type { BuilderCategory } from "../builder/stepProps";
import { useQzToast } from "../qz-toast";
import { createRuleWithConditions } from "../onboarding/questionsLogicV3/logic/draftRule";
import {
  enumeratePaths,
  groupPathsByResult,
  type EnumeratedPath,
} from "../../lib/pathEnumeration";

// ════════════════════════════════════════════════════════════════════════════
// QZY-R9 (LV4) — the Logic view's "Table" tab. Same enumeratePaths dataset as
// the Paths tab, laid out as a grid: collapsed = one row per result (result
// chip · path count · ✓/⚠N status); expanded = every path with a COLUMN per
// question — a question the path skips renders "–" (spec §4, the complement of
// the Paths lanes). Answer cells jump to the Map.
//
// R9-2 — a path's result can be OVERRIDDEN: pick a target and it writes a
// path-signature rule ("If Q1 is X AND Q2 is Y → target", `createRuleWith-
// Conditions`), appended to the same global rules stack the Map edits. Because
// a rule flips that path's `effectiveTarget`/`ruleOverridden` on the next
// enumeration, the row re-badges "rule" and re-groups automatically — and
// deleting the rule in the Map reverts it. Never silent (toast + badge).
// ════════════════════════════════════════════════════════════════════════════

export function LogicTableTab({
  doc,
  questions,
  categories,
  commit,
  onSelectNode,
}: {
  doc: Quiz;
  questions: ReadonlyArray<{ node: { id: string }; qIndex: number }>;
  categories: BuilderCategory[];
  commit: (doc: Quiz) => void;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const toast = useQzToast();
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

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Which per-path row (if any) has its override picker open.
  const [overrideKey, setOverrideKey] = useState<string | null>(null);

  const applyOverride = (path: EnumeratedPath, targetId: string) => {
    // The path's picks become the rule's AND conditions (its signature).
    const conditions = path.steps.map((s) => ({
      question_id: s.questionId,
      answer_id: s.answerId,
      op: "is" as const,
    }));
    const { doc: next, ruleId } = createRuleWithConditions(doc, conditions, targetId);
    if (!ruleId) return;
    commit(next);
    const idx = (next.decision_rules ?? []).length;
    toast(`✓ Created R${idx} — rules are checked before mappings`);
    setOverrideKey(null);
  };

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
            return (
              <ResultRows
                key={key}
                groupKey={key}
                label={resultLabel(g)}
                paths={g.paths}
                deadEndCount={g.deadEndCount}
                ok={g.deadEndCount === 0 && g.targetId !== null}
                cols={cols}
                categories={categories}
                isOpen={openGroups.has(key)}
                onToggle={() => toggle(key)}
                overrideKey={overrideKey}
                setOverrideKey={setOverrideKey}
                onApplyOverride={applyOverride}
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
  categories,
  isOpen,
  onToggle,
  overrideKey,
  setOverrideKey,
  onApplyOverride,
  onSelectNode,
}: {
  groupKey: string;
  label: string | null;
  paths: EnumeratedPath[];
  deadEndCount: number;
  ok: boolean;
  cols: Array<{ id: string; label: string }>;
  categories: BuilderCategory[];
  isOpen: boolean;
  onToggle: () => void;
  overrideKey: string | null;
  setOverrideKey: (k: string | null) => void;
  onApplyOverride: (path: EnumeratedPath, targetId: string) => void;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const groupStatus = ok ? (
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
          <td key={c.id} />
        ))}
        <td className="qz-ltable-num">{paths.length}</td>
        <td>{groupStatus}</td>
      </tr>
      {isOpen
        ? paths.map((p, i) => {
            const rowKey = `${groupKey}-${i}`;
            const byQ = new Map(p.steps.map((s) => [s.questionId, s]));
            return (
              <tr key={rowKey} className="qz-ltable-path">
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
                        <span className="qz-ltable-skip" aria-label="skipped">–</span>
                      )}
                    </td>
                  );
                })}
                <td />
                <td>
                  <PathStatusCell
                    path={p}
                    categories={categories}
                    open={overrideKey === rowKey}
                    onOpen={() => setOverrideKey(rowKey)}
                    onClose={() => setOverrideKey(null)}
                    onApply={(targetId) => onApplyOverride(p, targetId)}
                  />
                </td>
              </tr>
            );
          })
        : null}
    </>
  );
}

function PathStatusCell({
  path,
  categories,
  open,
  onOpen,
  onClose,
  onApply,
}: {
  path: EnumeratedPath;
  categories: BuilderCategory[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onApply: (targetId: string) => void;
}) {
  const [pick, setPick] = useState("");
  // Already rule-driven → the "rule" badge (deleting the rule in the Map
  // reverts this automatically on the next enumeration).
  if (path.ruleOverridden) {
    return (
      <span className="qz-ltable-ruled" title="A rule sets this path's result">
        rule
      </span>
    );
  }
  // No buckets to target (e.g. a shop without a synced catalog) → status only.
  if (categories.length === 0) {
    return path.deadEnd ? (
      <span className="qz-ltable-warn">⚠</span>
    ) : (
      <span className="qz-ltable-ok">✓</span>
    );
  }
  if (!open) {
    return (
      <span className="qz-ltable-status-wrap">
        {path.deadEnd ? <span className="qz-ltable-warn">⚠</span> : <span className="qz-ltable-ok">✓</span>}
        <button type="button" className="qz-ltable-override" onClick={onOpen} title="Force this path to a result">
          override
        </button>
      </span>
    );
  }
  return (
    <span className="qz-ltable-override-pop">
      <select
        className="qz-ltable-select"
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        aria-label="Override result"
      >
        <option value="">Choose a result…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="qz-ltable-apply"
        disabled={!pick}
        onClick={() => pick && onApply(pick)}
      >
        Apply
      </button>
      <button type="button" className="qz-ltable-cancel" onClick={onClose} aria-label="Cancel">
        ✕
      </button>
    </span>
  );
}
