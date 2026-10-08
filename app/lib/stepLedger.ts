// ANALYTICS P0 — the merged step ledger (research doc §8.6, ruling R-d; spec
// section 05). One table replaces the old "stage-by-stage" + "drop-off by
// question" pair, which divided by the same wrong denominator (total starts).
//
// Semantics (honest, inference-based until `step_viewed` ships in P2):
// - "Reached" a question ⇒ the session ANSWERED it (answer_ids may be []) or
//   answered/completed anything later. A shopper who saw a question and left
//   without answering is NOT counted as having reached it, so drop-off is a
//   worst-case figure. We say so in the UI rather than round it away.
// - question_answered with answer_ids: [] is a SKIP, its own bucket — never
//   an answer (§03).
// - Last write wins per (session, question) — back-nav re-answers replace.
// - Reconciliation on the linear spine: reached = continued + skipped + left.
// - Branching docs (a question whose answers route to different steps, or a
//   `branch` node whose slots do) are counted PATH BY PATH (ANALYTICS-HANDOFF
//   Data work 5b): shared steps stay spine rows, the steps between a split and
//   its join are grouped into paths (`StepLedger.paths`), and every path step
//   carries its own reached / left / drop-off against its OWN path's shoppers.
//   A shopper on Path A never "left" Path B's steps.
// - Drop-off is RELATIVE: left ÷ reached-this-step, never over total starts.
//
// Pure: no DB, no React. The loader feeds distinct-session event rows.

import type { Quiz as QuizDoc } from "./quizSchema";
import { orderFlow } from "./flowOrder";
import { buildFlowPaths, routeFork, type FlowItem, type FlowPathTree } from "./flowPaths";

export interface LedgerEvent {
  sessionId: string;
  eventType: string;
  payload: unknown;
  /** ms epoch — used only for last-write-wins ordering. */
  ts: number;
}

export interface LedgerStep {
  nodeId: string;
  kind: "intro" | "question" | "email_gate" | "branch" | "result" | "other";
  label: string;
  /** null for rows where reach is not measurable (email_gate today). */
  reached: number | null;
  /** Answered-and-went-on (linear spine only). */
  continued: number | null;
  /** Skipped-and-went-on. */
  skipped: number | null;
  /** reached − reached(next). */
  left: number | null;
  /** left ÷ reached, relative to THIS step's pool. */
  dropoff: number | null;
  /** Branch rows: the split renders "splits by answer", never as abandonment. */
  splits: boolean;
  laneLabel: string | null;
  /**
   * Branching docs only (absent on linear docs): the path this row belongs to
   * (`LedgerPath.pathId`), or null for a shared spine row.
   */
  pathId?: string | null;
  /** Branching docs only: the path's letter ("A", "B", nested "A1"), or null. */
  pathLetter?: string | null;
}

/**
 * One path after a splitting question (ANALYTICS-HANDOFF "Branching
 * quizzes"). Tie-outs that hold by construction:
 * - the first counted step's `reached` is `shoppers`;
 * - each step's reached − left is the next step's reached in this path, and
 *   the last step's reached − left is `continue`;
 * - Σ paths' `shoppers` = the fork's `started` (shoppers who continued from
 *   the splitting question), Σ paths' `continue` = the fork's `joined`.
 */
export interface LedgerPath {
  /** Unique across the ledger: `${splitNodeId}:${letter}`. */
  pathId: string;
  /** "A", "B", … in the order of the answers on the splitting question;
   *  a path that splits again names its own paths "A1", "A2", … */
  letter: string;
  /** Answers on the splitting question that lead into this path. */
  entryAnswerIds: string[];
  /** Those answers' texts as the merchant wrote them; the UI makes the
   *  sentence ("If they pick Dry or Sensitive"). Empty when the path is not
   *  chosen by an answer (an A/B or tag branch) — use `slotLabel` then. */
  entryAnswerTexts: string[];
  /** The branch slot's label when the path comes from a `branch` node. */
  slotLabel: string | null;
  /** Shoppers who took this path. */
  shoppers: number;
  /** This path's own rows (a nested split's rows live in `forks`). */
  steps: LedgerStep[];
  /** A path that splits again. */
  forks: LedgerFork[];
  /**
   * Shoppers from this path who reached the join. When the paths never rejoin
   * (`LedgerFork.joinNodeId` null) it is the shoppers from this path who
   * finished.
   */
  continue: number;
}

