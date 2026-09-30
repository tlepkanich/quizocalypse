// Logic step redesign (Phase 1) — the question-logic Undo pair (D7/D9), the
// one role-change path (D9), the canonical rule shape (D12/D13) and the
// cross-question "or" split (D13). Pure. Document mutations are
// logic_model-gated (a legacy doc comes back as the same object); the two
// rule-shape helpers take a rule, not a doc, and are never written to a
// legacy doc by construction (only decider mutations store rules).
// Imports concrete modules, never the quizMutations barrel.
import { isFreeformType } from "../quizSchema";
import type { Answer, DecisionRule, QuizNode } from "../quizSchema";
import { orderedQuestions } from "../questionOrder";
import { answerTargets } from "../recommendDecider";
import { moveDecider, setQuestionRole } from "./deciderMutations";
import type { QuizDoc } from "./shared";

type QuestionNodeDoc = Extract<QuizNode, { type: "question" }>;
type QuestionRole = "decides" | "filter" | "qualifier";

// ── Snapshot / restore (the inverse for D9 role moves and type changes) ────

/** Every answer key a question's LOGIC job stores: the picking targets and
 *  the narrowing values. */
const TARGET_KEYS = ["target_id", "target_ids"] as const;
const VALUE_KEYS = [
  "tags",
  "collection_filter",
  "collection_filters",
  "metafield_filters",
  "variant_filters",
  "product_type_filters",
  "no_preference",
] as const;
type AnswerLogicKey = (typeof TARGET_KEYS)[number] | (typeof VALUE_KEYS)[number];
export type AnswerLogicParts = Pick<Answer, AnswerLogicKey>;

export interface QuestionLogicSnapshot {
  questions: Array<{
    nodeId: string;
    /** undefined = the key was absent (Info by default). */
    role: QuestionRole | undefined;
    required: boolean;
    /** undefined = the key was absent. */
    narrow_field: string | undefined;
    answers: Array<{ answerId: string; parts: AnswerLogicParts }>;
  }>;
}

function pickAnswerParts(a: Answer): AnswerLogicParts {
  const out: Record<string, unknown> = {};
  for (const k of [...TARGET_KEYS, ...VALUE_KEYS]) {
    if (a[k] !== undefined) out[k] = structuredClone(a[k]);
  }
  return out as AnswerLogicParts;
}

/** D7/D9 — capture, by node and answer id, what a role move or type change
 *  can clear on these questions: role, required, narrow_field, and every
 *  answer's targets (target_id / target_ids) and filter values. Unknown or
 *  non-question ids are skipped. Read-only (works on any doc). */
export function snapshotQuestionLogic(
  doc: QuizDoc,
  nodeIds: readonly string[],
): QuestionLogicSnapshot {
  const wanted = new Set(nodeIds);
  const questions: QuestionLogicSnapshot["questions"] = [];
  for (const n of doc.nodes) {
    if (n.type !== "question" || !wanted.has(n.id)) continue;
    questions.push({
      nodeId: n.id,
      role: n.data.role,
      required: n.data.required,
      narrow_field: n.data.narrow_field,
      answers: n.data.answers.map((a) => ({ answerId: a.id, parts: pickAnswerParts(a) })),
    });
  }
  return { questions };
}

/** Key-order-insensitive JSON (the unpublishedChanges comparison). */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

function restoreAnswer(a: Answer, parts: AnswerLogicParts): Answer {
  const next: Record<string, unknown> = { ...a };
  for (const k of [...TARGET_KEYS, ...VALUE_KEYS]) delete next[k];
  for (const [k, v] of Object.entries(parts)) next[k] = structuredClone(v);
  // `tags` is a defaulted schema field — always present on a parsed answer.
  if (next.tags === undefined) next.tags = [];
  return next as Answer;
}

/** The inverse of snapshotQuestionLogic: writes back each captured
 *  question's role, required, narrow_field and every captured answer's
 *  targets + filter values, matched by id against the LATEST doc (questions
 *  or answers deleted since are skipped; answers added since are left alone).
 *  Rules are never touched. Returns the input doc when nothing changes. */
export function restoreQuestionLogic(
  doc: QuizDoc,
  snapshot: QuestionLogicSnapshot,
): QuizDoc {
  if (doc.logic_model !== "decider") return doc;
  const byId = new Map(snapshot.questions.map((q) => [q.nodeId, q]));
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    if (n.type !== "question") return n;
    const snap = byId.get(n.id);
    if (!snap) return n;
    const partsById = new Map(snap.answers.map((a) => [a.answerId, a.parts]));
    const { role: _r, narrow_field: _nf, ...rest } = n.data;
    const data: QuestionNodeDoc["data"] = {
      ...rest,
      ...(snap.role !== undefined ? { role: snap.role } : {}),
      required: snap.required,
      ...(snap.narrow_field !== undefined ? { narrow_field: snap.narrow_field } : {}),
      answers: n.data.answers.map((a) => {
        const parts = partsById.get(a.id);
        return parts ? restoreAnswer(a, parts) : a;
      }),
    };
    if (sortedJson(data) === sortedJson(n.data)) return n;
    changed = true;
    return { ...n, data };
  });
  return changed ? { ...doc, nodes } : doc;
}

