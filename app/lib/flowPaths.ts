// ANALYTICS-HANDOFF Data work 5b — the PATH STRUCTURE of a branching quiz.
//
// `orderFlow` lays a quiz out for the canvas: it puts every node a question's
// answers route to on one "main" spine, and only a `branch` node opens lanes.
// That is right for drawing and wrong for counting — a quiz whose Question 1
// sends Dry or Sensitive to Q2 and everyone else to Q3 is two PATHS, and a
// shopper on one of them never "left" the other. This module reads the graph
// the way the runtime walks it and returns a tree of spine steps and forks:
//
// - A FORK is any step with two or more distinct next steps: a question whose
//   answers' `edge_handle_id`s route to different targets, or a `branch` node
//   whose slots do.
// - Its JOIN is the step every path must pass through again (the immediate
//   post-dominator). A join on a result/end — or no join at all — means the
//   paths never meet again before the result, and `joinNodeId` is null.
// - Each path is named by the answers that lead into it, lettered A, B, … in
//   the order of the answers on the splitting question.
//
// Routing mirrors the runtime exactly (`nextNodeFor` / `pickBranchSlot` in
// recommendationEngine.ts): an answer follows the edge whose `source_handle`
// is its `edge_handle_id`, else the first unhandled edge, else the first edge;
// a multi-select advances on the FIRST picked answer in the question's order;
// a non-question step follows its single fallback edge.
//
// Pure: no DB, no React. Deterministic on `doc.nodes` / `doc.edges` order.

import type { Quiz as QuizDoc, QuizNode, EdgeCondition } from "./quizSchema";

export type FlowItem =
  | { kind: "node"; nodeId: string; nodeType: QuizNode["type"] }
  | { kind: "fork"; fork: FlowFork };

/** How a session that left no answer inside the fork is routed into a path. */
export type ForkRouting =
  | {
      kind: "question";
      questionId: string;
      /** answer id → path index, in the question's answer order. */
      answerOrder: string[];
      answerPath: Map<string, number>;
      /** Skip / unknown answer → the runtime's fallback edge. */
      defaultPath: number;
    }
  | {
      kind: "branch";
      mode: "rules" | "ab_split" | "points";
      slots: Array<{ slotId: string; hasEdge: boolean; condition: EdgeCondition | undefined; path: number }>;
      defaultPath: number;
    };

export interface FlowPath {
  /** "A", "B", … in answer order; nested paths are "A1", "A2", then "A1.1". */
  letter: string;
  /** Answers on the splitting question that lead here, in answer order. */
  entryAnswerIds: string[];
  /** The branch slot's own label when the path comes from a `branch` node. */
  slotLabel: string | null;
  /** First node of the path; null when the path goes straight to the join. */
  firstNodeId: string | null;
  items: FlowItem[];
}

export interface FlowFork {
  /**
   * The step whose answer sends shoppers down a path: the question itself, or,
   * for a `branch` node directly after a question, that question. A branch
   * with no question right before it is its own split node.
   */
  splitNodeId: string;
  /** The `branch` node that does the routing, when there is one. */
  branchNodeId: string | null;
  /** Where the paths meet again; null when they never rejoin before the result. */
  joinNodeId: string | null;
  paths: FlowPath[];
  routing: ForkRouting;
}

export interface FlowPathTree {
  introId: string | null;
  /** The shared spine after the intro: steps and forks, in walk order. */
  items: FlowItem[];
  /** Result nodes reached anywhere in the walk, in discovery order. */
  resultIds: string[];
  /** True when the walk found at least one fork. */
  hasFork: boolean;
}

const EXIT = "\u0000exit";

function letterFor(prefix: string, i: number): string {
  if (!prefix) return i < 26 ? String.fromCharCode(65 + i) : `P${i + 1}`;
  return /[A-Z]$/.test(prefix) ? `${prefix}${i + 1}` : `${prefix}.${i + 1}`;
}

interface Target {
  target: string;
  answerIds: string[];
  slotLabel: string | null;
  /** Sort key: index of the first answer leading here (Infinity = none). */
  firstAnswer: number;
  /** Tie-break: slot / discovery order. */
  order: number;
}

