import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import { deleteNode, insertQuestionRelative, moveStep } from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { orderedQuestions, deciderQuestion } from "../../../lib/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { useFunnelBar, FunnelSaveChip, type FunnelBarOverride } from "../funnelChrome";
import { pillPresentation } from "./HealthPill";
import { LeftRail, CAPTURE_ID, REVEAL_ID } from "./LeftRail";
import { PhoneCanvas } from "./content/PhoneCanvas";
import { IconPlus } from "./icons";
import { LogicScroll, type LogicScrollHandle } from "./logic/LogicScroll";
import { DiagnoseModal, type DiagnoseTab } from "./logic/DiagnoseModal";

/* ════════════════════════════════════════════════════════════════════════════
   quiz-step3 v3 — Step3Shell: the decider editing shell, mounted by
   QuestionBuilderStage (legacy points/ladder docs keep QuestionsLogicLayout).
   One-line-chrome — the former in-shell Content·Logic toggle is now TWO
   funnel steps: `mode` ("content" = the Questions step, "logic" = the Logic
   step) is stage-driven; the shared funnel bar owns navigation, and this
   shell publishes its save chip / health pill / tri-state Continue through
   the funnel-chrome bridge (TopBar3 is retired). ONE memoized Tier-1 report
   still feeds the pill, the diagnose list, AND the Continue gate.
   ════════════════════════════════════════════════════════════════════════════ */

export type Step3View = "content" | "logic";