// ── The one role-change path (D9) ────────────────────────────────────────────

export interface RoleChangeLoss {
  /** Recommendations (answer targets) the move removed, and whose. */
  targets?: { nodeId: string; count: number };
  /** Filter values (+ "Keeps everything") leaving Narrows removed. */
  values?: { nodeId: string; count: number };
}

function answerValueCount(a: Answer): number {
  return (
    a.tags.length +
    (a.collection_filter ? 1 : 0) +
    (a.collection_filters?.length ?? 0) +
    (a.metafield_filters?.length ?? 0) +
    (a.variant_filters?.length ?? 0) +
    (a.product_type_filters?.length ?? 0) +
    (a.no_preference ? 1 : 0)
  );
}

function mapQuestionAnswers(
  doc: QuizDoc,
  nodeId: string,
  fn: (a: Answer) => Answer,
): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId && n.type === "question"
        ? { ...n, data: { ...n.data, answers: n.data.answers.map(fn) } }
        : n,
    ),
  };
}

function clearTargets(a: Answer): Answer {
  if (!("target_id" in a) && !("target_ids" in a)) return a;
  const { target_id: _t, target_ids: _ts, ...rest } = a;
  return rest;
}

function clearValues(a: Answer): Answer {
  const {
    collection_filter: _cf,
    collection_filters: _cfs,
    metafield_filters: _mf,
    variant_filters: _vf,
    product_type_filters: _ptf,
    no_preference: _np,
    ...rest
  } = a;
  return { ...rest, tags: [] };
}

/** D9 — ONE path for a role change from the role menu, the Table and Import.
 *  One policy (mock `moveRole`): a question that gives up a job gives up
 *  what that job stored on its answers.
 *   · → "decides": runs moveDecider (its locked rule: the old picking
 *     question demotes to qualifier and BOTH questions' answer targets are
 *     cleared; required is forced on). `lost.targets` names the OLD picking
 *     question and how many targets it lost.
 *   · → "filter" / "qualifier": runs setQuestionRole, then clears this
 *     question's own answer targets (a picking question leaving the job, or
 *     stale hidden ones); `lost.targets` counts them when there were any.
 *   · leaving "filter": this question's filter values and "Keeps
 *     everything" are cleared too; `lost.values` counts them.
 *  Rules are never touched (they surface through the analyzer). Capture
 *  `snapshotQuestionLogic(doc, [nodeId, oldPickerId])` BEFORE calling; its
 *  restoreQuestionLogic is the Undo. Refusals (unknown node, freeform type
 *  to decides, legacy doc, same role) return the input doc and `lost: {}`. */
export function changeQuestionRole(
  doc: QuizDoc,
  nodeId: string,
  role: QuestionRole,
): { doc: QuizDoc; lost: RoleChangeLoss } {
  const same = { doc, lost: {} };
  if (doc.logic_model !== "decider") return same;
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "question") return same;
  const current: QuestionRole = node.data.role ?? "qualifier";
  if (current === role) return same;
  if (role === "decides" && isFreeformType(node.data.question_type)) return same;

  const lost: RoleChangeLoss = {};
  let next: QuizDoc;
  if (role === "decides") {
    const old = doc.nodes.find(
      (n): n is QuestionNodeDoc =>
        n.type === "question" && n.data.role === "decides" && n.id !== nodeId,
    );
    next = moveDecider(doc, nodeId);
    if (next === doc) return same;
    const count = old
      ? old.data.answers.reduce((s, a) => s + answerTargets(a).length, 0)
      : 0;
    if (old && count > 0) lost.targets = { nodeId: old.id, count };
  } else {
    next = setQuestionRole(doc, nodeId, role);
    if (next === doc) return same;
    const count = node.data.answers.reduce((s, a) => s + answerTargets(a).length, 0);
    if (count > 0) {
      next = mapQuestionAnswers(next, nodeId, clearTargets);
      lost.targets = { nodeId, count };
    }
  }
  if (current === "filter") {
    const count = node.data.answers.reduce((s, a) => s + answerValueCount(a), 0);
    next = mapQuestionAnswers(next, nodeId, clearValues);
    if (count > 0) lost.values = { nodeId, count };
  }
  return { doc: next, lost };
}

// ── The canonical stored rule shape (rule window save, Import, Paste) ────────