export interface LedgerFork {
  /** The splitting question (or a `branch` node with no question before it). */
  splitNodeId: string;
  /** The `branch` node that routes, when the split is a branch node. */
  branchNodeId: string | null;
  /** Where the paths meet again; null when they never rejoin before the result. */
  joinNodeId: string | null;
  /** Shoppers who continued from the splitting question = Σ paths' shoppers. */
  started: number;
  /** Shoppers who reached the join (or finished, with no join) = Σ paths' continue. */
  joined: number;
  paths: LedgerPath[];
}

export interface StepLedger {
  /** True ⇒ the doc branches; per-lane rows carry answered counts only. */
  branching: boolean;
  steps: LedgerStep[];
  /**
   * nodeId of the steepest RELATIVE drop among the steps that
   * STEEPEST_MIN_REACHED or more shoppers reached. null below that volume: a
   * "worst step" picked from a handful of shoppers is luck, not a finding.
   */
  steepestNodeId: string | null;
  /**
   * "Typical step drop-off": the middle drop-off across all the steps that
   * have one. The Quiz flow figure and the drop-off insight both read THIS
   * number, so the two can never disagree.
   */
  typicalDropoff: number | null;
  /**
   * Branching docs only (absent on linear docs): each split on the shared
   * spine, in flow order, with its paths. Path rows also appear in `steps`
   * (flow order, path by path), tagged with `pathId`, so `steepestNodeId` and
   * `typicalDropoff` consider every step, path steps included.
   */
  paths?: LedgerFork[];
}

/** A step needs this many shoppers before it can be named the steepest drop,
 *  and before its drop-off is shown as a percentage. */
export const STEEPEST_MIN_REACHED = 30;

/**
 * The middle value of the steps' drop-offs. With an even count it is the
 * LOWER of the two middle values — a real step's figure, never an average
 * that no step on the page shows.
 */
export function typicalStepDropoff(steps: LedgerStep[]): number | null {
  const drops = steps
    .map((s) => s.dropoff)
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);
  if (drops.length === 0) return null;
  return drops[Math.floor((drops.length - 1) / 2)]!;
}

interface AnswerFact {
  skipped: boolean;
  ts: number;
}

/** Last answer per (session, question) — back-nav re-answers replace. */
export function lastAnswers(events: LedgerEvent[]): Map<string, Map<string, AnswerFact>> {
  const byQuestion = new Map<string, Map<string, AnswerFact>>();
  for (const e of events) {
    if (e.eventType !== "question_answered") continue;
    const p = e.payload as { question_id?: unknown; answer_ids?: unknown } | null;
    const qid = typeof p?.question_id === "string" ? p.question_id : null;
    if (!qid) continue;
    const ids = Array.isArray(p?.answer_ids) ? p.answer_ids : [];
    let perSession = byQuestion.get(qid);
    if (!perSession) {
      perSession = new Map();
      byQuestion.set(qid, perSession);
    }
    const prev = perSession.get(e.sessionId);
    if (!prev || e.ts >= prev.ts) perSession.set(e.sessionId, { skipped: ids.length === 0, ts: e.ts });
  }
  return byQuestion;
}

function nodeLabel(doc: QuizDoc, nodeId: string): string {
  const n = doc.nodes.find((x) => x.id === nodeId);
  if (!n) return nodeId;
  switch (n.type) {
    case "intro":
      return n.data.headline || "Welcome";
    case "question":
      return n.data.text;
    case "email_gate":
      return n.data.headline || "Email capture";
    case "branch":
      return n.data.label || "Branch";
    case "result":
      return n.data.headline || "Your recommendations";
    default:
      return n.type;
  }
}

