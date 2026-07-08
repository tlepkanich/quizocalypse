import type { Quiz } from "./quizSchema";
import { resolveNextStep, type BranchContext } from "./recommendationEngine";
import { resolveTarget, type ResolvedTarget } from "./recommendDecider";

// ════════════════════════════════════════════════════════════════════════════
// QZY-R · R1 — the path-enumeration engine (quiz-logic-view v1.0 §1/§4/§5/§6).
//
// The Logic-View Paths and Table tabs are both live projections of ONE thing:
// the set of distinct shopper paths through a branched decider quiz, each with
// its effective result. This module produces exactly that — and NOTHING here
// reimplements resolution. It FORKS where `routeTrace.tracePath` walks:
//   • routing follows the runtime's own `resolveNextStep` (per-answer edges),
//     so "skipped questions are absent from the lane" (spec §4) falls out for
//     free — the walk only visits nodes the router actually routes to;
//   • each path's effective result is `resolveTarget(selectedAnswerIds, doc)` —
//     the exact call the shopper runtime makes (QuizRuntime.tsx:464) — so a
//     Table/Paths cell can never disagree with what a shopper sees.
//
// Product "+N more" counts need the baked catalog (target_product_ids_map) and
// are an OPTIONAL enrichment layer (spec §7 Dependencies: "Without it, ship
// decider-exact results only and defer set counts"). This core is pure and
// catalog-free; R8/R9 layer product counts on top.
//
// Scope note: enumeration forks one answer per question (the lane/chip model —
// "Q# + answer"). Multi-select answer COMBINATIONS are not expanded (the
// decider is single-select by rule; a multi-select filter's answers each fork
// independently). Documented, not silent.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export interface EnumStep {
  questionId: string;
  answerId: string;
  answerText: string;
  /** True when this answer's route is non-sequential — it diverges from its
   *  sibling answers' plurality target (the spec's indigo "branch" marker). */
  branch: boolean;
}

/** Why a path resolves to no product (before the empty-case fallback layer). */
export type DeadEndReason =
  | "unreached-decider" // the path ended without ever selecting a deciding answer
  | "no-result"; // a deciding answer (or rules) resolved to nothing

export interface EnumeratedPath {
  /** Ordered question→answer picks; skipped questions are absent by construction. */
  steps: EnumStep[];
  /** The answer ids selected along this path — the `resolveTarget` input. */
  selectedAnswerIds: string[];
  /** The terminal `result` node id, or null when the path ended at `end`/ran out. */
  resultNodeId: string | null;
  /** Decider-exact resolved target (rules → decider). null ⇒ dead end ⇒ fallback. */
  effectiveTarget: ResolvedTarget | null;
  /** True when a rule (not the base mapping) determined/annotated the target. */
  ruleOverridden: boolean;
  /** Blocking: this path resolves to no result (renders amber, → fallback). */
  deadEnd: boolean;
  deadEndReason?: DeadEndReason;
}

export interface EnumerateResult {
  paths: EnumeratedPath[];
  /** True when `maxPaths` stopped enumeration before every path was emitted.
   *  Callers MUST surface this (spec §6 "showing 50 of N" / large-catalog note)
   *  — never present a truncated set as exhaustive. */
  truncated: boolean;
  /** Emitted path count (== paths.length). */
  count: number;
  /** The dead-end paths among those emitted. NOTE: when `truncated`, this is
   *  best-effort within the cap — exhaustive BLOCKING completeness is owned by
   *  the answer-level checks in `buildTier1Report` (V2/V4/V11/V12), which the
   *  Logic-View renders alongside; do not treat this list as the full blocking
   *  set past the cap. */
  deadEnds: EnumeratedPath[];
}

export interface EnumerateOptions {
  /** Responsiveness backstop (spec §6). Default 2000. */
  maxPaths?: number;
  /** Runaway/cycle backstop for pathological docs. Default 64. */
  maxDepth?: number;
}

/** Per-answer "is this a branch" flags: within a question, answers whose route
 *  target differs from the plurality target are branches. Purely linear
 *  questions (all answers → the same next) yield no branches. */
function computeBranchFlags(doc: QuizDoc): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    const targets = n.data.answers.map((a) => {
      const explicit = doc.edges.find(
        (e) => e.source === n.id && e.source_handle === a.edge_handle_id,
      );
      const fallthrough = doc.edges.find((e) => e.source === n.id && !e.source_handle);
      return { id: a.id, target: (explicit ?? fallthrough)?.target ?? null };
    });
    const distinct = new Set(targets.map((t) => t.target));
    if (distinct.size <= 1) {
      for (const t of targets) flags.set(t.id, false);
      continue;
    }
    const counts = new Map<string | null, number>();
    for (const t of targets) counts.set(t.target, (counts.get(t.target) ?? 0) + 1);
    let plurality: string | null = null;
    let best = -1;
    for (const [tid, c] of counts) {
      if (c > best) {
        best = c;
        plurality = tid;
      }
    }
    for (const t of targets) flags.set(t.id, t.target !== plurality);
  }
  return flags;
}

/** Enumerate every distinct shopper path through a decider quiz. Pure; walks
 *  the runtime router and resolves each path with the runtime resolver. */
