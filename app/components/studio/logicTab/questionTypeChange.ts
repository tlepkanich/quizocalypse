import type { Answer, QuestionType, Quiz } from "../../../lib/quizSchema";
import { addAnswer, removeAnswer, setQuestionType } from "../../../lib/quizMutations";

// ════════════════════════════════════════════════════════════════════════════
// The question-type change, ONE implementation for the Questions step's type
// chip (TypeChipSelector) and the Logic step's Question type popover.
//
// D10 is OPEN (what a type change does to answers and to the rules that
// referenced them). Until the owner rules, the live TypeChipSelector
// semantics stand: a card-to-card change keeps every answer, mapping and
// route; Five-point stamps scale_config {min: 1, max: 5} and keeps the
// answers; only the points stepper adds or removes answers. The Logic step
// adds only what the handoff settles: leaving Multi-select clears the pick
// bounds and turns that question's all-of rules into any-of (announced).
// Every removal goes through `setScalePoints`, the ONE removal seam, so the
// D10 ruling lands as copy plus one branch here.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;
type QuestionNodeDoc = Extract<QuizDoc["nodes"][number], { type: "question" }>;

/** A type pick: a stored type, or the Five-point preset of `rating`. */
export type TypePick = QuestionType | "rating5";

/** The most points a scale can have (the points stepper's range is 2–10). */
export const SCALE_MAX_POINTS = 10;
export const SCALE_MIN_POINTS = 2;

function questionNode(doc: QuizDoc, nodeId: string): QuestionNodeDoc | null {
  const n = doc.nodes.find((x) => x.id === nodeId);
  return n && n.type === "question" ? n : null;
}

function patchNode(
  doc: QuizDoc,
  nodeId: string,
  fn: (data: QuestionNodeDoc["data"]) => QuestionNodeDoc["data"],
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId && n.type === "question" ? { ...n, data: fn(n.data) } : n,
    ),
  };
}

/** The Questions step's reading: rating carrying the 1–5 preset. */
export function hasFivePointPreset(data: QuestionNodeDoc["data"]): boolean {
  return (
    data.question_type === "rating" &&
    data.scale_config?.min === 1 &&
    data.scale_config?.max === 5
  );
}

/** The Logic step's reading (mock isFive): the preset AND exactly 5 points,
 *  so a 2-answer question never reads "Five-point scale". */
export function isFivePointScale(data: QuestionNodeDoc["data"]): boolean {
  return hasFivePointPreset(data) && data.answers.length === 5;
}

/** Multi-select pick bounds as the runtime reads them (TypeChipSelector). */
export function multiBounds(data: QuestionNodeDoc["data"]): { min: number; max: number } {
  const n = data.answers.length;
  const min = Math.max(1, Math.min(data.min_selections ?? 1, n));
  const max = Math.max(min, Math.min(data.max_selections ?? n, n));
  return { min, max };
}

/** The live type pick (TypeChipSelector `apply`, moved here unchanged):
 *  setQuestionType keeps the answers; Five-point stamps the 1–5 preset over
 *  the existing scale_config; a plain Scale pick clears scale_config. */
export function pickQuestionType(doc: QuizDoc, nodeId: string, pick: TypePick): QuizDoc {
  const storedType: QuestionType = pick === "rating5" ? "rating" : pick;
  const next = setQuestionType(doc, nodeId, storedType);
  return {
    ...next,
    nodes: next.nodes.map((n) =>
      n.id === nodeId && n.type === "question"
        ? {
            ...n,
            data: {
              ...n.data,
              ...(pick === "rating5"
                ? { scale_config: { ...(n.data.scale_config ?? {}), min: 1, max: 5 } }
                : storedType === "rating"
                  ? { scale_config: undefined }
                  : {}),
            },
          }
        : n,
    ),
  };
}

/** Rule ids whose "is" group on `nodeId` needs ALL of 2+ answers (no "is
 *  not" on it, not listed in any_of): the rules a non-multi type breaks. */
