import type { Ref } from "react";
import { useContentEditable } from "./useContentEditable";

/* quiz-step3 v3 §4.3 — one inline-editable text run on the phone screen.
   A span driven by useContentEditable (uncontrolled-while-focused; commit on
   every input event). Hover/focus paint the wash + dashed border in the
   ACTIVE question's section color — the CSS reads the --sec-color/--sec-wash
   custom props PhoneScreen inlines on the question wrapper (decider = gold). */

export function EditableText({
  value,
  onCommit,
  maxLength,
  ariaLabel,
  className,
}: {
  value: string;
  onCommit: (text: string) => void;
  maxLength?: number;
  ariaLabel: string;
  className?: string;
}) {
  const { ref, editableProps } = useContentEditable({ value, onCommit, maxLength });
  return (
    <span
      ref={ref as Ref<HTMLSpanElement>}
      className={`qz-s3-editable${className ? ` ${className}` : ""}`}
      role="textbox"
      aria-multiline={false}
      aria-label={ariaLabel}
      tabIndex={0}
      spellCheck={false}
      {...editableProps}
    />
  );
}
