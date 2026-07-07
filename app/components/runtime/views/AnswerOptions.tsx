import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import type { QuizNode } from "../../../lib/quizSchema";
import {
  displayAspect,
  displayBackground,
  displayContainer,
  displayRadius,
  type AnswerDisplay,
} from "../../../lib/answerDisplay";
import type { stylesFor } from "../runtimeStyles";
import type { InspectPart } from "../inspect";
import { TooltipChip } from "../bits/TooltipChip";

// ════════════════════════════════════════════════════════════════════════════
// AnswerOptions (QZY-9, build-tab §5/§5.2) — the five answer display modes for
// the card family (single_select / multi_select / image_tile). Mounted by
// QuestionView ONLY when data.answer_display.mode is set; absent keeps the
// legacy branches byte-for-byte. Selection semantics stay the HOST's job
// (classic tap-to-advance vs minimal pending-pick vs multi toggle) — this
// component only renders and reports clicks.
//
// Modes: list (stacked rows) · icon (emoji left/top of label) · cards (image
// atop label, grid) · tiles (the image IS the option, label overlaid) ·
// pills (wrapping pill row). Selected-state style: border / fill / check.
// ════════════════════════════════════════════════════════════════════════════

type QuestionNode = Extract<QuizNode, { type: "question" }>;
type Answer = QuestionNode["data"]["answers"][number];

export function AnswerOptions({
  node,
  display,
  selectedIds,
  onPickAnswer,
  insp,
  onTooltipView,
  styles,
}: {
  node: QuestionNode;
  display: AnswerDisplay;
  /** Currently selected/pending answer ids (multi: all checked; single: the
   *  minimal-chrome pending pick). */
  selectedIds: ReadonlySet<string>;
  onPickAnswer: (a: Answer) => void;
  insp: (part: InspectPart, answerId?: string) => HTMLAttributes<HTMLElement>;
  onTooltipView?: (answerId: string) => void;
  styles: ReturnType<typeof stylesFor>;
}) {
  const mode = display.mode ?? "list";
  const radius = displayRadius(display);
  const bg = displayBackground(display);
  const selStyle = display.selected_style ?? "border";

  const labelCss: CSSProperties = {
    fontSize: display.label_size,
    color: display.label_color,
    fontWeight: display.label_bold ? 700 : undefined,
  };

  const baseOption: CSSProperties = {
    ...styles.answerBtn,
    borderRadius: radius,
    ...(bg ? { background: bg } : {}),
    ...(display.border_color || display.border_width !== undefined
      ? {
          border: `${display.border_width ?? 1}px solid ${display.border_color ?? "#00000022"}`,
        }
      : {}),
    ...(mode === "pills"
      ? { padding: `${display.pad ?? 8}px ${(display.pad ?? 8) * 2}px`, width: "auto" }
      : {}),
    ...(mode === "tiles" || mode === "cards" ? { padding: 0, overflow: "hidden" } : {}),
    position: "relative",
    textAlign: mode === "cards" || mode === "tiles" ? "center" : (styles.answerBtn as CSSProperties).textAlign,
  };

  const selectedCss = (on: boolean): CSSProperties => {
    if (!on) return {};
    if (selStyle === "fill")
      return {
        background: "color-mix(in srgb, var(--qz-color-primary) 18%, transparent)",
        borderColor: "var(--qz-color-primary)",
      };
    // border (default) — the check style keeps the base look + a corner badge.
    if (selStyle === "border")
      return { boxShadow: "inset 0 0 0 2px var(--qz-color-primary)" };
    return {};
  };

  const checkBadge = (on: boolean): ReactNode =>
    selStyle === "check" && on ? (
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 20,
          height: 20,
          borderRadius: 999,
          background: "var(--qz-color-primary)",
          color: "var(--qz-color-bg)",
          fontSize: 12,
          lineHeight: "20px",
          textAlign: "center",
          zIndex: 2,
        }}
      >
        ✓
      </span>
    ) : null;

  const icon = (a: Answer): ReactNode =>
    a.icon ? (
      <span
        aria-hidden
        style={{
          fontSize: display.icon_size ?? 22,
          lineHeight: 1,
          display: "block",
          flexShrink: 0,
        }}
      >
        {a.icon}
      </span>
    ) : null;

  const media = (a: Answer): ReactNode =>
    a.image_url ? (
      <img
        src={a.image_url}
        alt=""
        loading="lazy"
        decoding="async"
        style={{
          width: "100%",
          aspectRatio: displayAspect(display),
          objectFit: display.fit ?? "cover",
          display: "block",
        }}
      />
    ) : (
      <div
        aria-hidden
        style={{
          width: "100%",
          aspectRatio: displayAspect(display),
          background: "#00000010",
        }}
      />
    );

  const labelPos = display.label_position ?? "below";

  const optionBody = (a: Answer, on: boolean): ReactNode => {
    switch (mode) {
      case "cards":
        return (
          <>
            {media(a)}
            {labelPos !== "hidden" ? (
              <span
                style={{
                  ...labelCss,
                  display: "block",
                  padding: "8px 10px",
                  ...(labelPos === "overlay"
                    ? {
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        color: display.overlay_text_color ?? "#fff",
                        background: `linear-gradient(transparent, rgba(0,0,0,${(display.overlay_tint ?? 45) / 100}))`,
                      }
                    : {}),
                }}
              >
                {a.text}
              </span>
            ) : null}
            {checkBadge(on)}
          </>
        );
      case "tiles":
        return (
          <>
            {media(a)}
            {labelPos !== "hidden" ? (
              <span
                style={{
                  ...labelCss,
                  ...(labelPos === "below"
                    ? { display: "block", padding: "8px 10px" }
                    : {
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "flex-end",
                        padding: 10,
                        color: display.overlay_text_color ?? "#fff",
                        background: `linear-gradient(transparent 40%, rgba(0,0,0,${(display.overlay_tint ?? 45) / 100}))`,
                      }),
                }}
              >
                {a.text}
              </span>
            ) : null}
            {checkBadge(on)}
          </>
        );
      case "icon":
        return (
          <span
            style={{
              display: "flex",
              flexDirection: (display.icon_position ?? "left") === "top" ? "column" : "row",
              alignItems: "center",
              gap: 10,
              justifyContent:
                (display.icon_position ?? "left") === "top" ? "center" : "flex-start",
            }}
          >
            {icon(a)}
            <span style={labelCss}>{a.text}</span>
            {checkBadge(on)}
          </span>
        );
      case "pills":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {icon(a)}
            <span style={labelCss}>{a.text}</span>
            {checkBadge(on)}
          </span>
        );
      default:
        // list
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {icon(a)}
            <span style={labelCss}>{a.text}</span>
            {checkBadge(on)}
          </span>
        );
    }
  };

  return (
    <div style={displayContainer(display)}>
      {node.data.answers.map((a) => {
        const on = selectedIds.has(a.id);
        return (
          <div key={a.id} style={{ position: "relative", ...(mode === "pills" ? { display: "inline-flex" } : {}) }}>
            <button
              type="button"
              aria-pressed={on}
              style={{ ...baseOption, ...selectedCss(on) }}
              {...insp("answer", a.id)}
              onClick={() => onPickAnswer(a)}
            >
              {optionBody(a, on)}
            </button>
            {a.tooltip_text ? (
              <TooltipChip text={a.tooltip_text} onReveal={() => onTooltipView?.(a.id)} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
