import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import { insertQuestionRelative } from "../../../lib/quizMutations";
import { orderedQuestions, deciderQuestion } from "../questionsLogic/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { TopBar3 } from "./TopBar3";
import { HealthPill } from "./HealthPill";
import { HealthPopover } from "./HealthPopover";
import { LeftRail, CAPTURE_ID, REVEAL_ID } from "./LeftRail";
import { PhoneCanvas } from "./content/PhoneCanvas";
import { LogicScroll, type LogicScrollHandle } from "./logic/LogicScroll";

/* ════════════════════════════════════════════════════════════════════════════
   quiz-step3 v3 — Step3Shell: the two-view (Content · Logic) Step-3 rebuild
   for DECIDER docs, mounted UNCONDITIONALLY by QuestionBuilderStage since the
   QL3-P5 flip (legacy points/ladder docs keep QuestionsLogicLayout). P1 shell
   + rail + phone canvas, P2 inline editing, P3 the Logic view, P4 the live
   health surface: ONE memoized Tier-1 report feeds the pill, the popover's
   check list, AND the Continue gate — the legacy decider ContinueGuard dialog
   was superseded by this gating and its wiring retired in P5.
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
  quizId,
  onCommit,
  onFlush,
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
  quizId: string;
  onCommit: (doc: QuizDoc) => void;
  /** useQuizDraft.flushSave — the Tier-2 review flushes BEFORE hashing. */
  onFlush: () => void;
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
  // P4 — the health popover, CONTROLLED so the blocked Continue can open it.
  const [healthOpen, setHealthOpen] = useState(false);
  // A rule jump-link fired from the Content view: LogicScroll isn't mounted
  // until the view flips, so the target parks here for one render.
  const [pendingRuleJump, setPendingRuleJump] = useState<string | null>(null);
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

  // P4 tri-state Continue — Content: pure view switch (no server intent);
  // Logic + healthy: the stage's existing to-rec-page intent; Logic +
  // blocking: open the health popover instead of advancing. The gate is the
  // SAME report instance the pill and popover render — `verdict.blocking`
  // folds validateQuiz via S1, so "advance enabled" ⇒ the publish gate is
  // clean and the three surfaces cannot disagree.
  const handleContinue = useCallback(() => {
    if (view === "content") {
      setView("logic");
      return;
    }
    if (report.verdict.blocking > 0) {
      setHealthOpen(true);
      return;
    }
    onContinue();
  }, [view, report.verdict.blocking, onContinue]);

  // P4 health jump-links. Question findings: Logic view scrolls the section
  // in with a warn-wash flash; Content view selects the node in the rail —
  // the phone canvas shows it (the simpler correct behavior: the finding is
  // about the question, and the rail selection is the Content view's focus
  // primitive). Rule findings live only in the Logic view — switch first if
  // needed (the jump parks until LogicScroll mounts).
  const handleHealthNavigate = useCallback(
    (link: Tier1Link) => {
      setHealthOpen(false);
      if (link.kind === "question" && link.nodeId) {
        setSelectedId(link.nodeId);
        if (view === "logic") logicRef.current?.scrollToSection(link.nodeId, { flashWarn: true });
        return;
      }
      if (link.kind === "rule" && link.ruleId) {
        if (view === "logic") {
          logicRef.current?.scrollToRule(link.ruleId);
        } else {
          setView("logic");
          setPendingRuleJump(link.ruleId);
        }
      }
    },
    [view],
  );

  useEffect(() => {
    if (view !== "logic" || !pendingRuleJump) return;
    logicRef.current?.scrollToRule(pendingRuleJump);
    setPendingRuleJump(null);
  }, [view, pendingRuleJump]);

  return (
    <div className="qz-s3">
      <TopBar3
        view={view}
        verdict={report.verdict}
        healthPill={
          <HealthPill
            verdict={report.verdict}
            open={healthOpen}
            onOpenChange={setHealthOpen}
            popover={
              <HealthPopover
                report={report}
                doc={doc}
                quizId={quizId}
                onCommit={onCommit}
                onFlush={onFlush}
                onNavigate={handleHealthNavigate}
              />
            }
          />
        }
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