export function enumeratePaths(doc: QuizDoc, opts: EnumerateOptions = {}): EnumerateResult {
  const maxPaths = opts.maxPaths ?? 2000;
  const maxDepth = opts.maxDepth ?? 64;

  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
  const decider = doc.nodes.find((n) => n.type === "question" && n.data.role === "decides");
  const deciderAnswerIds = new Set(
    decider && decider.type === "question" ? decider.data.answers.map((a) => a.id) : [],
  );
  const branchByAnswer = computeBranchFlags(doc);

  const paths: EnumeratedPath[] = [];
  let truncated = false;

  const emit = (steps: EnumStep[], selected: string[], resultNodeId: string | null): void => {
    if (paths.length >= maxPaths) {
      truncated = true;
      return;
    }
    const effectiveTarget = resolveTarget(selected, doc);
    const deadEnd = effectiveTarget === null;
    const reachedDecider = selected.some((id) => deciderAnswerIds.has(id));
    paths.push({
      steps,
      selectedAnswerIds: selected,
      resultNodeId,
      effectiveTarget,
      ruleOverridden: effectiveTarget?.matchedRuleId != null,
      deadEnd,
      ...(deadEnd
        ? { deadEndReason: (reachedDecider ? "no-result" : "unreached-decider") as DeadEndReason }
        : {}),
    });
  };

  const intro = doc.nodes.find((n) => n.type === "intro") ?? doc.nodes[0];
  if (!intro) return { paths: [], truncated: false, count: 0, deadEnds: [] };

  const walk = (
    currentId: string | null,
    steps: EnumStep[],
    selected: string[],
    tags: ReadonlySet<string>,
    visitedQuestions: ReadonlySet<string>,
    depth: number,
  ): void => {
    if (truncated) return;
    if (currentId == null || depth > maxDepth) {
      emit(steps, selected, null);
      return;
    }
    const node = nodeById.get(currentId);
    if (!node) {
      emit(steps, selected, null);
      return;
    }
    if (node.type === "result" || node.type === "end") {
      emit(steps, selected, node.type === "result" ? node.id : null);
      return;
    }

    if (node.type === "question") {
      // Cycle guard: a route back to a question already on this path stops it
      // (authoring disables revisit targets, but enumeration must never loop).
      if (visitedQuestions.has(node.id)) {
        emit(steps, selected, null);
        return;
      }
      const nextVisited = new Set(visitedQuestions).add(node.id);
      for (const a of node.data.answers) {
        if (paths.length >= maxPaths) {
          truncated = true;
          return;
        }
        const nextTags = new Set(tags);
        for (const t of a.tags) nextTags.add(t);
        const ctx: BranchContext = {
          accumulatedTags: nextTags,
          selectedAnswerIds: new Set([...selected, a.id]),
          abAssignments: {},
          rand: () => 0,
        };
        const next = resolveNextStep(doc, node.id, a.edge_handle_id ?? null, ctx);
        walk(
          next,
          [
            ...steps,
            {
              questionId: node.id,
              answerId: a.id,
              answerText: a.text,
              branch: branchByAnswer.get(a.id) ?? false,
            },
          ],
          [...selected, a.id],
          nextTags,
          nextVisited,
          depth + 1,
        );
      }
      return;
    }

    // Pass-through nodes (intro / message / email_gate / product_cards / …).
    const ctx: BranchContext = {
      accumulatedTags: new Set(tags),
      selectedAnswerIds: new Set(selected),
      abAssignments: {},
      rand: () => 0,
    };
    const next = resolveNextStep(doc, node.id, null, ctx);
    walk(next, steps, selected, tags, visitedQuestions, depth + 1);
  };

  walk(intro.id, [], [], new Set(), new Set(), 0);

  return {
    paths,
    truncated,
    count: paths.length,
    deadEnds: paths.filter((p) => p.deadEnd),
  };
}

export interface PathGroup {
  /** The group's effective target id, or null for the dead-end / fallback group. */
  targetId: string | null;
  paths: EnumeratedPath[];
  /** Dead-end paths within this group (spec §5 status "⚠ N dead ends"). */
  deadEndCount: number;
}

/** Collapse same-result paths (spec §5/§6 default). Groups preserve first-seen
 *  order; the dead-end/fallback group (targetId null) sorts last. */
export function groupPathsByResult(paths: readonly EnumeratedPath[]): PathGroup[] {
  const order: (string | null)[] = [];
  const byTarget = new Map<string | null, EnumeratedPath[]>();
  for (const p of paths) {
    const key = p.effectiveTarget?.targetId ?? null;
    if (!byTarget.has(key)) {
      byTarget.set(key, []);
      order.push(key);
    }
    byTarget.get(key)!.push(p);
  }
  const groups: PathGroup[] = order.map((targetId) => {
    const groupPaths = byTarget.get(targetId)!;
    return {
      targetId,
      paths: groupPaths,
      deadEndCount: groupPaths.filter((p) => p.deadEnd).length,
    };
  });
  // The null (dead-end/fallback) group renders last.
  return groups.sort((a, b) => (a.targetId === null ? 1 : 0) - (b.targetId === null ? 1 : 0));
}
