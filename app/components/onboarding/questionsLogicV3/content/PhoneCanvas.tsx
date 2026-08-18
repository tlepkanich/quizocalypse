import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactNode } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../../lib/quizSchema";
import type { OrderedQuestion, OrderedFlowStep } from "../../../../lib/questionOrder";
import {
  resolveDesignTokens,
  tokensToCssVars,
  suggestContrastText,
} from "../../../../lib/designTokens";
import { googleFontsUrl } from "../../../runtime/runtimeStyles";
import { DeviceFrame, type FrameFit } from "../../../builder/preview/DeviceFrame";
import { DEFAULT_TIER, DEVICES, type DeviceTier } from "../../../builder/preview/previewWidth";
import { CAPTURE_ID, REVEAL_ID } from "../LeftRail";
import { IconDesktop, IconExpand, IconMobile, IconX } from "../icons";
import { PhoneScreen, type ScreenPosition } from "./PhoneScreen";
import { TypeChipSelector } from "./TypeChipSelector";

/* questions-simple mock + questions-full-page — the ✎ Questions tab's live
   preview pane: the centered "Live preview · your brand" chip, the pv-bar
   (step name · answer-type control · Mobile/Desktop segmented control ·
   icon-only Expand), then the SHARED preview primitive. QRTZ-G2: the device
   is the canonical DeviceFrame (previewWidth.DEVICES — phone 390×745,
   desktop 960×700; this file used to hardcode 390×844 / 1180×740 with its
   own fit math that never height-capped the phone, so short viewports cut
   it off). The fit contract is DeviceFrame's — scale = min(paneW/w, paneH/h,
   1), whole frame always visible, never upscaled past 1:1 — and the HOST
   clamps the room it offers: .qz-g2-stage's height tracks the viewport
   between a 410px floor (745 × .55, the readable minimum — below it the
   page scrolls instead of shrinking the phone further) and an 800px cap
   (745 at 1:1 + breathing room). The Quartz frame chrome (borderless phone,
   --qz-phone-r, fold marker; hairline desktop band) comes with DeviceFrame;
   the old faux browser chrome + bottom fade are retired — the in-screen top
   bar now shows on desktop too, the way the live runtime does. Expand is a
   bigger pane, not a zoom: the same DeviceFrame measures a 92vw×90vh host
   (portal to body — the builder-overlay-portal lesson); Esc/✕/click-outside
   close. The screen stays brand-themed by inlining resolveDesignTokens →
   tokensToCssVars. Back/Next drive the REAL walk Q1 → … → Qn → capture →
   reveal; the shell owns `activeId`. Editing lives on the phone and in the
   question list; QRTZ-S5 (mock .qedit-bar): the pv-bar names the shown step
   ("Question 1") and carries the answer-type control (nothing floats over
   the preview). */

