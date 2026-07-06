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

export function inspectAttrs(
  onInspect: ((t: InspectTarget) => void) | undefined,
  selected: InspectTarget | null | undefined,
  target: InspectTarget,
): React.HTMLAttributes<HTMLElement> {
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
  };
}
