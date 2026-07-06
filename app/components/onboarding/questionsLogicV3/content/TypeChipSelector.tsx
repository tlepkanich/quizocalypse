import { useRef, useState } from "react";
import type { Quiz as QuizDoc, QuestionType } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import { setQuestionType } from "../../../../lib/quizMutations";
import type { QuestionNode } from "../../../../lib/questionOrder";
import { QzModal } from "../../../qz-overlays";

/* quiz-step3 v3 §4.4 — the kicker's type chip as a dropdown (QL3-P2).
   Quick picks = the headline four (labels match the legacy Step-3 selector);
   a question already on another type keeps it listed so nothing is hidden.
   BOTH dialogs intercept BEFORE setQuestionType is called:
   — decider + multi-select/open-text pick → BLOCK dialog (spec's locked
     behavior: multi/freeform can't decide; setQuestionType would silently
     auto-demote the decider, so the UI refuses instead — doc UNCHANGED);
   — any other type change → reset-confirm (answers reset to type defaults,
     stale skip edges pruned — the mutation's documented contract). */

const CHIP_TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "image_tile", label: "Image select" },
  { value: "text", label: "Open text" },
];

/** Labels for types outside the quick picks (so the current value renders). */
const TYPE_CHIP_LABEL: Record<string, string> = {
  single_select: "Single select",
  multi_select: "Multi-select",
  image_tile: "Image select",
  text: "Open text",
  email: "Email input",
  searchable: "Searchable list",
  image_picker: "Image grid",
  dropdown: "Dropdown",
  rating: "Scale / rating",
  swatch: "Swatch picker",
  numeric: "Number input",
  date: "Date input",
  slider: "Slider (0–100)",
};

type Dialog = { kind: "block"; pick: QuestionType } | { kind: "confirm"; pick: QuestionType };

export function TypeChipSelector({
  doc,
  node,
  onCommit,
}: {
  doc: QuizDoc;
  node: QuestionNode;
  onCommit: (doc: QuizDoc) => void;
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const current = node.data.question_type;
  const isDecider = node.data.role === "decides";

  const options = CHIP_TYPE_OPTIONS.some((o) => o.value === current)
    ? CHIP_TYPE_OPTIONS
    : [{ value: current, label: TYPE_CHIP_LABEL[current] ?? current }, ...CHIP_TYPE_OPTIONS];

  const handlePick = (pick: QuestionType) => {
    if (pick === current) return;
    // Intercept BEFORE the mutation: setQuestionType would auto-demote a
    // decider on multi/freeform — the spec locks that path behind a refusal.
    if (isDecider && (pick === "multi_select" || isFreeformType(pick))) {
      setDialog({ kind: "block", pick });
      return;
    }
    setDialog({ kind: "confirm", pick });
  };

  return (
    <>
      <select
        className="qz-s3-typechip is-select"
        value={current}
        onChange={(e) => handlePick(e.target.value as QuestionType)}
        aria-label="Question type"
        title="Change the question type"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      <QzModal
        open={dialog?.kind === "block"}
        onClose={() => setDialog(null)}
        size="sm"
        title={
          dialog?.kind === "block" && dialog.pick === "multi_select"
            ? "Multi-select can't decide the result"
            : "Open text can't decide the result"
        }
        footer={
          <button type="button" className="qz-btn qz-btn-primary" onClick={() => setDialog(null)}>
            Got it
          </button>
        }
      >
        This question decides the shopper&rsquo;s result — each answer points straight at one
        recommendation, so shoppers must pick exactly one. Make another question the decider
        first, then change this one&rsquo;s type.
      </QzModal>

      <QzModal
        open={dialog?.kind === "confirm"}
        onClose={() => setDialog(null)}
        size="sm"
        title="Changing the type resets this question's answers"
        initialFocusRef={cancelRef}
        footer={
          <>
            <button
              ref={cancelRef}
              type="button"
              className="qz-btn"
              onClick={() => setDialog(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              onClick={() => {
                if (dialog?.kind === "confirm") onCommit(setQuestionType(doc, node.id, dialog.pick));
                setDialog(null);
              }}
            >
              Change type
            </button>
          </>
        }
      >
        The answers go back to type defaults (and any skip logic tied to the old answers is
        removed). Your question text is kept.
      </QzModal>
    </>
  );
}
