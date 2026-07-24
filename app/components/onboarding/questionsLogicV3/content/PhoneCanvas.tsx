import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../../lib/quizSchema";
import { isFreeformType } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../../../lib/questionOrder";
import {
  resolveDesignTokens,
  tokensToCssVars,
  suggestContrastText,
} from "../../../../lib/designTokens";
import { googleFontsUrl } from "../../../runtime/runtimeStyles";
import { assignSectionColors, sectionColorVars } from "../sectionPalette";
import { answersExceedBudget } from "../fitSteps";
import { CAPTURE_ID, REVEAL_ID } from "../LeftRail";
import { IconDesktop, IconExpand, IconMobile, IconX } from "../icons";
import type { RegenApi } from "../Step3Shell";
import { PhoneScreen, type ScreenPosition } from "./PhoneScreen";
import { TypeChipSelector } from "./TypeChipSelector";

/* questions-full-page mock + phone-preview SPEC (AUDIT-17) — the Content
   view's phone column on the shared preview-primitive geometry: a pv-bar
   (Mobile/Desktop segmented control · Expand), then a TRUE-viewport device —
   mobile 390×844, desktop 1180×740 — laid out at logical size and scaled to
   fit the pane (`--s = min(paneW/vw, paneH/vh, 1)`, never upscaling past
   1:1), minimal bezel (rounded corners + soft shadow, no ink bar), a
   scrollable screen with a bottom scroll fade, and the desktop frame's faux
   browser chrome (dots + blurred URL + top progress). Expand opens the same
   screen in a dimmed overlay (portal to body — the builder-overlay-portal
   lesson), scaled ≥1 for mobile so it is always visibly bigger; Esc/✕/
   click-outside close. The screen stays brand-themed by inlining
   resolveDesignTokens → tokensToCssVars; the ↻ Regenerate chip keeps the
   stage's beginAiEdit/undo bracket. Back/Next drive the REAL walk
   Q1 → … → Qn → capture → reveal; the shell owns `activeId`. */

const DEVICE_DIMS = {
  mobile: { vw: 390, vh: 844 },
  desktop: { vw: 1180, vh: 740 },
} as const;

type DeviceMode = keyof typeof DEVICE_DIMS;

