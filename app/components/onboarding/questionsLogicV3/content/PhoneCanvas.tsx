import { useMemo } from "react";
import type { CSSProperties } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../../lib/quizSchema";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";
import {
  resolveDesignTokens,
  tokensToCssVars,
  suggestContrastText,
} from "../../../../lib/designTokens";
import { googleFontsUrl } from "../../../runtime/runtimeStyles";
import { CAPTURE_ID, REVEAL_ID } from "../LeftRail";
import { PhoneScreen, type ScreenPosition } from "./PhoneScreen";

/* quiz-step3 v3 §4 — the Content view's phone canvas: the persistent caption
   pill, a 322px ink-bezel phone whose screen is brand-themed by inlining
   resolveDesignTokens → tokensToCssVars (the TemplatePreviewDrawer fork —
   inside the bezel the merchant brand owns every var), and the ↻ Regenerate
   chip (static this phase; P2 wires it through the existing AI bracket).
   Back/Next drive the REAL walk Q1 → … → Qn → capture → reveal; the shell
   owns the position (`activeId`) so the rail stays in sync. */

export function PhoneCanvas({
  doc,
  questions,
  activeId,
  captureOn,
  designTokens,
  onNavigate,
}: {
  doc: QuizDoc;
  questions: OrderedQuestion[];
  /** A question node id, CAPTURE_ID, or REVEAL_ID (validated by the shell). */
  activeId: string;
  captureOn: boolean;
  designTokens: DesignTokens | null | undefined;
  onNavigate: (id: string) => void;
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

  // The phone's "brand" line — the intro headline is the closest on-doc voice
  // (the real storefront shows the shop brand; the canvas is a preview).
  const introNode = doc.nodes.find((n) => n.type === "intro");
  const brandName =
    (introNode?.type === "intro" ? introNode.data.headline : "") || "Preview";

  return (
    <section className="qz-s3-canvas">
      <p className="qz-s3-caption">
        <span aria-hidden>✎</span> Click any text to change the words · styling lives in
        Design (Step 5)
      </p>

      <div className="qz-s3-phone">
        <div className="qz-s3-phone-screen" style={cssVars}>
          {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
          <PhoneScreen
            doc={doc}
            position={position}
            totalQuestions={questions.length}
            brandName={brandName}
            progress={positions.length > 1 ? (posIndex + 1) / positions.length : 1}
            canBack={posIndex > 0}
            onBack={() => onNavigate(positions[posIndex - 1] ?? positions[0]!)}
            onNext={() =>
              onNavigate(positions[posIndex + 1] ?? positions[positions.length - 1]!)
            }
            onRestart={() => onNavigate(positions[0]!)}
            ctaText={ctaText}
          />
        </div>
      </div>

      <button
        type="button"
        className="qz-s3-regen"
        disabled
        title="Regenerate this question with AI — lands in the next phase"
      >
        ↻ Regenerate
      </button>
    </section>
  );
}