/**
 * Build the merged ledger. `engaged` / `completed` are the cohort's distinct
 * session counts for quiz_engaged / quiz_completed (the intro and result rows).
 */
export function buildStepLedger(
  doc: QuizDoc,
  events: LedgerEvent[],
  engaged: number,
  completed: number,
): StepLedger {
  const tree = buildFlowPaths(doc);
  if (tree.hasFork) return buildBranchingLedger(doc, tree, events, engaged, completed);
  const flow = orderFlow(doc);
  const answers = lastAnswers(events);
  const branching = flow.branches.some((l) => l.steps.length > 0);

  const sessionsAt = (qid: string): Map<string, AnswerFact> => answers.get(qid) ?? new Map();

  // A branch mid-quiz does NOT disable drop-off for the questions before it.
  // The spec's own example is a linear spine, then a branch, then lanes — and
  // its spine steps reconcile. Only per-LANE questions are counts-only,
  // because two lanes are alternatives: a shopper who took lane A did not
  // "leave" lane B.
  //
  // Depth order: spine questions in flow order, with each branch's lane
  // questions SHARING the slot immediately after their branch. A session that
  // answered a lane question has necessarily passed every spine step before
  // the branch, which is what makes reach correct on a branching doc.
  const depthOf = new Map<string, number>();
  {
    let depth = 0;
    for (const step of flow.steps) {
      if (step.type === "question") {
        depthOf.set(step.nodeId, depth++);
      } else if (step.type === "branch") {
        for (const lane of flow.branches.filter((l) => l.branchNodeId === step.nodeId)) {
          for (const laneStep of lane.steps) {
            if (laneStep.type === "question") depthOf.set(laneStep.nodeId, depth);
          }
        }
        depth += 1;
      }
    }
  }
  const maxDepth = Math.max(...[...depthOf.values(), -1]) + 1;

  // Per session, the deepest step it is known to have reached. A completion
  // puts it past the end, so a shopper who completes without answering still
  // counts as having reached every step.
  const sessionDepth = new Map<string, number>();
  const bump = (sid: string, d: number) => {
    const prev = sessionDepth.get(sid);
    if (prev == null || d > prev) sessionDepth.set(sid, d);
  };
  for (const [qid, perSession] of answers) {
    const d = depthOf.get(qid);
    if (d == null) continue;
    for (const sid of perSession.keys()) bump(sid, d);
  }
  for (const e of events) {
    if (e.eventType === "quiz_completed") bump(e.sessionId, maxDepth);
  }

  /** Sessions whose known depth reached at least `d`. */
  const reachedAt = (d: number): number => {
    let n = 0;
    for (const depth of sessionDepth.values()) if (depth >= d) n += 1;
    return n;
  };

  const steps: LedgerStep[] = [];

  // quiz_completed is quiz-wide, so `completed` is only attributable to a
  // SINGLE result row. Multi-result (legacy personality) docs get no per-result
  // reach claim here — the outcome distribution section owns that split.
  const resultCount = doc.nodes.filter((n) => n.type === "result").length;

  // Intro row — engage is measured (clicked Start). Its loss is the gap to the
  // first question, so the diagram accounts for shoppers who start and then
  // bail before answering anything.
  if (flow.introId) {
    const firstReached = reachedAt(0);
    const introLeft = Math.max(0, engaged - firstReached);
    steps.push({
      nodeId: flow.introId,
      kind: "intro",
      label: nodeLabel(doc, flow.introId),
      reached: engaged,
      continued: firstReached,
      skipped: null,
      left: introLeft,
      dropoff: engaged > 0 ? introLeft / engaged : null,
      splits: false,
      laneLabel: null,
    });
  }

  const pushQuestion = (nodeId: string, laneLabel: string | null): void => {
    const perSession = sessionsAt(nodeId);
    if (laneLabel) {
      // Inside a branch: answer counts only — the shoppers who took the other
      // lane were routed, not lost, so no drop-off claim is honest here.
      let skipped = 0;
      for (const f of perSession.values()) if (f.skipped) skipped += 1;
      steps.push({
        nodeId,
        kind: "question",
        label: nodeLabel(doc, nodeId),
        reached: perSession.size,
        continued: null,
        skipped,
        left: null,
        dropoff: null,
        splits: false,
        laneLabel,
      });
      return;
    }
    const d = depthOf.get(nodeId) ?? 0;
    const reachedN = reachedAt(d);
    const nextReachedN = reachedAt(d + 1);
    // A skip still continues; count skips only among those who moved on.
    let skipped = 0;
    for (const [sid, f] of perSession) {
      if (f.skipped && (sessionDepth.get(sid) ?? -1) >= d + 1) skipped += 1;
    }
    const left = Math.max(0, reachedN - nextReachedN);
    const continued = Math.max(0, nextReachedN - skipped);
    steps.push({
      nodeId,
      kind: "question",
      label: nodeLabel(doc, nodeId),
      reached: reachedN,
      continued,
      skipped,
      left,
      dropoff: reachedN > 0 ? left / reachedN : null,
      splits: false,
      laneLabel: null,
    });
  };

  for (const step of flow.steps) {
    if (step.type === "question") pushQuestion(step.nodeId, null);
    else if (step.type === "branch") {
      steps.push({
        nodeId: step.nodeId,
        kind: "branch",
        label: nodeLabel(doc, step.nodeId),
        reached: null,
        continued: null,
        skipped: null,
        left: null,
        dropoff: null,
        splits: true,
        laneLabel: null,
      });
      // Lane rows directly under their branch, in slot order.
      for (const lane of flow.branches.filter((l) => l.branchNodeId === step.nodeId)) {
        for (const laneStep of lane.steps) {
          if (laneStep.type === "question") pushQuestion(laneStep.nodeId, lane.slotLabel);
        }
      }
    } else if (step.type === "email_gate") {
      steps.push({
        nodeId: step.nodeId,
        kind: "email_gate",
        label: nodeLabel(doc, step.nodeId),
        reached: null, // not measurable until email_gate events ship (P2)
        continued: null,
        skipped: null,
        left: null,
        dropoff: null,
        splits: false,
        laneLabel: null,
      });
    } else if (step.type === "result") {
      steps.push({
        nodeId: step.nodeId,
        kind: "result",
        label: nodeLabel(doc, step.nodeId),
        reached: resultCount === 1 ? completed : null,
        continued: null,
        skipped: null,
        left: null,
        dropoff: null,
        splits: false,
        laneLabel: null,
      });
    }
  }

  return { branching, steps, steepestNodeId: steepestStep(steps), typicalDropoff: typicalStepDropoff(steps) };
}

