import { useCallback, useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { buildTier1Report } from "../../../lib/pathReport";
import { insertQuestionRelative } from "../../../lib/quizMutations";
import { orderedQuestions, deciderQuestion } from "../questionsLogic/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { TopBar3 } from "./TopBar3";
import { LeftRail, CAPTURE_ID, REVEAL_ID } from "./LeftRail";
import { PhoneCanvas } from "./content/PhoneCanvas";
import { LogicScroll, type LogicScrollHandle } from "./logic/LogicScroll";

/* ════════════════════════════════════════════════════════════════════════════
   quiz-step3 v3 — Step3Shell: the two-view (Content · Logic) Step-3 rebuild
   for DECIDER docs, mounted by QuestionBuilderStage behind the client-read
   `?step3=v3` flag (the legacy QuestionsLogicLayout stays the default until
   P5 flips). This phase (P1) is read-mostly: floating top bar (TopBar3) +
   the flow rail + the brand-themed phone canvas with a real Back/Next walk;
   the Logic view is a per-question stub scroll (P3 fills it), inline editing
   lands in P2, health popover + the full Continue tri-state in P4.
   ════════════════════════════════════════════════════════════════════════════ */

export type Step3View = "content" | "logic";

/** The stage's existing per-question AI-regenerate bracket (startRegenerate +
    pendingId + the 10s undo snapshot), threaded down to the canvas chip —
    the SAME api QuestionBuilderStage hands the legacy QuestionsLogicLayout. */
export type RegenApi = {
  regeneratingId: string | null;
  undoNodeId: string | null;
  regenError: { nodeId: string; message: string; credits: boolean } | null;
  onRegenerate: (nodeId: string) => void;
  onUndoRegenerate: () => void;
  onDismissRegenError: () => void;
};

export function Step3Shell({
  doc,
  onCommit,
  isSaving,
  savedAt,
  saveError,
  onRetry,
  categories,
  navigating,
  onContinue,
  designTokens,
  regen,
}: {
  doc: QuizDoc;
  onCommit: (doc: QuizDoc) => void;
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
  categories: BuilderCategory[];
  navigating: boolean;
  /** Fires the existing to-rec-page intent (the fetcher lives in the stage). */
  onContinue: () => void;
  designTokens: DesignTokens | null | undefined;
  regen: RegenApi;
}) {
  const questions = useMemo(() => orderedQuestions(doc), [doc]);
  const decider = useMemo(() => deciderQuestion(doc), [doc]);
  // The live health verdict — pure + cheap by design, memoized per doc change
  // (powers the pill now, the popover and the Continue gate in P4).
  const report = useMemo(() => buildTier1Report(doc, categories), [doc, categories]);

  const captureOn = doc.rec_page_settings?.global?.captureEmail !== false;

  const [view, setView] = useState<Step3View>("content");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const logicRef = useRef<LogicScrollHandle>(null);

  // Valid canvas positions; a stale selection (deleted question, capture
  // toggled off) falls back derived-style — no effect needed.
  const activeId = useMemo(() => {
    const valid = new Set(questions.map((q) => q.node.id));
    if (captureOn) valid.add(CAPTURE_ID);
    valid.add(REVEAL_ID);
    if (selectedId && valid.has(selectedId)) return selectedId;
    return questions[0]?.node.id ?? REVEAL_ID;
  }, [selectedId, questions, captureOn]);

  // "+ New question" — insert below the LAST question (insertQuestionRelative
  // anchors on a movable step, never the terminal — the add-anchor lesson).
  const addQuestion = useCallback(() => {
    const ref = questions[questions.length - 1]?.node.id;
    if (!ref) return;
    const before = new Set(doc.nodes.map((n) => n.id));
    const next = insertQuestionRelative(doc, ref, "below");
    const newId = next.nodes.find((n) => !before.has(n.id))?.id ?? null;
    onCommit(next);
    if (newId) {
      setSelectedId(newId);
      // Logic view: glide the new section in once it mounts (scrollToSection
      // parks unknown ids until the card exists).
      if (view === "logic") logicRef.current?.scrollToSection(newId);
    }
  }, [doc, questions, onCommit, view]);

  const handleContinue = useCallback(() => {
    if (view === "content") {
      setView("logic");
      return;
    }
    // Logic view: TopBar3 renders the blocked state itself (click no-ops
    // there); a healthy verdict advances to Results via the real intent.
    if (report.verdict.blocking === 0) onContinue();
  }, [view, report.verdict.blocking, onContinue]);

  return (
    <div className="qz-s3">
      <TopBar3
        view={view}
        verdict={report.verdict}
        isSaving={isSaving}
        savedAt={savedAt}
        saveError={saveError}
        onRetry={onRetry}
        navigating={navigating}
        onContinue={handleContinue}
      />

      <div className="qz-s3-body">
        <LeftRail
          questions={questions}
          deciderId={decider?.id ?? null}
          activeId={activeId}
          view={view}
          captureOn={captureOn}
          onViewChange={setView}
          onSelect={(id) => {
            setSelectedId(id);
            // Logic view: a rail click scrolls its section (bidirectional
            // sync); Content view keeps the phone walk as before.
            if (view === "logic") logicRef.current?.scrollToSection(id);
          }}
          onAddQuestion={addQuestion}
          onOpenLibrary={() => setLibraryOpen(true)}
        />

        {view === "content" ? (
          <PhoneCanvas
            doc={doc}
            questions={questions}
            activeId={activeId}
            captureOn={captureOn}
            designTokens={designTokens}
            deciderId={decider?.id ?? null}
            onNavigate={setSelectedId}
            onCommit={onCommit}
            regen={regen}
          />
        ) : (
          <LogicScroll
            ref={logicRef}
            doc={doc}
            questions={questions}
            deciderId={decider?.id ?? null}
            categories={categories}
            activeId={activeId}
            onActiveChange={setSelectedId}
            onEditContent={(id) => {
              setSelectedId(id);
              setView("content");
            }}
            onCommit={onCommit}
          />
        )}
      </div>

      {libraryOpen ? (
        <QuestionBankDrawer doc={doc} onCommit={onCommit} onClose={() => setLibraryOpen(false)} />
      ) : null}
    </div>
  );
}
