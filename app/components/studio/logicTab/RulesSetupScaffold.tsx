import { useMemo, useState } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import { createDecisionRule } from "../../../lib/quizMutations";

// ════════════════════════════════════════════════════════════════════════════
// Logic-step module 12 — the Rules-only setup scaffold ("Rules only · when no
// rules exist yet"). Renders INSIDE the ledger zone, replacing the empty
// state. Mock .setup through the token map, with ONE deliberate deviation:
// the mock's draft rows end in an unset "?" chip and "Create {n} rules" would
// have to invent targets — a guessed target is a silent wrong mapping. So
// each draft row's target is a <select> over the result sets (placeholder
// "Choose a result", styled as the unset chip) and Create enables only once
// every row has one. This respects the mutation-layer gate (createDecisionRule
// refuses a targetless rule) and never guesses.
// ════════════════════════════════════════════════════════════════════════════

export function RulesSetupScaffold({
  questions,
  categories,
  commit,
  getLatestDoc,
  onWriteByHand,
}: {
  questions: OrderedQuestion[];
  categories: BuilderCategory[];
  commit: (doc: Quiz) => void;
  /** LogicTabCard's docRef seam — create against the LATEST doc. */
  getLatestDoc: () => Quiz;
  /** Opens the existing Add-rule modal ("Write one by hand instead"). */
  onWriteByHand: () => void;
}) {
  // Default: the decides question (the one most quizzes pivot on), else the
  // first. Client state only — nothing persists until Create.
  const defaultId = useMemo(
    () =>
      (questions.find((q) => q.node.data.role === "decides") ?? questions[0])
        ?.node.id ?? null,
    [questions],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const chosen =
    questions.find((q) => q.node.id === (pickedId ?? defaultId)) ?? null;
  // Per-answer target picks, keyed by answer id (switching the question keeps
  // stale keys around harmlessly — Create reads only the chosen answers).
  const [targets, setTargets] = useState<Record<string, string>>({});

  if (!chosen) return null;
  const answers = chosen.node.data.answers;
  const allSet =
    answers.length > 0 && answers.every((a) => Boolean(targets[a.id]));

  const create = () => {
    if (!allSet) return;
    let next = getLatestDoc();
    for (const a of answers) {
      const target = targets[a.id];
      if (!target) return;
      next = createDecisionRule(next, {
        conditions: [
          { question_id: chosen.node.id, answer_id: a.id, op: "is" },
        ],
        target_ids: [target],
        action: "show",
      });
    }
    commit(next);
  };

  return (
    <div className="qz-lrs" data-testid="rules-setup-scaffold">
      <h4 className="qz-lrs-h">Start with one rule per answer</h4>
      <p className="qz-lrs-sub">
        Most rules-only quizzes begin with a single question deciding the
        result, then add exceptions on top.
      </p>
      <div className="qz-lrs-row">
        Which question decides?
        <select
          className="qz-lrs-qsel"
          aria-label="Which question decides?"
          value={chosen.node.id}
          onChange={(e) => setPickedId(e.target.value)}
        >
          {questions.map((q) => (
            <option key={q.node.id} value={q.node.id}>
              Q{q.qIndex} · {q.node.data.text}
            </option>
          ))}
        </select>
      </div>
      <div className="qz-lrs-prev">
        {answers.map((a, i) => (
          <div key={a.id} className="qz-lrs-pl">
            <span className="qz-lrs-rn">λ{i + 1}</span>
            <span className="qz-lrs-op">When</span>
            <span className="qz-lrs-cchip">
              <span className="qz-lrs-qn" aria-hidden>
                Q{chosen.qIndex}
              </span>
              {a.text}
            </span>
            <span className="qz-lrs-op">→ show</span>
            <select
              className={`qz-lrs-tsel${targets[a.id] ? "" : " is-unset"}`}
              aria-label={`Result for ${a.text}`}
              value={targets[a.id] ?? ""}
              onChange={(e) =>
                setTargets((prev) => ({ ...prev, [a.id]: e.target.value }))
              }
            >
              <option value="">Choose a result</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <div className="qz-lrs-foot">
        <button
          type="button"
          className="qz-btn qz-btn-primary qz-btn-sm qz-lrs-create"
          disabled={!allSet}
          onClick={create}
        >
          Create {answers.length} rule{answers.length === 1 ? "" : "s"}
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-sm qz-lrs-hand"
          onClick={onWriteByHand}
        >
          Write one by hand instead
        </button>
        <span className="qz-lrs-avail">
          {categories.length} result{categories.length === 1 ? "" : "s"}{" "}
          available
        </span>
      </div>
    </div>
  );
}