/**
 * Steepest RELATIVE drop among the steps enough shoppers reached. The Start
 * row counts: shoppers who press Start and answer nothing are a step's worth
 * of loss like any other. On a branching doc `steps` holds the path rows too.
 */
function steepestStep(steps: LedgerStep[]): string | null {
  let steepestNodeId: string | null = null;
  let steepest = 0;
  for (const s of steps) {
    if (s.dropoff == null || (s.reached ?? 0) < STEEPEST_MIN_REACHED) continue;
    if (s.dropoff > steepest) {
      steepest = s.dropoff;
      steepestNodeId = s.nodeId;
    }
  }
  return steepestNodeId;
}

// ── Branching docs: path-by-path counting (Data work 5b) ──────────────────
//
// A sequence (the spine, or one path) is a list of counted slots — each
// question, and each fork as ONE slot — plus uncounted rows (branch, email
// gate). A session's "furthest" slot in a sequence is the deepest slot it
// answered in, or past the end when it is known to have left the sequence
// forward (finished, or reached the join). Reached(i) = sessions whose
// furthest ≥ i: the same worst-case inference as the linear ledger, applied
// within each path's own shoppers. At a fork every session there is put on
// exactly ONE path (the one it answered in; else the one its answers route
// to; else the runtime's fallback), which is what makes the paths add up.