export function allOfRuleIds(doc: QuizDoc, nodeId: string): string[] {
  const out: string[] = [];
  for (const r of doc.decision_rules ?? []) {
    const conds = r.conditions.filter((c) => c.question_id === nodeId);
    if (conds.some((c) => c.op === "is_not")) continue;
    if (conds.filter((c) => c.op === "is").length < 2) continue;
    if ((r.any_of ?? []).includes(nodeId)) continue;
    out.push(r.id);
  }
  return out;
}

/** What a Logic type change can take back (the Undo's inverse). */
export interface TypeSnapshot {
  nodeId: string;
  question_type: QuestionType;
  min_selections: number | undefined;
  max_selections: number | undefined;
  scale_config: QuestionNodeDoc["data"]["scale_config"];
}

export function snapshotType(doc: QuizDoc, nodeId: string): TypeSnapshot | null {
  const node = questionNode(doc, nodeId);
  if (!node) return null;
  return {
    nodeId,
    question_type: node.data.question_type,
    min_selections: node.data.min_selections,
    max_selections: node.data.max_selections,
    scale_config: node.data.scale_config ? structuredClone(node.data.scale_config) : undefined,
  };
}

/** The Logic step's type change: the live pick, plus (leaving Multi-select)
 *  the pick bounds cleared and this question's all-of rules turned any-of.
 *  Picking the current type returns the input doc. Decider docs only. */
export function changeQuestionType(
  doc: QuizDoc,
  nodeId: string,
  pick: TypePick,
): { doc: QuizDoc; anyOfRuleIds: string[] } {
  const same = { doc, anyOfRuleIds: [] };
  if (doc.logic_model !== "decider") return same;
  const node = questionNode(doc, nodeId);
  if (!node) return same;
  const current: TypePick = isFivePointScale(node.data) ? "rating5" : node.data.question_type;
  if (pick === current) return same;
  const storedType: QuestionType = pick === "rating5" ? "rating" : pick;
  if (storedType === "rating" && node.data.answers.length > SCALE_MAX_POINTS) return same;
  let next = pickQuestionType(doc, nodeId, pick);
  let anyOfRuleIds: string[] = [];
  if (node.data.question_type === "multi_select" && storedType !== "multi_select") {
    next = patchNode(next, nodeId, (data) => {
      const { min_selections: _min, max_selections: _max, ...rest } = data;
      return rest;
    });
    anyOfRuleIds = allOfRuleIds(next, nodeId);
    if (anyOfRuleIds.length) {
      const ids = new Set(anyOfRuleIds);
      next = {
        ...next,
        decision_rules: (next.decision_rules ?? []).map((r) =>
          ids.has(r.id) ? { ...r, any_of: [...(r.any_of ?? []), nodeId] } : r,
        ),
      };
    }
  }
  return { doc: next, anyOfRuleIds };
}

/** The inverse of changeQuestionType against the LATEST doc: the type fields
 *  come back and the listed rules drop this question from any_of again.
 *  Answers are never touched (a card-to-card change keeps them). */
export function restoreQuestionType(
  doc: QuizDoc,
  snap: TypeSnapshot,
  anyOfRuleIds: readonly string[],
): QuizDoc {
  if (!questionNode(doc, snap.nodeId)) return doc;
  let next = patchNode(doc, snap.nodeId, (data) => {
    const { min_selections: _min, max_selections: _max, scale_config: _sc, ...rest } = data;
    return {
      ...rest,
      question_type: snap.question_type,
      ...(snap.min_selections !== undefined ? { min_selections: snap.min_selections } : {}),
      ...(snap.max_selections !== undefined ? { max_selections: snap.max_selections } : {}),
      ...(snap.scale_config ? { scale_config: structuredClone(snap.scale_config) } : {}),
    };
  });
  if (anyOfRuleIds.length) {
    const ids = new Set(anyOfRuleIds);
    next = {
      ...next,
      decision_rules: (next.decision_rules ?? []).map((r) => {
        if (!ids.has(r.id) || !r.any_of) return r;
        const any_of = r.any_of.filter((q) => q !== snap.nodeId);
        const { any_of: _a, ...rest } = r;
        return any_of.length ? { ...rest, any_of } : rest;
      }),
    };
  }
  return next;
}

