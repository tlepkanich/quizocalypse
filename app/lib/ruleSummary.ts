import type { DecisionRule, DecisionRuleCondition, Quiz } from "./quizSchema";
import type { BuilderCategory } from "../components/builder/stepProps";
import type { OrderedQuestion } from "./questionOrder";
import { orderedQuestions } from "./questionOrder";
import type { LogicStyle } from "./logicStyle";
import { ruleTargets } from "./recommendDecider";

/** Logic-step §3 — render a rule's conditions with the rule's OWN join
 *  words: `or` within an any_of column, `and` within an all-of column, and
 *  the rule's match join between questions. The one grouped describer every
 *  plain-language surface (AI copy prompts included) should use — a
 *  match:any rule must never read as a conjunction. `fmt` renders one
 *  condition ("Q is A" / "Q is not A"), so callers keep their own voice. */
export function describeRuleConditions(
  rule: Pick<DecisionRule, "conditions" | "match" | "any_of">,
  fmt: (c: DecisionRuleCondition) => string,
): string {
  const groups: { qid: string; conds: DecisionRuleCondition[] }[] = [];
  for (const c of rule.conditions) {
    const g = groups.find((x) => x.qid === c.question_id);
    if (g) g.conds.push(c);
    else groups.push({ qid: c.question_id, conds: [c] });
  }
  const anyOf = new Set(rule.any_of ?? []);
  const acrossWord = rule.match === "any" ? " or " : " and ";
  return groups
    .map((g) => {
      const withinWord = anyOf.has(g.qid) ? " or " : " and ";
      return g.conds.map(fmt).join(withinWord);
    })
    .join(acrossWord);
}