interface SessionAnswer {
  /** Location relative to the sequence being counted: [slot, path, slot, …]. */
  loc: number[];
  ts: number;
  skipped: boolean;
}

interface SeqSession {
  sid: string;
  /** The session is known to have gone past the end of this sequence. */
  pastEnd: boolean;
  answers: SessionAnswer[];
}

function isCountedSlot(it: FlowItem): boolean {
  return it.kind === "fork" || it.nodeType === "question";
}

/** Each item's counted-slot index (uncounted rows get the next slot's index). */
function slotIndexes(items: FlowItem[]): number[] {
  const slots: number[] = [];
  let n = 0;
  for (const it of items) {
    slots.push(n);
    if (isCountedSlot(it)) n += 1;
  }
  return slots;
}

function locateQuestions(items: FlowItem[], prefix: number[], into: Map<string, number[]>): void {
  const slots = slotIndexes(items);
  items.forEach((it, k) => {
    const idx = slots[k]!;
    if (it.kind === "fork") {
      it.fork.paths.forEach((p, pi) => locateQuestions(p.items, [...prefix, idx, pi], into));
    } else if (it.nodeType === "question") {
      into.set(it.nodeId, [...prefix, idx]);
    }
  });
}

interface RowCtx {
  pathId: string | null;
  letter: string | null;
  laneLabel: string | null;
}