/** A point the stepper took off, enough to put it back exactly. */
export interface RemovedPoint {
  nodeId: string;
  answer: Answer;
  index: number;
  edges: QuizDoc["edges"];
  /** scale_config.max before the removal (kept in step by the stepper). */
  scaleMax: number | undefined;
}

/** The points stepper (TypeChipSelector `setScaleCount`, moved here): grow
 *  appends an answer named by its number; shrink removes the LAST point and
 *  its handle edges (removeAnswer refuses below 2). scale_config.max stays in
 *  step when present. One point per call. */
export function setScalePoints(
  doc: QuizDoc,
  nodeId: string,
  count: number,
): { doc: QuizDoc; removed: RemovedPoint | null } {
  const node = questionNode(doc, nodeId);
  const same = { doc, removed: null };
  if (!node) return same;
  const answers = node.data.answers;
  const now = answers.length;
  if (count === now || count < SCALE_MIN_POINTS || count > SCALE_MAX_POINTS) return same;
  let next: QuizDoc;
  let removed: RemovedPoint | null = null;
  if (count > now) {
    const before = new Set(answers.map((a) => a.id));
    next = addAnswer(doc, nodeId);
    next = patchNode(next, nodeId, (data) => ({
      ...data,
      answers: data.answers.map((a) => (before.has(a.id) ? a : { ...a, text: String(now + 1) })),
    }));
  } else {
    const last = answers[now - 1];
    if (!last) return same;
    next = removeAnswer(doc, nodeId, last.id);
    if (next === doc) return same;
    removed = {
      nodeId,
      answer: structuredClone(last),
      index: now - 1,
      edges: doc.edges.filter((e) => e.source === nodeId && e.source_handle === last.edge_handle_id),
      scaleMax: node.data.scale_config?.max,
    };
  }
  if (node.data.scale_config?.max !== undefined) {
    const target = count > now ? now + 1 : now - 1;
    next = patchNode(next, nodeId, (data) => ({
      ...data,
      scale_config: { ...(data.scale_config ?? {}), max: target },
    }));
  }
  return { doc: next, removed };
}

/** The inverse of a point removal: the answer comes back with the same id,
 *  handle, targets and values at its old position, with its handle edges,
 *  so rule conditions that pointed at it heal. */
export function restoreScalePoint(doc: QuizDoc, removed: RemovedPoint): QuizDoc {
  const node = questionNode(doc, removed.nodeId);
  if (!node || node.data.answers.some((a) => a.id === removed.answer.id)) return doc;
  let next = patchNode(doc, removed.nodeId, (data) => {
    const answers = [...data.answers];
    answers.splice(Math.min(removed.index, answers.length), 0, structuredClone(removed.answer));
    return {
      ...data,
      answers,
      ...(removed.scaleMax !== undefined
        ? { scale_config: { ...(data.scale_config ?? {}), max: removed.scaleMax } }
        : {}),
    };
  });
  const have = new Set(next.edges.map((e) => e.id));
  const back = removed.edges.filter((e) => !have.has(e.id));
  if (back.length) next = { ...next, edges: [...next.edges, ...back] };
  return next;
}

/** Rules (1-based numbers) that need more answers of this multi-select than
 *  a shopper may pick (all-of groups, never "is not", D12). */
export function overMaxRules(doc: QuizDoc, nodeId: string): Array<{ number: number; needs: number }> {
  const node = questionNode(doc, nodeId);
  if (!node || node.data.question_type !== "multi_select") return [];
  const { max } = multiBounds(node.data);
  const out: Array<{ number: number; needs: number }> = [];
  (doc.decision_rules ?? []).forEach((r, i) => {
    const conds = r.conditions.filter((c) => c.question_id === nodeId);
    if (conds.some((c) => c.op === "is_not")) return;
    if ((r.any_of ?? []).includes(nodeId)) return;
    const needs = new Set(conds.filter((c) => c.op === "is").map((c) => c.answer_id)).size;
    if (needs > max) out.push({ number: i + 1, needs });
  });
  return out;
}
