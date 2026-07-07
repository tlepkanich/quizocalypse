import { useRef, useState } from "react";
import type { Quiz as QuizDoc, QuestionType } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import { setQuestionType } from "../../../../lib/quizMutations";
import type { QuestionNode } from "../../../../lib/questionOrder";
import { QzModal } from "../../../qz-overlays";

/* quiz-step3 v3 §4.4 + QZY-3 (owner supplement) — the kicker's type chip.
   Curated picks: Single select · Multi-select · Five-point scale · Rating
   (five-point = the rating type with a 1–5 scale preset; a question already
   on another stored type keeps it listed so nothing is hidden). "Content
   page" lives in the BUILDER's type select (QZY-13) where message screens
   are first-class in the carousel/canvas — the v3 funnel rail/canvas only
   walk question nodes, so a message conversion here would strand the step. Dialogs:
   — decider + multi-select/open-text pick → BLOCK dialog (multi/freeform
     can't decide; the UI refuses instead of silently demoting);
   — card → freeform → confirm (extra answers drop; the first survives as
     the seed). Card ↔ card commits DIRECTLY — since QZY-3, type changes
     keep the original answers, mappings, and routing, so there is nothing
     to warn about. */

type PickValue = QuestionType | "rating5";

const CHIP_TYPE_OPTIONS: { value: PickValue; label: string }[] = [
  { value: "single_select", label: "Single select" },
  { value: "multi_select", label: "Multi-select" },
  { value: "rating5", label: "Five-point scale" },
  { value: "rating", label: "Rating" },
];

/** Labels for stored types outside the quick picks (so the current value renders). */
const TYPE_CHIP_LABEL: Record<string, string> = {
  single_select: "Single select",
  multi_select: "Multi-select",
  image_tile: "Image select",
  text: "Open text",
  email: "Email input",
  searchable: "Searchable list",
  image_picker: "Image grid",
  dropdown: "Dropdown",
  rating: "Rating",
  swatch: "Swatch picker",
  numeric: "Number input",
  date: "Date input",
  slider: "Slider (0–100)",
};

type Dialog = { kind: "block"; pick: QuestionType } | { kind: "confirm"; pick: QuestionType };

/** A five-point question is the rating type carrying the 1–5 scale preset. */
function isFivePoint(node: QuestionNode): boolean {
  return (
    node.data.question_type === "rating" &&
    node.data.scale_config?.min === 1 &&
    node.data.scale_config?.max === 5
  );
}

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
  const current: PickValue = isFivePoint(node) ? "rating5" : node.data.question_type;
  const isDecider = node.data.role === "decides";

  const options = CHIP_TYPE_OPTIONS.some((o) => o.value === current)
    ? CHIP_TYPE_OPTIONS
    : [
        { value: current, label: TYPE_CHIP_LABEL[current] ?? current },
        ...CHIP_TYPE_OPTIONS,
      ];

  const apply = (pickValue: PickValue) => {
    const storedType: QuestionType = pickValue === "rating5" ? "rating" : pickValue;
    let next = setQuestionType(doc, node.id, storedType);
    // Five-point = rating + the 1–5 preset; the plain Rating pick clears an
    // old preset so the two picks stay distinguishable in the chip.
    next = {
      ...next,
      nodes: next.nodes.map((n) =>
        n.id === node.id && n.type === "question"
          ? {
              ...n,
              data: {
                ...n.data,
                ...(pickValue === "rating5"
                  ? { scale_config: { ...(n.data.scale_config ?? {}), min: 1, max: 5 } }
                  : storedType === "rating"
                    ? { scale_config: undefined }
                    : {}),
              },
            }
          : n,
      ),
    };
    onCommit(next);
  };

  const handlePick = (pickValue: PickValue) => {
    if (pickValue === current) return;
    const storedType: QuestionType = pickValue === "rating5" ? "rating" : pickValue;
    // Intercept BEFORE the mutation: setQuestionType would auto-demote a
    // decider on multi/freeform — the spec locks that path behind a refusal.
    if (isDecider && (storedType === "multi_select" || isFreeformType(storedType))) {
      setDialog({ kind: "block", pick: storedType });
      return;
    }
    if (isFreeformType(storedType) && node.data.answers.length > 1) {
      setDialog({ kind: "confirm", pick: storedType });
      return;
    }
    // QZY-3 — card ↔ card keeps every answer, mapping, and route: no dialog.
    apply(pickValue);
  };

  return (
    <>
      <select
        className="qz-s3-typechip is-select"
        value={current}
        onChange={(e) => handlePick(e.target.value as PickValue)}
        aria-label="Question type"
        title="Change the question type — your answers are kept"
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
        title="Switching to a typed answer"
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
                if (dialog?.kind === "confirm") apply(dialog.pick);
                setDialog(null);
              }}
            >
              Change type
            </button>
          </>
        }
      >
        Shoppers will type their answer instead of picking one. Your first answer stays (it
        carries this question&rsquo;s routing); the other answers are removed.
      </QzModal>
    </>
  );
}