function buildBranchingLedger(
  doc: QuizDoc,
  tree: FlowPathTree,
  events: LedgerEvent[],
  engaged: number,
  completed: number,
): StepLedger {
  const loc = new Map<string, number[]>();
  locateQuestions(tree.items, [], loc);

  // Last write wins per (session, question), keeping the answer ids: routing
  // a session that left no answer inside a fork needs what it picked.
  const last = new Map<string, Map<string, { ids: string[]; ts: number }>>();
  const done = new Set<string>();
  for (const e of events) {
    if (e.eventType === "quiz_completed") {
      done.add(e.sessionId);
      continue;
    }
    if (e.eventType !== "question_answered") continue;
    const p = e.payload as { question_id?: unknown; answer_ids?: unknown } | null;
    const qid = typeof p?.question_id === "string" ? p.question_id : null;
    if (!qid) continue;
    const ids = Array.isArray(p?.answer_ids)
      ? p.answer_ids.filter((x): x is string => typeof x === "string")
      : [];
    let per = last.get(e.sessionId);
    if (!per) {
      per = new Map();
      last.set(e.sessionId, per);
    }
    const prev = per.get(qid);
    if (!prev || e.ts >= prev.ts) per.set(qid, { ids, ts: e.ts });
  }
  const idsOf = (sid: string): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const [q, f] of last.get(sid) ?? []) m.set(q, f.ids);
    return m;
  };

  // The spine cohort: every session that answered a placed question or finished.
  const spine: SeqSession[] = [];
  for (const sid of new Set([...last.keys(), ...done])) {
    const answers: SessionAnswer[] = [];
    for (const [qid, f] of last.get(sid) ?? []) {
      const at = loc.get(qid);
      if (at) answers.push({ loc: at, ts: f.ts, skipped: f.ids.length === 0 });
    }
    if (answers.length > 0 || done.has(sid)) spine.push({ sid, pastEnd: done.has(sid), answers });
  }

  const answerText = new Map<string, string>();
  for (const n of doc.nodes) {
    if (n.type === "question") for (const a of n.data.answers) answerText.set(a.id, a.text);
  }

  const steps: LedgerStep[] = [];

  /** Count one sequence. Rows go to `steps` in flow order and come back too. */
  const countSeq = (
    items: FlowItem[],
    sessions: SeqSession[],
    ctx: RowCtx,
  ): { rows: LedgerStep[]; forks: LedgerFork[]; firstReached: number } => {
    const len = items.filter(isCountedSlot).length;
    const furthest = new Map<string, number>();
    for (const s of sessions) {
      let f = -1;
      for (const a of s.answers) f = Math.max(f, a.loc[0] ?? -1);
      furthest.set(s.sid, s.pastEnd ? len : f);
    }
    const reachedAt = (i: number): number => {
      let n = 0;
      for (const f of furthest.values()) if (f >= i) n += 1;
      return n;
    };
    const rows: LedgerStep[] = [];
    const forks: LedgerFork[] = [];
    const push = (r: LedgerStep): void => {
      rows.push(r);
      steps.push(r);
    };
    const tag = { laneLabel: ctx.laneLabel, pathId: ctx.pathId, pathLetter: ctx.letter };

    const slots = slotIndexes(items);
    for (const [k, it] of items.entries()) {
      const idx = slots[k]!;
      if (it.kind === "node") {
        if (it.nodeType === "question") {
          const reachedN = reachedAt(idx);
          const nextN = reachedAt(idx + 1);
          // A skip still continues; count skips only among those who moved on.
          let skipped = 0;
          for (const s of sessions) {
            if ((furthest.get(s.sid) ?? -1) < idx + 1) continue;
            if (s.answers.some((a) => a.loc.length === 1 && a.loc[0] === idx && a.skipped)) skipped += 1;
          }
          const left = Math.max(0, reachedN - nextN);
          push({
            nodeId: it.nodeId,
            kind: "question",
            label: nodeLabel(doc, it.nodeId),
            reached: reachedN,
            continued: Math.max(0, nextN - skipped),
            skipped,
            left,
            dropoff: reachedN > 0 ? left / reachedN : null,
            splits: false,
            ...tag,
          });
        } else if (it.nodeType === "branch" || it.nodeType === "email_gate") {
          // Branch: routing, never abandonment. Email gate: not measurable
          // until email_gate events ship (P2). Neither takes a counted slot.
          push({
            nodeId: it.nodeId,
            kind: it.nodeType,
            label: nodeLabel(doc, it.nodeId),
            reached: null,
            continued: null,
            skipped: null,
            left: null,
            dropoff: null,
            splits: it.nodeType === "branch",
            ...tag,
          });
        }
        continue;
      }

      // A fork: every session that got here takes exactly one path.
      const fork = it.fork;
      const perPath: SeqSession[][] = fork.paths.map(() => []);
      for (const s of sessions) {
        const f = furthest.get(s.sid) ?? -1;
        if (f < idx) continue;
        const inside = s.answers.filter((a) => a.loc[0] === idx && a.loc.length > 2);
        // Answered inside the fork: the path is observed. A back-nav that
        // switched paths keeps the LATEST one, so nobody counts twice.
        // Otherwise route the way the runtime would.
        const latest = inside.reduce<SessionAnswer | null>((best, a) => (!best || a.ts > best.ts ? a : best), null);
        const p = latest ? latest.loc[1] ?? 0 : routeFork(fork, idsOf(s.sid));
        const bucket = perPath[p] ?? perPath[0]!;
        bucket.push({
          sid: s.sid,
          pastEnd: f > idx,
          answers: inside.filter((a) => a.loc[1] === p).map((a) => ({ ...a, loc: a.loc.slice(2) })),
        });
      }
      const paths: LedgerPath[] = fork.paths.map((fp, pi) => {
        const pathId = `${fork.splitNodeId}:${fp.letter}`;
        const members = perPath[pi] ?? [];
        const child = countSeq(fp.items, members, {
          pathId,
          letter: fp.letter,
          laneLabel: fork.branchNodeId ? fp.slotLabel : null,
        });
        return {
          pathId,
          letter: fp.letter,
          entryAnswerIds: fp.entryAnswerIds,
          entryAnswerTexts: fp.entryAnswerIds.map((id) => answerText.get(id) ?? id),
          slotLabel: fp.slotLabel,
          shoppers: members.length,
          steps: child.rows,
          forks: child.forks,
          continue: members.filter((m) => m.pastEnd).length,
        };
      });
      forks.push({
        splitNodeId: fork.splitNodeId,
        branchNodeId: fork.branchNodeId,
        joinNodeId: fork.joinNodeId,
        started: reachedAt(idx),
        joined: reachedAt(idx + 1),
        paths,
      });
    }
    return { rows, forks, firstReached: reachedAt(0) };
  };

  // Intro row first (its loss is the gap to the first counted step, exactly as
  // on the linear ledger), then the walk, then the result rows.
  const introRow: LedgerStep | null = tree.introId
    ? {
        nodeId: tree.introId,
        kind: "intro",
        label: nodeLabel(doc, tree.introId),
        reached: engaged,
        continued: null,
        skipped: null,
        left: null,
        dropoff: null,
        splits: false,
        laneLabel: null,
        pathId: null,
        pathLetter: null,
      }
    : null;
  if (introRow) steps.push(introRow);
  const spineCount = countSeq(tree.items, spine, { pathId: null, letter: null, laneLabel: null });
  if (introRow) {
    const introLeft = Math.max(0, engaged - spineCount.firstReached);
    introRow.continued = spineCount.firstReached;
    introRow.left = introLeft;
    introRow.dropoff = engaged > 0 ? introLeft / engaged : null;
  }
  // quiz_completed is quiz-wide: only a SINGLE result row can carry it.
  const resultCount = doc.nodes.filter((n) => n.type === "result").length;
  for (const rid of tree.resultIds) {
    steps.push({
      nodeId: rid,
      kind: "result",
      label: nodeLabel(doc, rid),
      reached: resultCount === 1 ? completed : null,
      continued: null,
      skipped: null,
      left: null,
      dropoff: null,
      splits: false,
      laneLabel: null,
      pathId: null,
      pathLetter: null,
    });
  }

  return {
    branching: true,
    steps,
    steepestNodeId: steepestStep(steps),
    typicalDropoff: typicalStepDropoff(steps),
    paths: spineCount.forks,
  };
}

