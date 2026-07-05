import { useCallback, useMemo, useState } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { buildTier1Report } from "../../../lib/pathReport";
import { insertQuestionRelative } from "../../../lib/quizMutations";
import { orderedQuestions, deciderQuestion } from "../questionsLogic/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { TopBar3 } from "./TopBar3";
import { LeftRail, CAPTURE_ID, REVEAL_ID } from "./LeftRail";
import { PhoneCanvas } from "./content/PhoneCanvas";

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
    if (newId) setSelectedId(newId);
  }, [doc, questions, onCommit]);

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
            if (view !== "content") setView("content");
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
            onNavigate={setSelectedId}
          />
        ) : (
          // P3 replaces this stub scroll with the real per-question section
          // cards (palette, flag tabs, answers table, distributed rules).
          <div className="qz-s3-logicstub" aria-label="Logic view (coming next)">
            {questions.map((q) => (
              <div key={q.node.id} className="qz-s3-stubcard">
                <span
                  className={`qz-s3-numchip${q.node.id === decider?.id ? " is-decider" : ""}`}
                >
                  {q.qIndex}
                </span>
                <div className="qz-s3-stubbody">
                  <strong className="qz-s3-stubtitle">{q.node.data.text}</strong>
                  <span className="qz-s3-stubnote">
                    {q.node.id === decider?.id
                      ? "◆ Decides the result — the full logic editor lands in the next phase."
                      : "Logic editing for this question lands in the next phase."}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {libraryOpen ? (
        <QuestionBankDrawer doc={doc} onCommit={onCommit} onClose={() => setLibraryOpen(false)} />
      ) : null}
    </div>
  );
}