export function PhoneCanvas({
  doc,
  questions,
  activeId,
  captureOn,
  designTokens,
  deciderId,
  onNavigate,
  onCommit,
  regen,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  /** A question node id, CAPTURE_ID, or REVEAL_ID (validated by the shell). */
  activeId: string;
  captureOn: boolean;
  designTokens: DesignTokens | null | undefined;
  deciderId: string | null;
  onNavigate: (id: string) => void;
  onCommit: (doc: QuizDoc) => void;
  /** The stage's existing regenerate bracket, threaded through the shell. */
  regen: RegenApi;
}) {
  const resolved = useMemo(() => resolveDesignTokens(designTokens ?? undefined), [designTokens]);
  const cssVars = useMemo(() => tokensToCssVars(resolved) as CSSProperties, [resolved]);
  const fontUrl = useMemo(
    () =>
      googleFontsUrl([
        resolved.typography?.heading?.family ?? "",
        resolved.typography?.body?.family ?? "",
      ]),
    [resolved],
  );
  const ctaText = suggestContrastText(resolved.colors?.primary ?? "");

  // The walk order: every flow-ordered question, then the termini.
  const positions = useMemo(() => {
    const ids = questions.map((q) => q.node.id);
    if (captureOn) ids.push(CAPTURE_ID);
    ids.push(REVEAL_ID);
    return ids;
  }, [questions, captureOn]);
  const posIndex = Math.max(0, positions.indexOf(activeId));
  const progress = positions.length > 1 ? (posIndex + 1) / positions.length : 1;

  const position: ScreenPosition =
    activeId === CAPTURE_ID
      ? { kind: "capture" }
      : activeId === REVEAL_ID
        ? { kind: "reveal" }
        : {
            kind: "question",
            question:
              questions.find((q) => q.node.id === activeId) ?? questions[0]!,
          };

  // §5.3 — the active question's section color (decider = gold), inlined as
  // --sec-color/--sec-wash on the question wrapper for the editable treatment.
  const sectionColors = useMemo(
    () =>
      assignSectionColors(
        questions.map((q) => q.node.id),
        deciderId,
      ),
    [questions, deciderId],
  );
  const activeQuestion = position.kind === "question" ? position.question.node : null;
  const activeColorKey = activeQuestion ? sectionColors.get(activeQuestion.id) : undefined;
  const sectionVars = activeColorKey ? sectionColorVars(activeColorKey) : null;

  const answersOverBudget =
    activeQuestion !== null &&
    !isFreeformType(activeQuestion.data.question_type) &&
    answersExceedBudget(activeQuestion.data.answers.length);

  const busy = regen.regeneratingId !== null;
  const regenError = regen.regenError;
  const artDirection = resolved.art_direction;
  const alpine = artDirection?.id === "alpine-afterglow";
  const artScreenStyle: CSSProperties = alpine
    ? {
        ...cssVars,
        backgroundImage:
          position.kind === "question"
            ? `url("${artDirection.question_image_url ?? ""}")`
            : undefined,
      }
    : cssVars;

  // — SPEC "fit the pane": scale off the stage, never the layout —
  const [device, setDevice] = useState<DeviceMode>("mobile");
  const [expanded, setExpanded] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const exDeviceRef = useRef<HTMLDivElement>(null);
  const dims = DEVICE_DIMS[device];

  useEffect(() => {
    const stage = stageRef.current;
    const dev = deviceRef.current;
    if (!stage || !dev) return;
    const fit = () => {
      const s = Math.max(
        0.34,
        Math.min((stage.clientWidth - 24) / dims.vw, (stage.clientHeight - 20) / dims.vh, 1),
      );
      dev.style.setProperty("--s", s.toFixed(3));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [dims]);

  // Scroll resets when the previewed step changes, not on every keystroke.
  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  }, [activeId]);

  // — Expand overlay sizing (SPEC): mobile floored at 1:1, capped 1.4×vh-fit;
  //   desktop fits 90% of the viewport. Esc closes. —
  useEffect(() => {
    if (!expanded) return;
    const fitExpand = () => {
      const dev = exDeviceRef.current;
      if (!dev) return;
      let s: number;
      if (device === "desktop") {
        s = Math.min((window.innerWidth * 0.9) / dims.vw, (window.innerHeight * 0.9) / dims.vh);
      } else {
        s = Math.max(1, Math.min(1.4, (window.innerHeight * 0.9) / dims.vh));
      }
      dev.style.setProperty("--s", s.toFixed(3));
    };
    fitExpand();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("resize", fitExpand);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", fitExpand);
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded, device, dims]);

  const deviceStyle = {
    "--vw": `${dims.vw}px`,
    "--vh": `${dims.vh}px`,
  } as CSSProperties;

  const renderFrame = (withScreenRef: boolean): ReactNode => (
    // The brand vars ride the FRAME so the frame background, the desktop
    // chrome's progress fill, and the scroll fade all read the merchant
    // brand — not the admin fallbacks (the screen re-inlines them plus the
    // alpine art background).
    <div className="qz-s3-frame" style={cssVars}>
      {device === "desktop" ? (
        <div className="qz-s3-dhead">
          <div className="qz-s3-dchrome">
            <span className="qz-s3-ddots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="qz-s3-durl" aria-hidden>
              yourstore.com/pages/quiz
            </span>
          </div>
          <span className="qz-s3-dprog" aria-hidden>
            <span
              className="qz-s3-dprogfill"
              style={{ width: `${(progress * 100).toFixed(1)}%` }}
            />
          </span>
        </div>
      ) : null}
      <div
        className={`qz-s3-phone-screen${alpine ? " is-alpine-art" : ""}`}
        data-screen-kind={position.kind}
        style={artScreenStyle}
        ref={withScreenRef ? screenRef : undefined}
      >
        {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
        <PhoneScreen
          doc={doc}
          position={position}
          stepLabel={`${posIndex + 1}/${positions.length}`}
          progress={progress}
          canBack={posIndex > 0}
          onBack={() => onNavigate(positions[posIndex - 1] ?? positions[0]!)}
          onNext={() =>
            onNavigate(positions[posIndex + 1] ?? positions[positions.length - 1]!)
          }
          onRestart={() => onNavigate(positions[0]!)}
          ctaText={ctaText}
          sectionVars={sectionVars}
          onCommit={onCommit}
        />
      </div>
      <span className="qz-s3-fade" aria-hidden />
    </div>
  );

  const setDeviceMode = useCallback((mode: DeviceMode) => setDevice(mode), []);

  return (
    <section className="qz-s3-canvas">
      {/* questions-full-page mock — no caption pill above the phone (the edit
          hint lives in the sub-header). The art-direction caption stays: it is
          functional provenance for stamped docs. */}
      {alpine ? (
        <p className="qz-s3-caption is-art-directed">
          <span aria-hidden>◆</span> Art direction · {artDirection?.name}
        </p>
      ) : null}

      <div className="qz-s3-pvbar">
        <span className="qz-s3-segbtns" role="group" aria-label="Preview device">
          <button
            type="button"
            className={device === "mobile" ? "is-on" : ""}
            aria-pressed={device === "mobile"}
            title="Mobile"
            aria-label="Mobile preview"
            onClick={() => setDeviceMode("mobile")}
          >
            <IconMobile />
          </button>
          <button
            type="button"
            className={device === "desktop" ? "is-on" : ""}
            aria-pressed={device === "desktop"}
            title="Desktop"
            aria-label="Desktop preview"
            onClick={() => setDeviceMode("desktop")}
          >
            <IconDesktop />
          </button>
        </span>
        <span className="qz-s3-pvsp" />
        <button
          type="button"
          className="qz-s3-expandbtn"
          onClick={() => setExpanded(true)}
        >
          <IconExpand /> Expand
        </button>
      </div>

      <div className="qz-s3-stage" ref={stageRef}>
        <div
          className={`qz-s3-device${device === "desktop" ? " is-desktop" : ""}`}
          ref={deviceRef}
          style={deviceStyle}
        >
          <div className="qz-s3-holder">
            {renderFrame(true)}
            {/* The mock's floating type tag at the phone's right — the tag +
                popover (type radios · Min/Max · scale endpoints); question
                screens only. Docks top-right inside the desktop frame. */}
            {activeQuestion ? (
              <div className="qz-s3-typetag">
                <TypeChipSelector doc={doc} node={activeQuestion} onCommit={onCommit} />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {answersOverBudget ? (
        <div className="qz-s3-warnbanner" role="status">
          <span aria-hidden>⚠</span> This question has more than 8 answers — shoppers on
          small screens will struggle. Consider splitting it.
        </div>
      ) : null}

      <div className="qz-s3-regenrow">
        {regen.undoNodeId ? (
          <button
            type="button"
            className="qz-s3-regen-undo"
            onClick={regen.onUndoRegenerate}
            title="Undo the regeneration"
          >
            ↺ Undo
          </button>
        ) : null}
        <button
          type="button"
          className="qz-s3-regen"
          disabled={busy || !activeQuestion}
          title={
            activeQuestion
              ? "Regenerate this question with AI (keeps recommendation mappings on unchanged answers)"
              : "Select a question to regenerate it with AI"
          }
          onClick={() => activeQuestion && regen.onRegenerate(activeQuestion.id)}
        >
          {activeQuestion && regen.regeneratingId === activeQuestion.id ? (
            <>
              <span className="qz-ql-spin" aria-hidden /> Regenerating…
            </>
          ) : (
            "↻ Regenerate"
          )}
        </button>
      </div>

      {regenError ? (
        <div
          className={`qz-s3-regen-error${regenError.credits ? " is-credits" : ""}`}
          role="alert"
        >
          <span aria-hidden>⚠</span> {regenError.message}{" "}
          <button
            type="button"
            className="qz-s3-retry"
            onClick={() => regen.onRegenerate(regenError.nodeId)}
          >
            Retry
          </button>
          <button
            type="button"
            className="qz-s3-regen-dismiss"
            onClick={regen.onDismissRegenError}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

      {expanded && typeof document !== "undefined"
        ? createPortal(
            <div
              className="qz-s3-phscrim"
              role="dialog"
              aria-modal="true"
              aria-label="Expanded preview"
              onClick={(e) => {
                if (e.target === e.currentTarget) setExpanded(false);
              }}
            >
              <button
                type="button"
                className="qz-s3-phclose"
                aria-label="Close the expanded preview"
                onClick={() => setExpanded(false)}
              >
                <IconX />
              </button>
              <div
                className={`qz-s3-device is-expand${device === "desktop" ? " is-desktop" : ""}`}
                ref={exDeviceRef}
                style={deviceStyle}
              >
                <div className="qz-s3-holder">{renderFrame(false)}</div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
