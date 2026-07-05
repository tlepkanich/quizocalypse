import { useEffect, useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc, DecisionRuleCondition } from "../../../lib/quizSchema";
import { isFreeformType } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import {
  addDecisionRule,
  removeDecisionRule,
  moveDecisionRule,
  updateDecisionRule,
} from "../../../lib/quizMutations";
import {
  deadRules,
  shadowedRules,
  halfBuiltRules,
  brokenRuleRefs,
  ruleMatchEstimates,
} from "../../../lib/pathAnalyzer";
import { orderedQuestions, type OrderedQuestion } from "./questionOrder";
import { ruleSummary } from "../../../lib/ruleSummary";

// §4.3 — soft-nudge threshold: more conditions are allowed but flagged fragile.
const FRAGILE_CONDITIONS = 3;

// LOGIC v2 §4.2 — the dedicated Rules tab: a priority-ordered matrix of every
// advanced rule. Priority = list order (top→bottom, first full match wins —
// the resolveTarget contract); the merchant reorders by drag OR ↑/↓. Columns:
// priority # · AND-conditions (dropdown-built, §4.1 — never free text) ·
// result target · estimated match %. Diagnostics ride the L2-4 path analyzer
// (dead V7 / shadowed V8 / half-built V9); the §4.3 fall-through note states
// what happens when nothing matches (expected, not an error). Decider docs
// only — the layout never mounts this for legacy docs.
export function RulesTab({
  doc,
  categories,
  onCommit,
  focusRuleId = null,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  onCommit: (doc: QuizDoc) => void;
  /** Deep-link target from the Test-all-paths report — the row scrolls into
   *  view and flashes so "Go to it →" lands on the exact rule, not just the tab. */
  focusRuleId?: string | null;
}) {
  const rules = useMemo(() => doc.decision_rules ?? [], [doc.decision_rules]);
  const questions = useMemo(() => orderedQuestions(doc), [doc]);
  // Rules reference answers, so only discrete-answer questions qualify as
  // condition sources (multi-select INCLUDED — §2.2 points combination logic
  // at rules; freeform excluded — no discrete answers).
  const conditionQuestions = useMemo(
    () => questions.filter((q) => !isFreeformType(q.node.data.question_type)),
    [questions],
  );
  const diagnostics = useMemo(() => {
    const dead = new Map(deadRules(doc).map((f) => [f.ruleId, f.message]));
    const shadowed = new Map(shadowedRules(doc).map((f) => [f.ruleId, f.message]));
    const half = new Map(halfBuiltRules(doc).map((f) => [f.ruleId, f.message]));
    const broken = new Map(brokenRuleRefs(doc).map((f) => [f.ruleId, f.message]));
    return { dead, shadowed, half, broken };
  }, [doc]);
  const estimates = useMemo(() => ruleMatchEstimates(doc), [doc]);

  // §4.3 fall-through — the share of shoppers no rule catches, under the same
  // uniform-independence assumption as the per-rule estimates. Rules that can't
  // actually fire (half-built / dead / broken / shadowed) are EXCLUDED so they
  // can't understate the miss. An ESTIMATE for orientation, never validation.
  const fallThroughPct = useMemo(() => {
    let miss = 1;
    for (const r of rules) {
      if (r.conditions.length === 0) continue; // half-built never fires
      if (diagnostics.dead.has(r.id) || diagnostics.broken.has(r.id) || diagnostics.shadowed.has(r.id))
        continue;
      miss *= 1 - (estimates.get(r.id) ?? 0);
    }
    return Math.round(miss * 100);
  }, [rules, estimates, diagnostics]);

  const defaultTarget = categories[0]?.id ?? "";

  // ── drag-to-reorder (HTML5 DnD) + ↑/↓ fallback (the H3 pattern) ──
  const dragId = useRef<string | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // Deep-link focus: scroll the targeted rule into view + flash it.
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusRuleId) return;
    const el = document.getElementById(`qz-rule-${focusRuleId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setFlashId(focusRuleId);
      const t = window.setTimeout(() => setFlashId(null), 2000);
      return () => window.clearTimeout(t);
    }
  }, [focusRuleId]);

  const setConditions = (ruleId: string, conditions: DecisionRuleCondition[]) =>
    onCommit(updateDecisionRule(doc, ruleId, { conditions }));

  const deleteRule = (ruleId: string, summary: string, everFired: boolean) => {
    const tail = everFired
      ? "Shoppers it matched will fall through to lower rules or the deciding question's answer."
      : "It had no conditions, so it never affected anyone.";
    const ok =
      typeof window === "undefined" ||
      window.confirm(`Delete this rule?\n\n${summary}\n\n${tail}`);
    if (ok) onCommit(removeDecisionRule(doc, ruleId));
  };

  return (
    <div className="qz-ql-rules">
      {/* §4.1 — PRECEDENCE, STATED IN THE UI (spec mandate) */}
      <div className="qz-ql-rules-precedence" role="note">
        <strong>How rules work:</strong> rules are checked top to bottom — the first rule whose
        conditions ALL match wins and stops. Rules beat the deciding question&rsquo;s mapping;
        higher rules beat lower rules. If no rule matches, the deciding answer applies.
      </div>

      {rules.length === 0 ? (
        <div className="qz-ql-rules-empty">
          <div className="qz-ql-rules-ph-title">No rules yet</div>
          <p>
            Rules force a result from a <em>combination</em> of answers across questions — what
            one deciding question can&rsquo;t express. E.g. &ldquo;Level is Advanced AND Terrain
            is Backcountry → All-Mountain Reserve.&rdquo;
          </p>
        </div>
      ) : (
        <div className="qz-ql-rules-list">
          {rules.map((rule, idx) => {
            const est = estimates.get(rule.id) ?? 0;
            const half = diagnostics.half.get(rule.id);
            const broken = diagnostics.broken.get(rule.id);
            const dead = diagnostics.dead.get(rule.id);
            const shadow = diagnostics.shadowed.get(rule.id);
            // A rule that can't (or shouldn't) fire has no honest match-% —
            // showing one next to a "never fires" badge would contradict it.
            const noEst = Boolean(half || broken || dead);
            const fragile = rule.conditions.length > FRAGILE_CONDITIONS;
            const summary = ruleSummary(rule.conditions, rule.target_id, questions, categories);
            return (
              <div
                key={rule.id}
                id={`qz-rule-${rule.id}`}
                className={`qz-ql-rule${dragOverIdx === idx ? " is-dragover" : ""}${flashId === rule.id ? " is-flash" : ""}`}
                draggable
                onDragStart={() => {
                  dragId.current = rule.id;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverIdx(idx);
                }}
                onDragLeave={() => setDragOverIdx((v) => (v === idx ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverIdx(null);
                  if (dragId.current && dragId.current !== rule.id) {
                    onCommit(moveDecisionRule(doc, dragId.current, idx));
                  }
                  dragId.current = null;
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDragOverIdx(null);
                }}
              >
                <div className="qz-ql-rule-head">
                  <span className="qz-ql-rule-grip" title="Drag to reorder (priority: top wins)" aria-hidden>
                    ⠿
                  </span>
                  <span className="qz-ql-rule-prio">Rule {idx + 1}</span>
                  {half ? (
                    <span className="qz-ql-rule-flag is-half" title={half}>
                      needs a condition
                    </span>
                  ) : broken ? (
                    <span className="qz-ql-rule-flag is-dead" title={broken}>
                      broken reference
                    </span>
                  ) : dead ? (
                    <span className="qz-ql-rule-flag is-dead" title={dead}>
                      can never fire
                    </span>
                  ) : shadow ? (
                    <span className="qz-ql-rule-flag is-shadow" title={shadow}>
                      shadowed by a higher rule
                    </span>
                  ) : null}
                  {fragile ? (
                    <span
                      className="qz-ql-rule-flag is-fragile"
                      title={`${rule.conditions.length} conditions — very few shoppers match that many at once. 1–3 is the sweet spot.`}
                    >
                      fragile
                    </span>
                  ) : null}
                  <span style={{ flex: 1 }} />
                  <span
                    className="qz-ql-rule-est"
                    title="Estimated share of shoppers matching this rule (assumes evenly-spread answers — an orientation aid, not a measurement)"
                  >
                    {noEst ? "—" : `≈${Math.round(est * 100)}%`}
                  </span>
                  <button
                    type="button"
                    disabled={idx === 0}
                    title="Raise priority"
                    aria-label={`Raise rule ${idx + 1} priority`}
                    onClick={() => onCommit(moveDecisionRule(doc, rule.id, idx - 1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === rules.length - 1}
                    title="Lower priority"
                    aria-label={`Lower rule ${idx + 1} priority`}
                    onClick={() => onCommit(moveDecisionRule(doc, rule.id, idx + 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="qz-ql-rule-del"
                    title="Delete this rule"
                    aria-label={`Delete rule ${idx + 1}`}
                    onClick={() => deleteRule(rule.id, summary, rule.conditions.length > 0)}
                  >
                    ✕
                  </button>
                </div>

                <div className="qz-ql-rule-conds">
                  {rule.conditions.map((c, ci) => (
                    <ConditionRow
                      key={ci}
                      cond={c}
                      first={ci === 0}
                      questions={conditionQuestions}
                      onChange={(next) =>
                        setConditions(
                          rule.id,
                          rule.conditions.map((x, i) => (i === ci ? next : x)),
                        )
                      }
                      onRemove={() =>
                        setConditions(
                          rule.id,
                          rule.conditions.filter((_, i) => i !== ci),
                        )
                      }
                    />
                  ))}
                  <button
                    type="button"
                    className="qz-ql-rule-addcond"
                    disabled={conditionQuestions.length === 0}
                    onClick={() => {
                      const q = conditionQuestions[0]!;
                      const a = q.node.data.answers[0];
                      if (!a) return;
                      setConditions(rule.id, [
                        ...rule.conditions,
                        { question_id: q.node.id, answer_id: a.id, op: "is" },
                      ]);
                    }}
                  >
                    + AND condition
                  </button>
                </div>

                <div className="qz-ql-rule-target">
                  <span className="qz-ql-rule-arrow" aria-hidden>
                    →
                  </span>
                  <span>recommend</span>
                  <select
                    value={categories.some((c) => c.id === rule.target_id) ? rule.target_id : ""}
                    aria-label={`Rule ${idx + 1} result target`}
                    onChange={(e) => {
                      if (e.target.value) onCommit(updateDecisionRule(doc, rule.id, { target_id: e.target.value }));
                    }}
                  >
                    {categories.some((c) => c.id === rule.target_id) ? null : (
                      <option value="" disabled>
                        (deleted bucket — pick again)
                      </option>
                    )}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="qz-btn qz-btn-ghost qz-btn-sm qz-ql-rules-add"
        disabled={!defaultTarget}
        onClick={() => onCommit(addDecisionRule(doc, defaultTarget))}
      >
        + Add rule
      </button>

      {/* §4.3 fall-through — expected, not an error */}
      {rules.some((r) => r.conditions.length > 0) ? (
        <p className="qz-ql-rules-fallthrough" role="note">
          ≈{fallThroughPct}% of answer combinations match no rule — they fall back to the
          deciding question&rsquo;s answer. That&rsquo;s expected: rules are for exceptions, the
          decider handles the rest.
        </p>
      ) : null}
    </div>
  );
}

// One dropdown-built condition row: [Question] [is / is not] [Answer].
// A condition whose question/answer was deleted renders a disabled "(deleted)"
// option so the broken ref is VISIBLE (§9 — never silently re-bound).
function ConditionRow({
  cond,
  first,
  questions,
  onChange,
  onRemove,
}: {
  cond: DecisionRuleCondition;
  first: boolean;
  questions: OrderedQuestion[];
  onChange: (next: DecisionRuleCondition) => void;
  onRemove: () => void;
}) {
  const q = questions.find((x) => x.node.id === cond.question_id);
  const answers = q?.node.data.answers ?? [];
  const answerKnown = answers.some((a) => a.id === cond.answer_id);
  return (
    <div className="qz-ql-cond">
      <span className="qz-ql-cond-join">{first ? "If" : "AND"}</span>
      <select
        value={q ? cond.question_id : ""}
        aria-label="Condition question"
        onChange={(e) => {
          const nq = questions.find((x) => x.node.id === e.target.value);
          const na = nq?.node.data.answers[0];
          if (nq && na) onChange({ ...cond, question_id: nq.node.id, answer_id: na.id });
        }}
      >
        {q ? null : (
          <option value="" disabled>
            (deleted question)
          </option>
        )}
        {questions.map((x) => (
          <option key={x.node.id} value={x.node.id}>
            Q{x.qIndex} · {x.node.data.text || "Untitled"}
          </option>
        ))}
      </select>
      <select
        value={cond.op}
        aria-label="Condition operator"
        onChange={(e) => onChange({ ...cond, op: e.target.value as "is" | "is_not" })}
      >
        <option value="is">is</option>
        <option value="is_not">is not</option>
      </select>
      <select
        value={answerKnown ? cond.answer_id : ""}
        aria-label="Condition answer"
        onChange={(e) => {
          if (e.target.value) onChange({ ...cond, answer_id: e.target.value });
        }}
      >
        {answerKnown ? null : (
          <option value="" disabled>
            (deleted answer)
          </option>
        )}
        {answers.map((a) => (
          <option key={a.id} value={a.id}>
            {a.text || "Untitled answer"}
          </option>
        ))}
      </select>
      <button type="button" className="qz-ql-cond-del" aria-label="Remove condition" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
