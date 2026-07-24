import { useEffect, useRef, useState } from "react";
import type { Quiz as QuizDoc, QuestionType } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import { addAnswer, removeAnswer, setQuestionType } from "../../../../lib/quizMutations";
import { updateNodeData } from "../../../studio/studioDoc";
import type { QuestionNode } from "../../../../lib/questionOrder";
import { IconCaret } from "../icons";
import { QzModal } from "../../../qz-overlays";

/* questions-full-page mock (AUDIT-17) — the floating type tag beside the
   phone, now the mock's tag + popover: the white pill shows the current type
   with a caret; clicking opens a card with the type RADIO list and, below a
   hairline, per-type settings — Multi-select Min/Max steppers
   (min_selections/max_selections) and the Scale settings (a Max stepper that
   adds/removes REAL answer points through addAnswer/removeAnswer — every
   rating point is a real Answer carrying its mapping, so the count change is
   honest about routing — plus the endpoint label inputs writing
   scale_config.endpoint_label_min/max). Type-change guards are unchanged
   from QZY-3:
   — decider + multi-select/open-text pick → BLOCK dialog (multi/freeform
     can't decide; the UI refuses instead of silently demoting);
   — card → freeform → confirm (extra answers drop; the first survives as
     the seed). Card ↔ card commits DIRECTLY — type changes keep the original
     answers, mappings, and routing, so there is nothing to warn about. */

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

/** Mock stepper (− value +). */
function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <span className="qz-s3-stepper">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="qz-s3-stepval">{value}</span>
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </span>
  );
}

