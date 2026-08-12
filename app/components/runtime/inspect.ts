// Editor inspect mode (Dev plan "editor revamp"): in the builder preview, the
// content elements a merchant would edit (headlines, question text, answers,
// education cards, result copy) become click-to-inspect — hover outline + click
// reports WHICH element was clicked instead of performing its normal action.
// The storefront never passes `onInspect`, in which case `inspectAttrs` returns
// {} and the rendered DOM/behavior is unchanged.
export type InspectPart =
  | "headline"
  | "subtext"
  | "cta"
  | "question_text"
  | "answer"
  | "education_card"
  | "result_headline"
  | "result_subtext"
  // Unified P3 — click-to-edit covers every visible node type.
  | "message_text"
  | "end_headline"
  | "end_subtext"
  | "email_headline"
  | "email_subtext"
  | "askai_persona"
  | "pc_headline"
  | "pc_subtext";

export interface InspectTarget {
  nodeId: string;
  part: InspectPart;
  answerId?: string;
}

// QRTZ-F3 (mock shared.mjs 649 `.sel-tag`) — the type name shown on the
// selection ring. Vocabulary matches the inspector's block kind names
// (studioDoc PALETTE_BLOCKS: "Heading" / "Text" / "Button"); parts without a
// block twin get the nearest short noun. Kept here (not imported from
// studioDoc) so the runtime module stays dependency-free of studio code.
export const INSPECT_PART_NAME: Record<InspectPart, string> = {
  headline: "Heading",
  subtext: "Text",
  cta: "Button",
  question_text: "Question",
  answer: "Answer",
  education_card: "Card",
  result_headline: "Heading",
  result_subtext: "Text",
  message_text: "Text",
  end_headline: "Heading",
  end_subtext: "Text",
  email_headline: "Heading",
  email_subtext: "Text",
  askai_persona: "Persona",
  pc_headline: "Heading",
  pc_subtext: "Text",
};

export function inspectAttrs(
  onInspect: ((t: InspectTarget) => void) | undefined,
  selected: InspectTarget | null | undefined,
  target: InspectTarget,
): React.HTMLAttributes<HTMLElement> & { "data-qz-sel-tag"?: string } {
  if (!onInspect) return {};
  const isSelected =
    !!selected &&
    selected.nodeId === target.nodeId &&
    selected.part === target.part &&
    (selected.answerId ?? null) === (target.answerId ?? null);
  return {
    onClickCapture: (e) => {
      // Capture phase: beat the element's own handler (advance/select/toggle)
      // so inspecting never mutates quiz state.
      e.preventDefault();
      e.stopPropagation();
      onInspect(target);
    },
    className: isSelected ? "qz-insp qz-insp-sel" : "qz-insp",
    // QRTZ-F3 — the ring's type tag renders from this attribute via
    // quizocalypse.css `[data-qz-sel-tag]::after` (admin sheet only; /q loads
    // quiz-runtime.css alone — BIC-2 B1). Doubly gated: this whole function
    // returns {} without onInspect, and QuizRuntime only passes onInspect in
    // preview mode, so the shopper DOM never carries the attribute.
    ...(isSelected ? { "data-qz-sel-tag": INSPECT_PART_NAME[target.part] } : {}),
  };
}
