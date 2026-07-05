import type { Quiz as QuizDoc, Answer } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import {
  setAnswerTarget,
  setAnswerRoute,
  routeAnswerToEnd,
  removeAnswer,
} from "../../../../lib/quizMutations";
import { updateNodeData } from "../../../studio/studioDoc";
import { answerSkipValue, type QuestionNode } from "../../questionsLogic/questionOrder";
import { answerLetter } from "../../questionsLogic/bucketPalette";
import type { RuleRef } from "../ruleHomes";
import type { SkipOption } from "../../questionsLogic/AnswerRow";

const ANSWER_MAX = 60;

/* quiz-step3 v3 §5.2 — one answer row in a Logic-view section card:
   letter badge (section-colored via --sec-color) · inline text input (the
   same map-patch write PhoneScreen uses — Content view is the editing home,
   this stays in lock-step) · λ R# chips for every rule referencing the
   answer (home-section refs get the subtler is-home marker; click →
   scrollToRule) · Maps-to control (DECIDER rows only: the current target or
   the amber "Choose…" state → setAnswerTarget; qualifiers show — by design,
   §2.1) · Then-go-to dropdown (Next / Q{n} / End quiz via setAnswerRoute /
   routeAnswerToEnd — deciding ≠ ending) · ✕ remove with the min-2 guard and
   the §9 rules-will-break confirm. */

export function AnswerTableRow({
  doc,
  node,
  answer,
  index,
  isDeciderRow,
  categories,
  skipOptions,
  chips,
  homeRuleIds,
  canDelete,
  onCommit,
  onChipClick,
}: {
  doc: QuizDoc;
  node: QuestionNode;
  answer: Answer;
  index: number;
  isDeciderRow: boolean;
  categories: BuilderCategory[];
  skipOptions: SkipOption[];
  /** Rules referencing this answer (priority order), from ruleHomes. */
  chips: RuleRef[];
  /** Rule ids homed in THIS section — their chips render subtler (is-home). */
  homeRuleIds: ReadonlySet<string>;
  canDelete: boolean;
  onCommit: (doc: QuizDoc) => void;
  onChipClick: (ruleId: string) => void;
}) {
  const skipValue = answerSkipValue(doc, node.id, answer);
  const targetKnown = answer.target_id
    ? categories.some((c) => c.id === answer.target_id)
    : false;

  const setText = (text: string) => {
    const answers = node.data.answers.map((a) =>
      a.id === answer.id ? { ...a, text: text.slice(0, ANSWER_MAX) } : a,
    );
    onCommit(updateNodeData(doc, node.id, { answers }));
  };

  const removeThis = () => {
    if (!canDelete) return;
    // §9 — confirm-with-consequences when advanced rules reference this answer.
    const refs = chips.length;
    const ok =
      refs === 0 ||
      typeof window === "undefined" ||
      window.confirm(
        `${refs} rule${refs === 1 ? "" : "s"} reference this answer and will break. Delete anyway?`,
      );
    if (ok) onCommit(removeAnswer(doc, node.id, answer.id));
  };

  return (
    <div className="qz-s3-arow">
      <span className="qz-s3-aletter" aria-hidden>
        {answerLetter(index)}
      </span>

      <input
        className="qz-s3-ainput"
        value={answer.text}
        maxLength={ANSWER_MAX}
        placeholder="Answer option…"
        onChange={(e) => setText(e.target.value)}
        aria-label={`Answer ${answerLetter(index)} text`}
      />

      <span className="qz-s3-achiprow">
        {chips.map((ref) => (
          <button
            key={ref.ruleId}
            type="button"
            className={`qz-s3-rulechip${homeRuleIds.has(ref.ruleId) ? " is-home" : ""}`}
            title={`Rule ${ref.no} references this answer — jump to it`}
            onClick={() => onChipClick(ref.ruleId)}
          >
            λ R{ref.no}
          </button>
        ))}
      </span>

      {isDeciderRow ? (
        <select
          className={`qz-s3-target ${targetKnown ? "is-mapped" : "is-unset"}`}
          value={targetKnown ? answer.target_id! : ""}
          onChange={(e) => onCommit(setAnswerTarget(doc, node.id, answer.id, e.target.value || null))}
          aria-label={`Recommendation for ${answer.text || "answer"}`}
          title="This answer directly decides the shopper's result"
        >
          <option value="">
            {answer.target_id && !targetKnown ? "(deleted — choose again)" : "Choose…"}
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="qz-s3-nomap" title="Qualifiers assign nothing — routing and context only" aria-hidden>
          —
        </span>
      )}

      <select
        className={`qz-s3-goto ${skipValue !== "" ? "is-active" : ""}`}
        value={skipValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__end__") onCommit(routeAnswerToEnd(doc, node.id, answer.id));
          else onCommit(setAnswerRoute(doc, node.id, answer.id, v || null));
        }}
        aria-label={`Then-go-to destination for ${answer.text || "answer"}`}
      >
        <option value="">Next</option>
        {skipOptions
          .filter((o) => o.value !== node.id)
          .map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
      </select>

      <button
        type="button"
        className="qz-s3-adel"
        disabled={!canDelete}
        title={canDelete ? "Remove answer" : "Minimum 2 answers required"}
        aria-label={`Remove answer ${answerLetter(index)}`}
        onClick={removeThis}
      >
        ✕
      </button>
    </div>
  );
}
