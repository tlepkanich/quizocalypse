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
import { CAPTURE_ID, REVEAL_ID } from "../LeftRail";
import { IconDesktop, IconExpand, IconMobile, IconX } from "../icons";
import { PhoneScreen, type ScreenPosition } from "./PhoneScreen";
import { TypeChipSelector } from "./TypeChipSelector";

/* questions-simple mock + phone-preview SPEC (AUDIT-22) — the ✎ Questions
   tab's 340px preview pane: the mock's centered "Live preview · your brand"
   chip (blinking ok dot), the SPEC's pv-bar (Mobile/Desktop segmented
   control · Expand), then the shared preview primitive — a TRUE-viewport
   device (mobile 390×844, desktop 1180×740) laid out at logical size and
   scaled to fit the pane (`--s = min(paneW/vw, viewportH-fit/vh, 1)`, never
   upscaling past 1:1), minimal bezel (radius 44 + soft shadow), a scrollable
   screen with a bottom scroll fade, and the desktop frame's faux browser
   chrome (dots + blurred URL + top progress). Expand opens the same screen
   in a dimmed overlay (portal to body — the builder-overlay-portal lesson),
   scaled ≥1 for mobile so it is always visibly bigger; Esc/✕/click-outside
   close. The screen stays brand-themed by inlining resolveDesignTokens →
   tokensToCssVars. Back/Next drive the REAL walk Q1 → … → Qn → capture →
   reveal; the shell owns `activeId`. Editing moved to the question list
   (questions-simple): the phone is the live preview — the answer-budget
   banner and the under-phone regen row left this file. QRTZ-S5 (mock
   .qedit-bar): the pv-bar names the shown step ("Question 1") and carries
   the answer-type control; the AUDIT-17 floating tag beside the phone is
   retired on the mock's authority (nothing floats over the preview). */

const DEVICE_DIMS = {
  mobile: { vw: 390, vh: 844 },
  desktop: { vw: 1180, vh: 740 },
} as const;

type DeviceMode = keyof typeof DEVICE_DIMS;

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

  // — SPEC "fit the pane": scale off the pane width (the split's fixed 340px
  //   column) capped by the viewport height — scale the pixels, never the
  //   layout. —
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
      // AUDIT-23 — the width fit leaves the mock's gutters (the 340px pane
      // holds a 312px device: --s .80), so 28px stays around the frame. The
      // MOBILE device keeps the mock's fixed-scale behavior (the page
      // scrolls, exactly like the mock at short viewports); only the wide
      // desktop frame still caps by viewport height.
      const maxH = Math.max(320, window.innerHeight - 210);
      const hFit = device === "desktop" ? maxH / dims.vh : 1;
      const s = Math.max(
        0.2,
        Math.min((stage.clientWidth - 28) / dims.vw, hFit, 1),
      );
      dev.style.setProperty("--s", s.toFixed(3));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [dims, device]);

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
      <span className="qz-s3-fade" aria-hidden />
    </div>
  );

  const setDeviceMode = useCallback((mode: DeviceMode) => setDevice(mode), []);

  return (
    <aside className="qz-s3-canvas qz-qs-pv">
      {/* questions-simple — the centered live chip above the phone. */}
      <div className="qz-qs-pvhead">
        <span className="qz-qs-livechip">
          <span className="qz-qs-livedot" aria-hidden />
          Live preview · your brand
        </span>
      </div>
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

      <div className="qz-s3-stage" ref={stageRef}>
        <div
          className={`qz-s3-device${device === "desktop" ? " is-desktop" : ""}`}
          ref={deviceRef}
          style={deviceStyle}
        >
          <div className="qz-s3-holder">{renderFrame(true)}</div>
        </div>
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
    </aside>
  );
}