export function PhoneCanvas({
  doc,
  steps,
  activeId,
  captureOn,
  designTokens,
  onNavigate,
  onCommit,
}: {
  doc: QuizDoc;
  /** questions-full-page §2 — the FULL flow walk (content steps included). */
  steps: OrderedFlowStep[];
  /** A flow-step node id, CAPTURE_ID, or REVEAL_ID (validated by the shell). */
  activeId: string;
  captureOn: boolean;
  designTokens: DesignTokens | null | undefined;
  onNavigate: (id: string) => void;
  /** Capture-screen inline edits still commit through the doc. */
  onCommit: (doc: QuizDoc) => void;
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

  // The walk order: every flow-ordered step (content included), then the
  // termini. questions-full-page §2 — the counter runs across the WHOLE flow.
  const positions = useMemo(() => {
    const ids = steps.map((s) => s.node.id);
    if (captureOn) ids.push(CAPTURE_ID);
    ids.push(REVEAL_ID);
    return ids;
  }, [steps, captureOn]);
  const posIndex = Math.max(0, positions.indexOf(activeId));
  const stepIdx = steps.findIndex((s) => s.node.id === activeId);
  const stepLabel = stepIdx >= 0 ? `${stepIdx + 1}/${steps.length}` : "";
  const progress = stepIdx >= 0 && steps.length > 0 ? (stepIdx + 1) / steps.length : 1;

  const activeStep = steps.find((s) => s.node.id === activeId) ?? steps[0];
  const position: ScreenPosition =
    activeId === CAPTURE_ID
      ? { kind: "capture" }
      : activeId === REVEAL_ID || !activeStep
        ? { kind: "reveal" }
        : activeStep.kind === "content"
          ? { kind: "content", node: activeStep.node }
          : { kind: "question", question: { node: activeStep.node, qIndex: activeStep.qIndex ?? 1 } as OrderedQuestion };

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

  const [tier, setTier] = useState<DeviceTier>(DEFAULT_TIER);
  const [expanded, setExpanded] = useState(false);
  // questions-artifact (mock .stage-tag) — the size · scale readout under the
  // frame, fed by DeviceFrame's onFit report.
  const [fitScalePct, setFitScalePct] = useState(100);
  const onFit = useCallback(
    (fit: FrameFit) => setFitScalePct(Math.round(fit.scale * 100)),
    [],
  );
  const screenRef = useRef<HTMLDivElement>(null);

  // Scroll resets when the previewed step changes, not on every keystroke.
  useEffect(() => {
    if (screenRef.current) screenRef.current.scrollTop = 0;
  }, [activeId]);

  // Expand: Esc closes (✕ and click-outside live on the scrim below).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const renderFrame = (withScreenRef: boolean): ReactNode => (
    // The brand vars ride the FRAME so the frame background reads the
    // merchant brand — not the admin fallbacks (the screen re-inlines them
    // plus the alpine art background). DeviceFrame owns geometry, radius and
    // elevation; this wrapper is a full-bleed skin (the GuidedPreview
    // .qz-rg-frame pattern).
    <div className="qz-s3-frame" style={cssVars}>
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
          stepLabel={stepLabel}
          progress={progress}
          canBack={posIndex > 0}
          onBack={() => onNavigate(positions[posIndex - 1] ?? positions[0]!)}
          onNext={() =>
            onNavigate(positions[posIndex + 1] ?? positions[positions.length - 1]!)
          }
          onRestart={() => onNavigate(positions[0]!)}
          ctaText={ctaText}
          onCommit={onCommit}
        />
      </div>
    </div>
  );

  const setDeviceTier = useCallback((next: DeviceTier) => setTier(next), []);

  return (
    <aside className="qz-s3-canvas qz-qs-pv">
      {/* questions-artifact — the "Live preview · your brand" chip is retired;
          the pv-bar below is the card's header line (mock .qedit-bar). */}
      {alpine ? (
        <p className="qz-s3-caption is-art-directed">
          Art direction · {artDirection?.name}
        </p>
      ) : null}

      <div className="qz-s3-pvbar">
        {/* QRTZ-S5 (mock .qedit-bar) — the bar names the shown step and, for
            questions, carries the answer-type control (moved here from the
            floating tag beside the phone — nothing floats over the shopper
            preview). NOTE: this reverses the AUDIT-17 floating-tag placement
            on the mock's authority. */}
        <span className="qz-s3-pvlabel">
          {activeId === CAPTURE_ID
            ? "Email capture"
            : activeId === REVEAL_ID
              ? "Result reveal"
              : position.kind === "content"
                ? `Step ${posIndex + 1}`
                : `Question ${posIndex + 1}`}
        </span>
        {position.kind === "question" ? (
          <span className="qz-s3-pvtype">
            <TypeChipSelector doc={doc} node={position.question.node} onCommit={onCommit} />
          </span>
        ) : null}
        <span className="qz-s3-pvsp" />
        <span className="qz-s3-segbtns" role="group" aria-label="Preview device">
          <button
            type="button"
            className={tier === "phone" ? "is-on" : ""}
            aria-pressed={tier === "phone"}
            title="Mobile"
            aria-label="Mobile preview"
            onClick={() => setDeviceTier("phone")}
          >
            <IconMobile />
          </button>
          <button
            type="button"
            className={tier === "desktop" ? "is-on" : ""}
            aria-pressed={tier === "desktop"}
            title="Desktop"
            aria-label="Desktop preview"
            onClick={() => setDeviceTier("desktop")}
          >
            <IconDesktop />
          </button>
        </span>
        {/* questions-full-page §5 — Expand is icon-only (title + aria-label
            retained); behavior unchanged. */}
        <button
          type="button"
          className="qz-s3-expandbtn is-icon"
          title="Expand"
          aria-label="Expand preview"
          onClick={() => setExpanded(true)}
        >
          <IconExpand />
        </button>
      </div>

      <div className="qz-g2-stage">
        <DeviceFrame tier={tier} resetKey={activeId} onFit={onFit}>
          {renderFrame(true)}
        </DeviceFrame>
        {/* questions-artifact (mock .stage-tag) — logical size · fit scale,
            quiet, bottom-right of the stage. */}
        <span className="qz-qf-stagetag" aria-hidden>
          {DEVICES[tier].w} × {DEVICES[tier].h} · {fitScalePct}%
        </span>
      </div>

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
              {/* Expand is a bigger pane, not a zoom: the same DeviceFrame
                  measures this window-sized host and the same fit rule
                  produces the bigger result (never past 1:1). */}
              <div style={{ width: "92vw", height: "90vh" }}>
                <DeviceFrame tier={tier}>{renderFrame(false)}</DeviceFrame>
              </div>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}
