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
// - Branch docs get per-lane answered counts, labeled "splits by answer",
//   with NO cross-lane drop-off claims (§8.6: two renderings).
// - Drop-off is RELATIVE: left ÷ reached-this-step, never over total starts.
//
// Pure: no DB, no React. The loader feeds distinct-session event rows.

import type { Quiz as QuizDoc } from "./quizSchema";
import { orderFlow } from "./flowOrder";

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
}

export interface StepLedger {
  /** True ⇒ the doc branches; per-lane rows carry answered counts only. */
  branching: boolean;
  steps: LedgerStep[];
  /** nodeId of the steepest RELATIVE drop among question rows (linear only). */
  steepestNodeId: string | null;
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
      return n.data.headline || "Email gate";
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
  const flow = orderFlow(doc);
  const answers = lastAnswers(events);
  const branching = flow.branches.some((l) => l.steps.length > 0);

  const sessionsAt = (qid: string): Map<string, AnswerFact> => answers.get(qid) ?? new Map();

  // Linear spine: cumulative reach from the tail. reached(k) = answered(k) ∪
  // reached(k+1); the tail seeds from completion (measured, not inferred).
  const spineQuestionIds = flow.steps
    .filter((s) => s.type === "question")
    .map((s) => s.nodeId);

  const reachedSets = new Map<string, Set<string>>();
  if (!branching) {
    let tail = new Set<string>(); // sessions known to be past the last question
    // Seed with completed sessions via quiz_completed events.
    for (const e of events) {
      if (e.eventType === "quiz_completed") tail.add(e.sessionId);
    }
    for (let i = spineQuestionIds.length - 1; i >= 0; i--) {
      const qid = spineQuestionIds[i]!;
      const set = new Set(tail);
      for (const sid of sessionsAt(qid).keys()) set.add(sid);
      reachedSets.set(qid, set);
      tail = set;
    }
  }

  const steps: LedgerStep[] = [];

  // quiz_completed is quiz-wide, so `completed` is only attributable to a
  // SINGLE result row. Multi-result (legacy personality) docs get no per-result
  // reach claim here — the outcome distribution section owns that split.
  const resultCount = doc.nodes.filter((n) => n.type === "result").length;

  // Intro row — engage is measured (clicked Start).
  if (flow.introId) {
    steps.push({
      nodeId: flow.introId,
      kind: "intro",
      label: nodeLabel(doc, flow.introId),
      reached: engaged,
      continued: null,
      skipped: null,
      left: null,
      dropoff: null,
      splits: false,
      laneLabel: null,
    });
  }

  const pushQuestion = (nodeId: string, laneLabel: string | null): void => {
    const perSession = sessionsAt(nodeId);
    if (branching || laneLabel) {
      // Branch rendering: answered counts only — no reach inference across lanes.
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
    const idx = spineQuestionIds.indexOf(nodeId);
    const reached = reachedSets.get(nodeId) ?? new Set<string>();
    const nextQid = spineQuestionIds[idx + 1];
    // The pool past this step: the next question's reach, or completions after
    // the last question.
    const nextReached: Set<string> = nextQid
      ? reachedSets.get(nextQid) ?? new Set()
      : new Set(events.filter((e) => e.eventType === "quiz_completed").map((e) => e.sessionId));
    let skipped = 0;
    for (const [sid, f] of perSession) {
      if (f.skipped && nextReached.has(sid)) skipped += 1;
    }
    const left = Math.max(0, reached.size - nextReached.size);
    const continued = Math.max(0, nextReached.size - skipped);
    steps.push({
      nodeId,
      kind: "question",
      label: nodeLabel(doc, nodeId),
      reached: reached.size,
      continued,
      skipped,
      left,
      dropoff: reached.size > 0 ? left / reached.size : null,
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

  // Steepest RELATIVE drop among linear question rows.
  let steepestNodeId: string | null = null;
  let steepest = 0;
  for (const s of steps) {
    if (s.kind === "question" && s.dropoff != null && s.dropoff > steepest) {
      steepest = s.dropoff;
      steepestNodeId = s.nodeId;
    }
  }

  return { branching, steps, steepestNodeId };
}