// Plain-language rule summary for confirm dialogs + the inline accordion:
// "If Q1 is Park AND Q2 is not Advanced → Pro Park Boards".
export function ruleSummary(
  conditions: DecisionRuleCondition[],
  targetId: string,
  questions: OrderedQuestion[],
  categories: BuilderCategory[],
): string {
  const parts = conditions.map((c) => {
    const q = questions.find((x) => x.node.id === c.question_id);
    const a = q?.node.data.answers.find((x) => x.id === c.answer_id);
    const qLabel = q ? `Q${q.qIndex}` : "(deleted question)";
    const aLabel = a?.text || "(deleted answer)";
    return `${qLabel} ${c.op === "is" ? "is" : "is not"} ${aLabel}`;
  });
  const target = categories.find((c) => c.id === targetId)?.name ?? "(deleted bucket)";
  return parts.length === 0
    ? `(no conditions yet) → ${target}`
    : `If ${parts.join(" AND ")} → ${target}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign (D17) — the ONE structured rule describer. Rule rows,
// the rule-window footer sentence, the Table's "When they answer" cell and
// the export all render from it. It reads the DOC's rule shape (conditions
// with per-row op, any_of, match) and its join words mean exactly what
// ruleConditionsMatch does. describeRuleConditions above stays byte-identical
// (it feeds AI prompts).
// ════════════════════════════════════════════════════════════════════════════

/** Marker text for a reference that no longer exists (never dropped). */
export const MISSING_ANSWER_TEXT = "(deleted answer)";

export interface RuleAnswerToken {
  answerId: string;
  /** The mock's ansText: a rating (scale) point reads "Q3 = 4"; any other
   *  answer reads its own text. MISSING_ANSWER_TEXT when deleted. */
  text: string;
  missing?: true;
}

export interface RuleGroupToken {
  questionId: string;
  /** Flow-order question number (the rail's "Qn"); null = question deleted. */
  qIndex: number | null;
  /** true = "not (A or B)": none of these answers (D12). */
  not: boolean;
  /** Inside the group: "and" = all of, "or" = any of. A negated group is
   *  always "or". */
  join: "and" | "or";
  /** D17: prefix the question label only when one of these answers' text
   *  also exists on another question (never on a scale — its answers
   *  already read "Qn = k"). */
  qLabel: boolean;
  answers: RuleAnswerToken[];
}

export interface RuleTokens {
  /** What the row's verb chip says (mock effVerb): always "show" in Rules
   *  only; otherwise prioritize → "pin", hide → "hide", show / absent →
   *  "show". */
  verb: "show" | "pin" | "hide";
  /** The stored action, untouched (absent = the legacy replace). */
  storedAction: DecisionRule["action"] | null;
  targetIds: string[];
  /** Join BETWEEN groups: "or" only for a stored match "any" (D13). */
  across: "and" | "or";
  /** In question flow order (deleted questions last). A question carrying
   *  both "is" and "is not" conditions (older rules) yields two groups, the
   *  "is" group first. */
  groups: RuleGroupToken[];
}

type QuestionNodeT = OrderedQuestion["node"];

const low = (t: string) => t.trim().toLowerCase();

interface DescribeCtx {
  ordered: OrderedQuestion[];
  byId: Map<string, OrderedQuestion>;
}

function ctxFor(doc: Quiz): DescribeCtx {
  const ordered = orderedQuestions(doc);
  return { ordered, byId: new Map(ordered.map((q) => [q.node.id, q])) };
}

function isScale(q: QuestionNodeT): boolean {
  return q.data.question_type === "rating";
}

/** The Table / export form of one answer (mock ansMach): always "Qn = text",
 *  for every type. Missing references render as markers. */
export function answerMachineText(doc: Quiz, questionId: string, answerId: string): string {
  return machineText(ctxFor(doc), questionId, answerId);
}

function machineText(ctx: DescribeCtx, questionId: string, answerId: string): string {
  const q = ctx.byId.get(questionId);
  const a = q?.node.data.answers.find((x) => x.id === answerId);
  return `${q ? `Q${q.qIndex}` : "Q?"} = ${a ? a.text : MISSING_ANSWER_TEXT}`;
}

function groupsOf(rule: Pick<DecisionRule, "conditions" | "any_of">, ctx: DescribeCtx) {
  const anyOf = new Set(rule.any_of ?? []);
  const qids = [...new Set(rule.conditions.map((c) => c.question_id))];
  const pos = (qid: string) => ctx.byId.get(qid)?.qIndex ?? Number.MAX_SAFE_INTEGER;
  const sorted = qids
    .map((qid, i) => ({ qid, i }))
    .sort((a, b) => pos(a.qid) - pos(b.qid) || a.i - b.i)
    .map((x) => x.qid);
  const out: Array<{ qid: string; not: boolean; join: "and" | "or"; answerIds: string[] }> = [];
  for (const qid of sorted) {
    const q = ctx.byId.get(qid);
    const order = (aid: string) => {
      const i = q?.node.data.answers.findIndex((a) => a.id === aid) ?? -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const ids = (op: "is" | "is_not") =>
      [
        ...new Set(
          rule.conditions
            .filter((c) => c.question_id === qid && c.op === op)
            .map((c) => c.answer_id),
        ),
      ]
        .map((aid, i) => ({ aid, i }))
        .sort((a, b) => order(a.aid) - order(b.aid) || a.i - b.i)
        .map((x) => x.aid);
    const is = ids("is");
    const not = ids("is_not");
    if (is.length) {
      out.push({ qid, not: false, join: is.length > 1 && !anyOf.has(qid) ? "and" : "or", answerIds: is });
    }
    if (not.length) out.push({ qid, not: true, join: "or", answerIds: not });
  }
  return out;
}

/** D17 — the structured rule: verb (effVerb), targets, and the question
 *  groups with their joins, in question order. `style` is the SCREEN style
 *  the rule is drawn in (resolveLogicStyle). */
export function describeRuleTokens(
  rule: DecisionRule,
  doc: Quiz,
  style: LogicStyle,
): RuleTokens {
  const ctx = ctxFor(doc);
  const groups: RuleGroupToken[] = groupsOf(rule, ctx).map((g) => {
    const q = ctx.byId.get(g.qid);
    const answers: RuleAnswerToken[] = g.answerIds.map((aid) => {
      const a = q?.node.data.answers.find((x) => x.id === aid);
      if (!q || !a) return { answerId: aid, text: MISSING_ANSWER_TEXT, missing: true };
      return { answerId: aid, text: isScale(q.node) ? `Q${q.qIndex} = ${a.text}` : a.text };
    });
    const dup =
      !!q &&
      !isScale(q.node) &&
      g.answerIds.some((aid) => {
        const a = q.node.data.answers.find((x) => x.id === aid);
        if (!a) return false;
        const t = low(a.text);
        return ctx.ordered.some(
          (other) => other.node.id !== q.node.id && other.node.data.answers.some((x) => low(x.text) === t),
        );
      });
    return {
      questionId: g.qid,
      qIndex: q?.qIndex ?? null,
      not: g.not,
      join: g.join,
      qLabel: dup,
      answers,
    };
  });
  const verb: RuleTokens["verb"] =
    style === "rules"
      ? "show"
      : rule.action === "prioritize"
        ? "pin"
        : rule.action === "hide"
          ? "hide"
          : "show";
  return {
    verb,
    storedAction: rule.action ?? null,
    targetIds: ruleTargets(rule),
    across: rule.match === "any" ? "or" : "and",
    groups,
  };
}

/** The machine form of a rule's conditions (mock whenText) for the Table and
 *  the export: `Q1 = X AND (Q2 = A OR Q2 = B)`, a negated group always in
 *  brackets `NOT (Q3 = C)`; a stored match "any" joins groups with OR (D13).
 *  "(no answers)" when the rule has no conditions. */
export function ruleWhenMachine(
  rule: Pick<DecisionRule, "conditions" | "any_of" | "match">,
  doc: Quiz,
): string {
  const ctx = ctxFor(doc);
  const parts = groupsOf(rule, ctx).map((g) => {
    const ans = g.answerIds.map((aid) => machineText(ctx, g.qid, aid));
    const body =
      ans.length > 1 || g.not ? `(${ans.join(` ${g.join.toUpperCase()} `)})` : ans[0]!;
    return (g.not ? "NOT " : "") + body;
  });
  if (parts.length === 0) return "(no answers)";
  return parts.join(rule.match === "any" ? " OR " : " AND ");
}
