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
    // The coarse preset (legacy selected_style).
    const base: CSSProperties =
      selStyle === "fill"
        ? {
            background: "color-mix(in srgb, var(--qz-color-primary) 18%, transparent)",
            borderColor: "var(--qz-color-primary)",
          }
        : selStyle === "border"
          ? { boxShadow: "inset 0 0 0 2px var(--qz-color-primary)" }
          : {};
    // R5c-1 §6.1 — granular overrides layer over the preset. Absent → base only
    // (byte-identical to today).
    const over: CSSProperties = {};
    if (display.selected_fill) over.background = display.selected_fill;
    if (display.selected_border_color || display.selected_border_width !== undefined)
      over.border = `${display.selected_border_width ?? 2}px solid ${
        display.selected_border_color ?? "var(--qz-color-primary)"
      }`;
    if (display.selected_text_color) over.color = display.selected_text_color;
    return { ...base, ...over };
  };

  // R5c-1 §6.1 — the selection indicator. Absent → derived from the legacy
  // selected_style (check → check badge, else none), so today's render is exact.
  const indicatorKind: "check" | "dot" | "filled" | "none" =
    display.selected_indicator ?? (selStyle === "check" ? "check" : "none");

  const checkBadge = (on: boolean): ReactNode => {
    if (!on || (indicatorKind !== "check" && indicatorKind !== "dot")) return null;
    const dot = indicatorKind === "dot";
    return (
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: dot ? 12 : 20,
          height: dot ? 12 : 20,
          borderRadius: 999,
          background: "var(--qz-color-primary)",
          color: "var(--qz-color-bg)",
          fontSize: 12,
          lineHeight: dot ? "12px" : "20px",
          textAlign: "center",
          zIndex: 2,
        }}
      >
        {dot ? "" : "✓"}
      </span>
    );
  };

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

  // R5b §3.1 — content alignment. Absent → today's layout exactly (byte-safe).
  const contentAlignCss: CSSProperties = display.content_align
    ? {
        justifyContent:
          display.content_align === "center"
            ? "center"
            : display.content_align === "right"
              ? "flex-end"
              : "flex-start",
        textAlign: display.content_align,
      }
    : {};

  // R5b §3.1 — the independent media toggle. When show_media is UNDEFINED this
  // returns the glyph exactly as before (byte-identical); true = prefer a sized
  // image (or the glyph); false = no media.
  const inlineMedia = (a: Answer): ReactNode => {
    if (display.show_media === undefined) return icon(a);
    if (display.show_media === false) return null;
    if (a.image_url)
      return (
        <img
          src={a.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          style={{
            width: display.image_size ?? 40,
            height: display.image_size ?? 40,
            objectFit: display.fit ?? "cover",
            borderRadius: 6,
            flexShrink: 0,
            display: "block",
          }}
        />
      );
    return icon(a);
  };
  // Card/tile media: absent/true → today's image; false → hidden.
  const cardMedia = (a: Answer): ReactNode =>
    display.show_media === false ? null : media(a);

  const optionBody = (a: Answer, on: boolean): ReactNode => {
    switch (mode) {
      case "cards":
        return (
          <>
            {cardMedia(a)}
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
            {cardMedia(a)}
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
              flexDirection:
                display.icon_position === "top"
                  ? "column"
                  : display.icon_position === "right"
                    ? "row-reverse"
                    : "row",
              alignItems: "center",
              gap: 10,
              justifyContent:
                (display.icon_position ?? "left") === "top" ? "center" : "flex-start",
              ...contentAlignCss,
            }}
          >
            {inlineMedia(a)}
            <span style={labelCss}>{a.text}</span>
            {checkBadge(on)}
          </span>
        );
      case "pills":
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...contentAlignCss }}>
            {inlineMedia(a)}
            <span style={labelCss}>{a.text}</span>
            {checkBadge(on)}
          </span>
        );
      default:
        // list
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 10, ...contentAlignCss }}>
            {inlineMedia(a)}
            <span style={labelCss}>{a.text}</span>
            {checkBadge(on)}
          </span>
        );
    }
  };

  // R5c-2 §6.1 — desktop hover shift + a motion preset. Opt-in: the runtime adds
  // the `qz-answer-opt` class + data attrs + CSS vars ONLY when one is set, so an
  // option without them keeps its exact current HTML (byte-identical). The hover
  // + transition rules live in quiz-runtime.css (inline styles can't do :hover).
  const motion = display.motion && display.motion !== "none" ? display.motion : null;
  const hoverOn = Boolean(display.hover_bg);
  const interactive = Boolean(motion || hoverOn);
  const hoverVars: CSSProperties = hoverOn
    ? ({
        ["--qz-opt-hover-bg" as string]: display.hover_bg,
        ["--qz-opt-hover-border" as string]: display.hover_border ?? display.hover_bg,
      } as CSSProperties)
    : {};

  return (
    <div style={displayContainer(display)}>
      {node.data.answers.map((a) => {
        const on = selectedIds.has(a.id);
        const inspProps = insp("answer", a.id);
        const inspClass = (inspProps as { className?: string }).className;
        return (
          <div key={a.id} style={{ position: "relative", ...(mode === "pills" ? { display: "inline-flex" } : {}) }}>
            <button
              type="button"
              aria-pressed={on}
              {...inspProps}
              className={interactive ? [inspClass, "qz-answer-opt"].filter(Boolean).join(" ") : inspClass}
              {...(motion ? { "data-qz-motion": motion } : {})}
              {...(hoverOn ? { "data-qz-hover": "" } : {})}
              style={{ ...baseOption, ...selectedCss(on), ...hoverVars }}
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