// ── Lookups for the Questions & Answers tab and the insights ──────────────

/** Every path in the ledger, nested ones included, each before its own nested paths. */
export function allLedgerPaths(ledger: StepLedger): LedgerPath[] {
  const found: LedgerPath[] = [];
  const visit = (forks: LedgerFork[]): void => {
    for (const f of forks) {
      for (const p of f.paths) {
        found.push(p);
        visit(p.forks);
      }
    }
  };
  visit(ledger.paths ?? []);
  return found;
}

/** The path with this id, or null. */
export function ledgerPathById(ledger: StepLedger, pathId: string): LedgerPath | null {
  return allLedgerPaths(ledger).find((p) => p.pathId === pathId) ?? null;
}

export interface QuestionPath {
  pathId: string;
  letter: string;
  /** The path's shoppers: the denominator for "426 of 453 on this path answered". */
  shoppers: number;
  entryAnswerTexts: string[];
  slotLabel: string | null;
}

/**
 * Which path a question belongs to, or null when every shopper sees it (a
 * shared spine question, or one the ledger does not place). A question in a
 * path that splits again belongs to the innermost path, and counts out of
 * that path's shoppers.
 */
export function questionPath(ledger: StepLedger, questionId: string): QuestionPath | null {
  const p = allLedgerPaths(ledger).find((x) => x.steps.some((s) => s.nodeId === questionId));
  if (!p) return null;
  return {
    pathId: p.pathId,
    letter: p.letter,
    shoppers: p.shoppers,
    entryAnswerTexts: p.entryAnswerTexts,
    slotLabel: p.slotLabel,
  };
}