// A rule jump-link fired from the Questions step lands in the Logic STEP now —
// a stage change remounts this shell, so the target parks module-side (client
// state, same JS session) until the Logic mount picks it up.
let pendingRuleJumpStash: string | null = null;

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
  mode,
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
  /** Which funnel step this mount serves — stage-driven, replaces setView. */
  mode: Step3View;
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
  /** The step's forward intent (the fetcher lives in the stage): to-logic on
   *  the Questions step, to-rec-page on the Logic step. STABLE by contract. */
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

  // One-line-chrome — the view IS the funnel step now; no in-shell toggle.
  const view = mode;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // QZY-2 (spec §10) — the ONE diagnose/preview modal; the Fix-N-issues
  // control and a blocked Continue open it on the Diagnostics tab.
  const [diagnose, setDiagnose] = useState<{ open: boolean; tab: DiagnoseTab }>({
    open: false,
    tab: "diagnostics",
  });
  const logicRef = useRef<LogicScrollHandle>(null);

  // A rule jump stashed by the Questions step lands here once the Logic step
  // mounts (scrollToRule parks unknown ids until the card exists).
  useEffect(() => {
    if (mode !== "logic" || !pendingRuleJumpStash) return;
    const target = pendingRuleJumpStash;
    pendingRuleJumpStash = null;
    logicRef.current?.scrollToRule(target);
  }, [mode]);

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

  // The ▦ Overview's ↑/↓ movers (LogicScroll), via the pure moveStep
  // mutation (rebuilds the straight-through chain; branch/lane edges
  // untouched). Up = before the previous question; down = before the one two
  // ahead (or the run end).
  const moveQuestion = useCallback(
    (id: string, dir: -1 | 1) => {
      const idx = questions.findIndex((q) => q.node.id === id);
      if (idx < 0) return;
      const beforeId =
        dir === -1
          ? questions[idx - 1]?.node.id ?? null
          : questions[idx + 2]?.node.id ?? null;
      if (dir === -1 && idx === 0) return;
      if (dir === 1 && idx === questions.length - 1) return;
      onCommit(moveStep(doc, id, beforeId));
    },
    [doc, questions, onCommit],
  );

  // AUDIT-22 — the questions-simple list's whole-row drag-to-reorder: move
  // the question to the 0-based index (mock splice(from,1) → splice(to,0)
  // semantics), through the same pure moveStep mutation.
  const reorderQuestion = useCallback(
    (id: string, toIndex: number) => {
      const ids = questions.map((q) => q.node.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      const target = Math.max(0, Math.min(ids.length - 1, toIndex));
      if (target === from) return;
      const beforeId = from < target ? ids[target + 1] ?? null : ids[target]!;
      onCommit(moveStep(doc, id, beforeId));
    },
    [doc, questions, onCommit],
  );

  // AUDIT-22 — the list row's inline wording edit (mock contenteditable qtext).
  const renameQuestion = useCallback(
    (id: string, text: string) => {
      onCommit(updateNodeData(doc, id, { text }));
    },
    [doc, onCommit],
  );

  // AUDIT-22 — the list row's hover-trash delete (mock qdel + confirm).
  // deleteNode re-stitches the straight-through chain so the flow never
  // strands. The decider row's delete is disabled in the list (deviation:
  // deleting the deciding question would orphan every mapping — move the
  // role first).
  const deleteQuestion = useCallback(
    (id: string) => {
      if (typeof window !== "undefined" && !window.confirm("Delete this question?")) return;
      onCommit(deleteNode(doc, id));
      if (selectedId === id) setSelectedId(null);
    },
    [doc, onCommit, selectedId],
  );

  // P4 health jump-links. Question findings: Logic step scrolls the section
  // in with a warn-wash flash; Questions step selects the node in the rail —
  // the phone canvas shows it. Rule findings live only in the Logic step —
  // from Questions, stash the target and advance (onContinue = to-logic; the
  // Logic mount picks the stash up).
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
          pendingRuleJumpStash = link.ruleId;
          onContinue();
        }
      }
    },
    [view, onContinue],
  );

  // The bar (one-line-chrome §1.3) — save chip · Fix-N-issues health pill ·
  // the tri-state Continue, published through the funnel-chrome bridge.
  // Questions: always advanceable (to-logic). Logic + healthy: to-rec-page.
  // Logic + blocking: "Fix N issues to continue" stays CLICKABLE and opens
  // the diagnose modal — the gate is the SAME report instance the pill and
  // modal render, so the surfaces cannot disagree.
  const pill = pillPresentation(report.verdict);
  const blocking = report.verdict.blocking;
  const verdictLabel = report.verdict.label;
  const barOverride = useMemo<FunnelBarOverride>(() => {
    const fixLabel = `Fix ${blocking} issue${blocking === 1 ? "" : "s"}`;
    const openDiagnose = () => setDiagnose({ open: true, tab: "diagnostics" });
    return {
      saveChip: (
        <FunnelSaveChip isSaving={isSaving} savedAt={savedAt} saveError={saveError} onRetry={onRetry} />
      ),
      healthPill: (
        <button
          type="button"
          className={`qz-s3-healthpill is-${pill.state}`}
          aria-haspopup="dialog"
          title={verdictLabel}
          onClick={openDiagnose}
        >
          <span className="qz-s3-healthdot" aria-hidden />
          {blocking > 0 ? fixLabel : pill.text}
        </button>
      ),
      continueSpec:
        mode === "logic" && blocking > 0
          ? { label: `${fixLabel} to continue`, blocked: true, disabled: navigating, onClick: openDiagnose }
          : { label: "Continue →", disabled: navigating, onClick: onContinue },
    };
  }, [mode, blocking, verdictLabel, pill.state, pill.text, isSaving, savedAt, saveError, onRetry, navigating, onContinue]);
  useFunnelBar(barOverride);

  return (
    <div className="qz-s3">
      {view === "content" ? (
        <div className="qz-s3-contentview">
          {/* questions-simple (AUDIT-22) — ONE panel: toolbar (title · mono
              count · + New question; the library entry rides along as a quiet
              toolbar action) over the list | 340px live-preview split. */}
          <div className="qz-qs-panel">
            <div className="qz-qs-tool">
              <span className="qz-qs-ttitle">Questions</span>
              <span className="qz-qs-tcount">
                {questions.length} question{questions.length === 1 ? "" : "s"}
              </span>
              <span className="qz-qs-tsp" />
              <button type="button" className="qz-qs-tlib" onClick={() => setLibraryOpen(true)}>
                Question library
              </button>
              <button type="button" className="qz-qs-tbtn" onClick={addQuestion}>
                <IconPlus /> New question
              </button>
            </div>
            <div className="qz-qs-split">
              <LeftRail
                doc={doc}
                questions={questions}
                deciderId={decider?.id ?? null}
                activeId={activeId}
                captureOn={captureOn}
                regen={regen}
                onSelect={(id) => setSelectedId(id)}
                onRename={renameQuestion}
                onReorder={reorderQuestion}
                onDelete={deleteQuestion}
                onCommit={onCommit}
              />
              <PhoneCanvas
                doc={doc}
                questions={questions}
                activeId={activeId}
                captureOn={captureOn}
                designTokens={designTokens}
                onNavigate={setSelectedId}
                onCommit={onCommit}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="qz-s3-logicview">
          {/* Spec §2 — the sub-header: the "+ Diagnose / Preview" entry and
              quick add/library actions. No view toggle anymore — Questions
              and Logic are separate funnel steps navigated from the bar. No
              question rail here — the map IS the list. */}
          <div className="qz-s3-subhead">
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
            onMove={moveQuestion}
            onReorder={reorderQuestion}
            onDelete={deleteQuestion}
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
        onNavigate={handleHealthNavigate}
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
