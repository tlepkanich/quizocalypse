import { useMemo } from "react";
import type { CSSProperties } from "react";
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
import type { RegenApi } from "../Step3Shell";
import { PhoneScreen, type ScreenPosition } from "./PhoneScreen";

/* quiz-step3 v3 §4 — the Content view's phone canvas: the persistent caption
   pill, a 322px ink-bezel phone whose screen is brand-themed by inlining
   resolveDesignTokens → tokensToCssVars (the TemplatePreviewDrawer fork —
   inside the bezel the merchant brand owns every var), and the ↻ Regenerate
   chip (P2: live, driven through the stage's existing beginAiEdit/undo
   bracket — single-flight, 10s Undo, actionable error). Back/Next drive the
   REAL walk Q1 → … → Qn → capture → reveal; the shell owns the position
   (`activeId`) so the rail stays in sync. P2 also adds the >8-answer
   advisory banner under the phone (fitSteps.answersExceedBudget). */

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

  // The phone's "brand" line — the intro headline is the closest on-doc voice
  // (the real storefront shows the shop brand; the canvas is a preview).
  const introNode = doc.nodes.find((n) => n.type === "intro");
  const brandName =
    (introNode?.type === "intro" ? introNode.data.headline : "") || "Preview";

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

  return (
    <section className="qz-s3-canvas">
      <p className={`qz-s3-caption${alpine ? " is-art-directed" : ""}`}>
        <span aria-hidden>{alpine ? "◆" : "✎"}</span>{" "}
        {alpine
          ? `Art direction · ${artDirection?.name}`
          : "Click any text to change the words · styling lives in Design (Step 5)"}
      </p>

      <div className="qz-s3-phone">
        <div
          className={`qz-s3-phone-screen${alpine ? " is-alpine-art" : ""}`}
          data-screen-kind={position.kind}
          style={artScreenStyle}
        >
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
            sectionVars={sectionVars}
            onCommit={onCommit}
            onNavigate={onNavigate}
          />
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
    </section>
  );
}