/** The stored shape of a rule (mock `tidy`/`fitDraft`, D12, G1):
 *   · duplicate conditions and duplicate targets are removed;
 *   · conditions sort by question flow order, then answer order (unknown
 *     questions/answers keep their relative order, last) — never dropped;
 *   · `any_of` keeps a question only when its "is" group has 2+ answers;
 *     an all-"is not" group (and a group of one) never sits in `any_of`
 *     (D12: "is not" means none of these; any_of only relaxes "is");
 *   · a non-multi-select question with 2+ "is" answers is ALWAYS any-of
 *     (one answer is recorded there, so all-of could never match);
 *   · all-of survives only on a multi-select with 2+ "is" picks (kept as
 *     stored); a mixed is / is-not group keeps its stored any_of membership
 *     (its "is" half's meaning is preserved);
 *   · targets follow the G1 mirror: one → `target_id` alone, more →
 *     `target_ids` with `target_id` = its first;
 *   · `action` and a stored `match: "any"` are preserved untouched (D13);
 *     `match: "all"` is the default and is stored absent.
 *  Pure; returns a new rule object. */
export function normalizeDecisionRule(
  ruleIn: DecisionRule,
  doc: QuizDoc,
): DecisionRule {
  const ordered = orderedQuestions(doc);
  const qPos = new Map(ordered.map((q, i) => [q.node.id, i]));
  const qNode = new Map(ordered.map((q) => [q.node.id, q.node]));
  const aPos = (qid: string, aid: string) =>
    qNode.get(qid)?.data.answers.findIndex((a) => a.id === aid) ?? -1;

  const seen = new Set<string>();
  const conditions = ruleIn.conditions
    .filter((c) => {
      const key = `${c.question_id}\u0000${c.answer_id}\u0000${c.op}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      const qx = qPos.get(x.c.question_id) ?? Number.MAX_SAFE_INTEGER;
      const qy = qPos.get(y.c.question_id) ?? Number.MAX_SAFE_INTEGER;
      if (qx !== qy) return qx - qy;
      if (x.c.question_id !== y.c.question_id) return x.i - y.i;
      const ax = aPos(x.c.question_id, x.c.answer_id);
      const ay = aPos(y.c.question_id, y.c.answer_id);
      const kx = ax < 0 ? Number.MAX_SAFE_INTEGER : ax;
      const ky = ay < 0 ? Number.MAX_SAFE_INTEGER : ay;
      return kx - ky || x.i - y.i;
    })
    .map(({ c }) => ({ ...c }));

  const storedAnyOf = new Set(ruleIn.any_of ?? []);
  const groupIds = [...new Set(conditions.map((c) => c.question_id))];
  const anyOf = groupIds.filter((qid) => {
    const conds = conditions.filter((c) => c.question_id === qid);
    const isCount = conds.filter((c) => c.op === "is").length;
    const hasNot = conds.some((c) => c.op === "is_not");
    if (isCount < 2) return false;
    if (hasNot) return storedAnyOf.has(qid);
    const node = qNode.get(qid);
    if (!node) return storedAnyOf.has(qid);
    if (node.data.question_type !== "multi_select") return true;
    return storedAnyOf.has(qid);
  });

  const targets = [...new Set(ruleIn.target_ids?.length ? ruleIn.target_ids : [ruleIn.target_id])];
  const {
    target_ids: _ts,
    any_of: _ao,
    match: _m,
    conditions: _c,
    ...rest
  } = ruleIn;
  return {
    ...rest,
    conditions,
    ...(ruleIn.match === "any" ? { match: "any" as const } : {}),
    ...(anyOf.length ? { any_of: anyOf } : {}),
    target_id: targets[0]!,
    ...(targets.length > 1 ? { target_ids: targets } : {}),
  };
}

/** D13 — a `match: "any"` rule spanning 2+ question groups becomes adjacent
 *  rules, one per group (first-appearance order), each with a fresh id from
 *  `makeId`, the same action and targets, its group's `any_of` membership,
 *  and no `match` key. Under first-match-wins the set behaves identically.
 *  Any other rule comes back as `[rule]` (the same object). Pure; the paste
 *  parser (rulePaste.ts) stays frozen — call this on its output. */
export function splitCrossQuestionOr(
  rule: DecisionRule,
  makeId: () => string,
): DecisionRule[] {
  if (rule.match !== "any") return [rule];
  const groupIds = [...new Set(rule.conditions.map((c) => c.question_id))];
  if (groupIds.length < 2) return [rule];
  const { match: _m, any_of: _ao, conditions: _c, id: _id, ...rest } = rule;
  return groupIds.map((qid) => ({
    ...rest,
    id: makeId(),
    conditions: rule.conditions
      .filter((c) => c.question_id === qid)
      .map((c) => ({ ...c })),
    ...(rest.target_ids ? { target_ids: [...rest.target_ids] } : {}),
    ...(rule.any_of?.includes(qid) ? { any_of: [qid] } : {}),
  }));
}