export function buildFlowPaths(doc: QuizDoc): FlowPathTree {
  const nodeById = new Map<string, QuizNode>();
  for (const n of doc.nodes) nodeById.set(n.id, n);
  const out = new Map<string, QuizDoc["edges"]>();
  for (const e of doc.edges) {
    const list = out.get(e.source) ?? [];
    list.push(e);
    out.set(e.source, list);
  }

  /** The runtime's `nextNodeFor`: matching handle, else unhandled, else first. */
  const nextFor = (nodeId: string, handle: string | null): string | null => {
    const outbound = out.get(nodeId) ?? [];
    if (outbound.length === 0) return null;
    if (handle) {
      const match = outbound.find((e) => e.source_handle === handle);
      if (match) return match.target;
    }
    const fallback = outbound.find((e) => !e.source_handle) ?? outbound[0];
    return fallback ? fallback.target : null;
  };

  const isTerminal = (id: string): boolean => {
    const t = nodeById.get(id)?.type;
    return t === undefined || t === "result" || t === "end";
  };

  // ── Distinct next steps per node, with the answers that lead to each ────
  const targetsCache = new Map<string, Target[]>();


  /** Rules-mode slot pick given a selected answer set; `null` = undecidable. */
  const pickSlot = (
    slots: Array<{ slotId: string; hasEdge: boolean; condition: EdgeCondition | undefined }>,
    selected: ReadonlySet<string>,
  ): string | null => {
    for (const s of slots) {
      if (!s.hasEdge) continue;
      const c = s.condition;
      if (!c) return s.slotId;
      if (c.tag || c.ab_slot || c.points_category) continue; // not knowable from answers
      if (c.answer_id && selected.has(c.answer_id)) return s.slotId;
    }
    return null;
  };

  const targetsOf = (id: string, prevQuestion: string | null): Target[] => {
    const cached = targetsCache.get(id);
    if (cached) return cached;
    const node = nodeById.get(id);
    const list: Target[] = [];
    const add = (target: string | null, answerId: string | null, answerIdx: number, slotLabel: string | null, order: number) => {
      if (!target) return;
      let t = list.find((x) => x.target === target);
      if (!t) {
        t = { target, answerIds: [], slotLabel, firstAnswer: Infinity, order };
        list.push(t);
      }
      if (answerId && !t.answerIds.includes(answerId)) {
        t.answerIds.push(answerId);
        t.firstAnswer = Math.min(t.firstAnswer, answerIdx);
      }
    };
    if (!node || isTerminal(id)) {
      // terminal: no next step
    } else if (node.type === "question") {
      node.data.answers.forEach((a, i) => add(nextFor(id, a.edge_handle_id), a.id, i, null, i));
      add(nextFor(id, null), null, Infinity, null, node.data.answers.length);
    } else if (node.type === "branch") {
      const slots = node.data.slots.map((s) => {
        const edge = (out.get(id) ?? []).find((e) => e.source_handle === s.id);
        return { slotId: s.id, label: s.label, hasEdge: Boolean(edge), condition: edge?.condition };
      });
      const slotTarget = new Map(slots.map((s) => [s.slotId, nextFor(id, s.slotId)] as const));
      const fallbackSlot =
        slots.find((s) => s.hasEdge && !s.condition)?.slotId ?? node.data.slots[0]?.id ?? null;
      slots.forEach((s, i) => add(slotTarget.get(s.slotId) ?? null, null, Infinity, s.label, i));

      // Name the paths by the splitting question's answers when the branch
      // routes purely on that question (rules mode, answer_id or no condition).
      const q = prevQuestion ? nodeById.get(prevQuestion) : undefined;
      const qAnswers = q?.type === "question" ? q.data.answers : [];
      const qAnswerIds = new Set(qAnswers.map((a) => a.id));
      const answerBased =
        node.data.mode === "rules" &&
        qAnswers.length > 0 &&
        slots.every(
          (s) =>
            !s.condition ||
            (!s.condition.tag && !s.condition.ab_slot && !s.condition.points_category &&
              (!s.condition.answer_id || qAnswerIds.has(s.condition.answer_id))),
        );
      if (answerBased) {
        qAnswers.forEach((a, i) => {
          const slot = pickSlot(slots, new Set([a.id])) ?? fallbackSlot;
          add(slot ? slotTarget.get(slot) ?? null : null, a.id, i, null, i);
        });
      } else {
        for (const s of slots) {
          if (s.condition?.answer_id) add(slotTarget.get(s.slotId) ?? null, s.condition.answer_id, Infinity, null, 0);
        }
      }
    } else {
      add(nextFor(id, null), null, Infinity, null, 0);
    }
    // Answer order first ("the letters follow the order of the answers on the
    // splitting question"); targets no answer reaches keep slot/discovery order.
    const sorted = [...list].sort((a, b) =>
      a.firstAnswer !== b.firstAnswer ? a.firstAnswer - b.firstAnswer : a.order - b.order,
    );
    targetsCache.set(id, sorted);
    return sorted;
  };

  const routingOf = (id: string, targets: Target[]): ForkRouting => {
    const node = nodeById.get(id);
    const pathOf = (target: string | null): number => {
      const i = targets.findIndex((t) => t.target === target);
      return i < 0 ? 0 : i;
    };
    let routing: ForkRouting;
    if (node?.type === "branch") {
      const slots = node.data.slots.map((s) => {
        const edge = (out.get(id) ?? []).find((e) => e.source_handle === s.id);
        return { slotId: s.id, hasEdge: Boolean(edge), condition: edge?.condition, path: pathOf(nextFor(id, s.id)) };
      });
      const fallbackSlot = slots.find((s) => s.hasEdge && !s.condition) ?? slots[0];
      routing = { kind: "branch", mode: node.data.mode, slots, defaultPath: fallbackSlot ? fallbackSlot.path : 0 };
    } else {
      const answers = node?.type === "question" ? node.data.answers : [];
      const answerPath = new Map<string, number>();
      for (const a of answers) answerPath.set(a.id, pathOf(nextFor(id, a.edge_handle_id)));
      routing = {
        kind: "question",
        questionId: id,
        answerOrder: answers.map((a) => a.id),
        answerPath,
        defaultPath: pathOf(nextFor(id, null)),
      };
    }
    return routing;
  };

  // ── Reachable graph + immediate post-dominators ──────────────────────────
  const intro = doc.nodes.find((n) => n.type === "intro");
  if (!intro) return { introId: null, items: [], resultIds: [], hasFork: false };

  // Successors for dominance ignore the answer naming (prevQuestion only
  // affects naming, never the target set).
  const succ = new Map<string, string[]>();
  {
    const queue = [intro.id];
    const seen = new Set<string>(queue);
    while (queue.length) {
      const id = queue.shift()!;
      const s = targetsOf(id, null).map((t) => t.target).filter((t) => nodeById.has(t));
      succ.set(id, s);
      for (const t of s) {
        if (!seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }
    targetsCache.clear(); // re-derived below with the right naming context
  }
  const reachable = [...succ.keys()];
  const all = new Set<string>([...reachable, EXIT]);
  const pdom = new Map<string, Set<string>>();
  for (const id of reachable) pdom.set(id, new Set(all));
  pdom.set(EXIT, new Set([EXIT]));
  const succOrExit = (id: string): string[] => {
    const s = succ.get(id) ?? [];
    return s.length === 0 || isTerminal(id) ? [EXIT] : s;
  };
  for (let changed = true, guard = 0; changed && guard < 1000; guard += 1) {
    changed = false;
    for (const id of reachable) {
      let next: Set<string> | null = null;
      for (const s of succOrExit(id)) {
        const ps = pdom.get(s)!;
        if (next === null) next = new Set(ps);
        else for (const x of next) if (!ps.has(x)) next.delete(x);
      }
      const nextSet: Set<string> = next ?? new Set<string>();
      nextSet.add(id);
      if (nextSet.size !== pdom.get(id)!.size) {
        pdom.set(id, nextSet);
        changed = true;
      }
    }
  }
  const ipdom = (id: string): string | null => {
    const strict = [...pdom.get(id)!].filter((x) => x !== id);
    // A node that can never reach an exit keeps the universal set: no join.
    if (strict.length === 0 || strict.length >= all.size - 1) return null;
    const d = strict.find((x) => pdom.get(x)!.size === strict.length);
    return d && d !== EXIT ? d : null;
  };

  // ── Walk into a tree ─────────────────────────────────────────────────────
  const claimed = new Set<string>();
  const resultIds: string[] = [];
  let hasFork = false;

  const walk = (start: string | null, stop: string | null, prefix: string): FlowItem[] => {
    const items: FlowItem[] = [];
    let cur = start;
    let prevQuestion: string | null = null;
    while (cur && cur !== stop) {
      const node = nodeById.get(cur);
      if (!node) break;
      if (node.type === "result" || node.type === "end") {
        if (node.type === "result" && !resultIds.includes(cur)) resultIds.push(cur);
        break;
      }
      // A node already placed (a cross-edge into a sibling path, or a cycle)
      // stops this walk: every step is counted in exactly one place.
      if (claimed.has(cur)) break;
      claimed.add(cur);
      items.push({ kind: "node", nodeId: cur, nodeType: node.type });
      const targets = targetsOf(cur, node.type === "branch" ? prevQuestion : null);
      if (targets.length === 0) break;
      if (targets.length === 1) {
        prevQuestion = node.type === "question" ? cur : node.type === "branch" ? prevQuestion : null;
        cur = targets[0]!.target;
        continue;
      }
      const join = ipdom(cur);
      const routing = routingOf(cur, targets);
      const paths: FlowPath[] = targets.map((t, i) => {
        const letter = letterFor(prefix, i);
        const pathItems = walk(t.target, join, letter);
        const first = pathItems[0];
        return {
          letter,
          entryAnswerIds: t.answerIds,
          slotLabel: t.slotLabel,
          firstNodeId: first?.kind === "node" ? first.nodeId : null,
          items: pathItems,
        };
      });
      // Every path goes straight on (e.g. a last question whose answers pick
      // the result page): no step is path-only, so this is not a split worth
      // counting — the quiz stays linear for the ledger.
      if (paths.every((p) => p.items.length === 0)) {
        prevQuestion = null;
        cur = join;
        continue;
      }
      hasFork = true;
      const joinType = join ? nodeById.get(join)?.type : undefined;
      items.push({
        kind: "fork",
        fork: {
          splitNodeId: node.type === "branch" && prevQuestion ? prevQuestion : cur,
          branchNodeId: node.type === "branch" ? cur : null,
          joinNodeId: join && joinType !== "result" && joinType !== "end" ? join : null,
          paths,
          routing,
        },
      });
      prevQuestion = null;
      cur = join;
    }
    return items;
  };

  const first = nextFor(intro.id, null);
  const items = walk(first, null, "");
  return { introId: intro.id, items, resultIds, hasFork };
}

/**
 * Which path of `fork` a session takes when it left no answer inside the fork
 * (it answered the split question and went straight to the join, or finished
 * without answering). `answers` is the session's last answer ids per question.
 * Mirrors the runtime; anything the answers cannot decide (tags, A/B rolls,
 * points) falls to the runtime's fallback slot.
 */
export function routeFork(fork: FlowFork, answers: ReadonlyMap<string, readonly string[]>): number {
  const r = fork.routing;
  if (r.kind === "question") {
    const picked = new Set(answers.get(r.questionId) ?? []);
    for (const id of r.answerOrder) if (picked.has(id)) return r.answerPath.get(id) ?? r.defaultPath;
    return r.defaultPath;
  }
  if (r.mode !== "rules") return r.defaultPath;
  const selected = new Set<string>();
  for (const ids of answers.values()) for (const id of ids) selected.add(id);
  for (const s of r.slots) {
    if (!s.hasEdge) continue;
    const c = s.condition;
    if (!c) return s.path;
    if (c.tag || c.ab_slot || c.points_category) continue;
    if (c.answer_id && selected.has(c.answer_id)) return s.path;
  }
  return r.defaultPath;
}