export function TypeChipSelector({
  doc,
  node,
  onCommit,
  variant = "tag",
}: {
  doc: QuizDoc;
  node: QuestionNode;
  onCommit: (doc: QuizDoc) => void;
  /** AUDIT-22 — "meta": the questions-simple row's mono "N · TYPE" run is the
      trigger (the popover is unchanged); "tag": the floating pill. */
  variant?: "tag" | "meta";
}) {
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const current: PickValue = isFivePoint(node) ? "rating5" : node.data.question_type;
  const isDecider = node.data.role === "decides";

  // Outside click / Escape close the popover (mock document-level handler).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = CHIP_TYPE_OPTIONS.some((o) => o.value === current)
    ? CHIP_TYPE_OPTIONS
    : [
        { value: current, label: TYPE_CHIP_LABEL[current] ?? current },
        ...CHIP_TYPE_OPTIONS,
      ];
  const currentLabel =
    options.find((o) => o.value === current)?.label ?? TYPE_CHIP_LABEL[current] ?? current;

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

  // — settings writers —
  const answers = node.data.answers;
  const setMinSelections = (v: number) =>
    onCommit(updateNodeData(doc, node.id, { min_selections: v }));
  const setMaxSelections = (v: number) =>
    onCommit(updateNodeData(doc, node.id, { max_selections: v }));
  const setEndpointLabel = (which: "endpoint_label_min" | "endpoint_label_max", v: string) =>
    onCommit(
      updateNodeData(doc, node.id, {
        scale_config: { ...(node.data.scale_config ?? {}), [which]: v },
      }),
    );
  // Scale point count — every point is a REAL answer. Grow: addAnswer (rename
  // the fresh answer to its point number); shrink: removeAnswer(last) — its
  // mapping/route prune with it (honest). scale_config.max stays in sync when
  // the five-point preset is present.
  const setScaleCount = (nextCount: number) => {
    const count = answers.length;
    if (nextCount === count || nextCount < 2 || nextCount > 10) return;
    let next: QuizDoc;
    if (nextCount > count) {
      const before = new Set(answers.map((a) => a.id));
      next = addAnswer(doc, node.id);
      next = {
        ...next,
        nodes: next.nodes.map((n) =>
          n.id === node.id && n.type === "question"
            ? {
                ...n,
                data: {
                  ...n.data,
                  answers: n.data.answers.map((a) =>
                    before.has(a.id) ? a : { ...a, text: String(nextCount) },
                  ),
                },
              }
            : n,
        ),
      };
    } else {
      const last = answers[answers.length - 1];
      if (!last) return;
      next = removeAnswer(doc, node.id, last.id);
    }
    if (node.data.scale_config?.max !== undefined) {
      next = {
        ...next,
        nodes: next.nodes.map((n) =>
          n.id === node.id && n.type === "question"
            ? {
                ...n,
                data: {
                  ...n.data,
                  scale_config: { ...(n.data.scale_config ?? {}), max: nextCount },
                },
              }
            : n,
        ),
      };
    }
    onCommit(next);
  };

  const multiMin = Math.max(1, Math.min(node.data.min_selections ?? 1, answers.length));
  const multiMax = Math.max(
    multiMin,
    Math.min(node.data.max_selections ?? answers.length, answers.length),
  );

  let settings = null;
  if (node.data.question_type === "multi_select") {
    settings = (
      <div className="qz-s3-tp-set">
        <div className="qz-s3-tp-row">
          <span className="qz-s3-tp-lbl">Min</span>
          <Stepper value={multiMin} min={1} max={multiMax} onChange={setMinSelections} label="minimum selections" />
        </div>
        <div className="qz-s3-tp-row">
          <span className="qz-s3-tp-lbl">Max</span>
          <Stepper value={multiMax} min={multiMin} max={answers.length} onChange={setMaxSelections} label="maximum selections" />
        </div>
      </div>
    );
  } else if (node.data.question_type === "rating") {
    const count = answers.length;
    settings = (
      <div className="qz-s3-tp-set">
        <div className="qz-s3-tp-row">
          <span className="qz-s3-tp-lbl">Max</span>
          <Stepper value={count} min={2} max={10} onChange={setScaleCount} label="scale points" />
        </div>
        <div className="qz-s3-tp-row">
          <input
            className="qz-s3-lblinput"
            value={node.data.scale_config?.endpoint_label_min ?? ""}
            placeholder="Label for 1 (optional)"
            aria-label="Label for the low end of the scale"
            maxLength={40}
            onChange={(e) => setEndpointLabel("endpoint_label_min", e.target.value)}
          />
        </div>
        <div className="qz-s3-tp-row">
          <input
            className="qz-s3-lblinput"
            value={node.data.scale_config?.endpoint_label_max ?? ""}
            placeholder={`Label for ${count} (optional)`}
            aria-label="Label for the high end of the scale"
            maxLength={40}
            onChange={(e) => setEndpointLabel("endpoint_label_max", e.target.value)}
          />
        </div>
        <div className="qz-s3-tp-note">Scale runs 1 → {count}. Labels optional.</div>
      </div>
    );
  }

  return (
    <span ref={wrapRef} className="qz-s3-typetagwrap">
      {variant === "meta" ? (
        <button
          type="button"
          className="qz-qs-qmeta"
          aria-haspopup="true"
          aria-expanded={open}
          title="Change the question type — your answers are kept"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          {isFreeformType(node.data.question_type)
            ? currentLabel
            : `${answers.length} · ${currentLabel}`}
        </button>
      ) : (
        <button
          type="button"
          className="qz-s3-typetagbtn"
          aria-haspopup="true"
          aria-expanded={open}
          title="Change the question type — your answers are kept"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="qz-s3-tt-type">{currentLabel}</span>
          <IconCaret />
        </button>
      )}

      {open ? (
        <div className="qz-s3-typepop">
          <div className="qz-s3-tp-h">Question type</div>
          <div className="qz-s3-tp-types" role="radiogroup" aria-label="Question type">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={o.value === current}
                className={`qz-s3-tp-type${o.value === current ? " is-on" : ""}`}
                onClick={() => handlePick(o.value)}
              >
                <span className="qz-s3-tp-rd" aria-hidden />
                {o.label}
              </button>
            ))}
          </div>
          {settings}
        </div>
      ) : null}

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
    </span>
  );
}
