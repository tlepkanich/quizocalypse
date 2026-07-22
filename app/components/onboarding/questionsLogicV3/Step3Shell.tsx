import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import { insertQuestionRelative } from "../../../lib/quizMutations";
import { orderedQuestions, deciderQuestion } from "../../../lib/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { TopBar3 } from "./TopBar3";
import { pillPresentation } from "./HealthPill";
import { LeftRail, CAPTURE_ID, REVEAL_ID } from "./LeftRail";
import { PhoneCanvas } from "./content/PhoneCanvas";
import { LogicScroll, type LogicScrollHandle } from "./logic/LogicScroll";
import { DiagnoseModal, type DiagnoseTab } from "./logic/DiagnoseModal";

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
  collections,
  productIndex,
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
  // QZY-2 — the fallback chooser's collection picker + the filter counts /
  // V11 dead-end diagnostics / Test-a-path all need the catalog.
  collections: BuilderCollection[];
  productIndex: IndexedProduct[];
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
  const report = useMemo(
    () => buildTier1Report(doc, categories, productIndex),
    [doc, categories, productIndex],
  );

  const captureOn = doc.rec_page_settings?.global?.captureEmail !== false;

  const [view, setView] = useState<Step3View>("content");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // QZY-2 (spec §10) — the ONE diagnose/preview modal; the Fix-N-issues
  // control and a blocked Continue open it on the Diagnostics tab.
  const [diagnose, setDiagnose] = useState<{ open: boolean; tab: DiagnoseTab }>({
    open: false,
    tab: "diagnostics",
  });
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
      setDiagnose({ open: true, tab: "diagnostics" });
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
      setDiagnose((d) => ({ ...d, open: false }));
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

  // QZY-2 (spec §2) — ONE status control top-right: the Fix-N-issues pill
  // (or the healthy/review verdict) opening the diagnose modal's
  // Diagnostics tab. No separate popover chip anymore.
  const pill = pillPresentation(report.verdict);
  const fixControl = (
    <button
      type="button"
      className={`qz-s3-healthpill is-${pill.state}`}
      aria-haspopup="dialog"
      title={report.verdict.label}
      onClick={() => setDiagnose({ open: true, tab: "diagnostics" })}
    >
      <span className="qz-s3-healthdot" aria-hidden />
      {report.verdict.blocking > 0
        ? `Fix ${report.verdict.blocking} issue${report.verdict.blocking === 1 ? "" : "s"}`
        : pill.text}
    </button>
  );

  return (
    <div className="qz-s3">
      <TopBar3
        view={view}
        verdict={report.verdict}
        healthPill={fixControl}
        isSaving={isSaving}
        savedAt={savedAt}
        saveError={saveError}
        onRetry={onRetry}
        navigating={navigating}
        onContinue={handleContinue}
      />

      {view === "content" ? (
        <div className="qz-s3-contentview">
          <div className="qz-s3-subhead qz-s3-subhead--questions">
            <div className="qz-s3-viewtoggle" role="group" aria-label="Questions or Overview view">
              <button type="button" aria-pressed onClick={() => setView("content")}>Questions</button>
              <button type="button" aria-pressed={false} onClick={() => setView("logic")}>Overview</button>
            </div>
            <span className="qz-s3-subhint">Click any text on the preview to edit it</span>
            <button type="button" className="qz-btn qz-btn-accent qz-btn-sm" onClick={addQuestion}>+ Add</button>
          </div>
        <div className="qz-s3-body">
          <LeftRail
            questions={questions}
            deciderId={decider?.id ?? null}
            activeId={activeId}
            captureOn={captureOn}
            onSelect={(id) => setSelectedId(id)}
            onAddQuestion={addQuestion}
            onOpenLibrary={() => setLibraryOpen(true)}
          />
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
        </div>
        </div>
      ) : (
        <div className="qz-s3-logicview">
          {/* Spec §2 — the sub-header: Content-Logic toggle (Logic active) +
              the "+ Diagnose / Preview" entry. No question rail here — the
              map IS the list. */}
          <div className="qz-s3-subhead">
            <div className="qz-s3-viewtoggle" role="group" aria-label="Questions or Overview view">
              <button type="button" aria-pressed={false} onClick={() => setView("content")}>
                Questions
              </button>
              <button type="button" aria-pressed onClick={() => setView("logic")}>
                Overview
              </button>
            </div>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => setDiagnose({ open: true, tab: "test" })}
            >
              + Diagnose / Preview
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={addQuestion}
            >
              + Add question
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm"
              onClick={() => setLibraryOpen(true)}
            >
              Question library
            </button>
          </div>

          {/* Spec §2 — the collapsible "How this quiz resolves" explainer. */}
          <ExplainerStrip />

          <LogicScroll
            ref={logicRef}
            doc={doc}
            questions={questions}
            deciderId={decider?.id ?? null}
            categories={categories}
            collections={collections}
            productIndex={productIndex}
            captureOn={captureOn}
            activeId={activeId}
            onActiveChange={setSelectedId}
            onCommit={onCommit}
          />
        </div>
      )}

      <DiagnoseModal
        open={diagnose.open}
        initialTab={diagnose.tab}
        onClose={() => setDiagnose((d) => ({ ...d, open: false }))}
        doc={doc}
        quizId={quizId}
        report={report}
        categories={categories}
        productIndex={productIndex}
        onCommit={onCommit}
        onFlush={onFlush}
        onNavigate={(link) => {
          // Jump-links land in the LOGIC view's map.
          if (view !== "logic") setView("logic");
          handleHealthNavigate(link);
        }}
      />

      {libraryOpen ? (
        <QuestionBankDrawer doc={doc} onCommit={onCommit} onClose={() => setLibraryOpen(false)} />
      ) : null}
    </div>
  );
}

/* QZY-2 (spec §2) — "How this quiz resolves": pipeline chips on load, an
   info reveal with the plain-English sentence, a chevron collapse. */
function ExplainerStrip() {
  const [collapsed, setCollapsed] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  return (
    <div className="qz-s3-explainer">
      <button
        type="button"
        className="qz-s3-explainer-caret"
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand the resolution explainer" : "Collapse the resolution explainer"}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? "▸" : "▾"}
      </button>
      <span className="qz-s3-explainer-title">How this quiz resolves</span>
      {collapsed ? null : (
        <>
          <span className="qz-s3-explainer-chips" aria-hidden>
            <span className="qz-s3-expchip">Rules</span>
            <span className="qz-s3-exparrow">→</span>
            <span className="qz-s3-expchip is-gold">Picks the result ◆</span>
            <span className="qz-s3-exparrow">→</span>
            <span className="qz-s3-expchip">Filters</span>
            <span className="qz-s3-exparrow">→</span>
            <span className="qz-s3-expchip">Fallback</span>
          </span>
          <button
            type="button"
            className="qz-s3-explainer-info"
            aria-expanded={showInfo}
            aria-label="What does this mean?"
            onClick={() => setShowInfo((v) => !v)}
          >
            ⓘ
          </button>
        </>
      )}
      {!collapsed && showInfo ? (
        <p className="qz-s3-explainer-sentence">
          Rules run first (top to bottom, first match wins), then the question that picks the
          result chooses the recommendation, filter questions narrow it to what fits, and the
          fallback covers a shopper nothing matches.
        </p>
      ) : null}
    </div>
  );
}
