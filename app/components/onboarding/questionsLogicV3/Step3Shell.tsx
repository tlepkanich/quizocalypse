import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import {
  deleteNode,
  insertQuestionRelative,
  insertContentRelative,
  moveStep,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { orderedQuestions, orderedFlowSteps, deciderQuestion } from "../../../lib/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { useFunnelBar, FunnelSaveChip, type FunnelBarOverride } from "../funnelChrome";
import { pillPresentation } from "./HealthPill";
import { LeftRail, CAPTURE_ID, REVEAL_ID } from "./LeftRail";
import { OverviewLedger } from "./OverviewLedger";
import { PhoneCanvas } from "./content/PhoneCanvas";
import { IconPlus } from "./icons";
// Logic-tab migration — the funnel's Logic step renders the SAME one-card
// view as the studio builder (docs/design/logic-tab/HANDOFF.md); the
// safety-net config keeps its own section below the card.
import { LogicTabCard } from "../../studio/logicTab/LogicTabCard";
import { FallbackSection } from "./logic/FallbackSection";
import { CaptureModule } from "./logic/CaptureModule";
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
  // questions-full-page §2 — the FULL flow (content steps included): the nav
  // rail, the Overview ledger, and the phone walk all run over this; the
  // logic surfaces stay question-only.
  const flowSteps = useMemo(() => orderedFlowSteps(doc), [doc]);
  const decider = useMemo(() => deciderQuestion(doc), [doc]);
  // The live health verdict — pure + cheap by design, memoized per doc change
  // (powers the pill now, the popover and the Continue gate in P4).
  const report = useMemo(
    () => buildTier1Report(doc, categories, productIndex),
    [doc, categories, productIndex],
  );

  const captureOn = doc.rec_page_settings?.global?.captureEmail !== false;

  // One-line-chrome — the view IS the funnel step now (Questions vs Logic).
  const view = mode;
  // questions-full-page — the Questions STEP's own tab pair (✎ Questions /
  // ▦ Overview) + the mock's draggable nav-column width (min 232).
  const [contentTab, setContentTab] = useState<"questions" | "overview">("questions");
  const [navw, setNavw] = useState(304);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // QZY-2 (spec §10) — the ONE diagnose/preview modal; the Fix-N-issues
  // control and a blocked Continue open it on the Diagnostics tab.
  const [diagnose, setDiagnose] = useState<{ open: boolean; tab: DiagnoseTab }>({
    open: false,
    tab: "diagnostics",
  });
  // Jump-links against the one-card view: scroll the question's table row
  // (data-node-id) into view, or the card itself (rules live at its top).
  const scrollLogicTo = useCallback((nodeId?: string) => {
    if (typeof document === "undefined") return;
    const card = document.querySelector('[data-testid="logic-tab-card"]');
    const el = nodeId
      ? card?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)
      : card;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // A rule jump stashed by the Questions step lands here once the Logic step
  // mounts — rules sit at the top of the card, so the card top IS the target.
  useEffect(() => {
    if (mode !== "logic" || !pendingRuleJumpStash) return;
    pendingRuleJumpStash = null;
    scrollLogicTo();
  }, [mode, scrollLogicTo]);

  // Valid canvas positions; a stale selection (deleted question, capture
  // toggled off) falls back derived-style — no effect needed.
  const activeId = useMemo(() => {
    const valid = new Set(flowSteps.map((s) => s.node.id));
    if (captureOn) valid.add(CAPTURE_ID);
    valid.add(REVEAL_ID);
    if (selectedId && valid.has(selectedId)) return selectedId;
    return flowSteps[0]?.node.id ?? REVEAL_ID;
  }, [selectedId, flowSteps, captureOn]);

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
      // Logic view: glide the new question's table row in once it mounts.
      if (view === "logic") setTimeout(() => scrollLogicTo(newId), 60);
    }
  }, [doc, questions, onCommit, view, scrollLogicTo]);

  // questions-full-page §2 — renumber/drag moves the step to that OVERALL
  // position in the FULL flow (content included), through the pure moveStep
  // mutation. "The old implementation filtered to questions only, which
  // desynced the displayed number from the real index."
  const reorderQuestion = useCallback(
    (id: string, toIndex: number) => {
      const ids = flowSteps.map((s) => s.node.id);
      const from = ids.indexOf(id);
      if (from < 0) return;
      const target = Math.max(0, Math.min(ids.length - 1, toIndex));
      if (target === from) return;
      const beforeId = from < target ? ids[target + 1] ?? null : ids[target]!;
      onCommit(moveStep(doc, id, beforeId));
    },
    [doc, flowSteps, onCommit],
  );

  // "+ Add content page" — splice a message step below the LAST flow step
  // (a movable step, never the terminal — the add-anchor lesson).
  const addContent = useCallback(() => {
    const ref = flowSteps[flowSteps.length - 1]?.node.id;
    if (!ref) return;
    const before = new Set(doc.nodes.map((n) => n.id));
    const next = insertContentRelative(doc, ref, "below");
    const newId = next.nodes.find((n) => !before.has(n.id))?.id ?? null;
    onCommit(next);
    if (newId) setSelectedId(newId);
  }, [doc, flowSteps, onCommit]);

  // AUDIT-22 — the list row's inline wording edit (mock contenteditable qtext).
  const renameQuestion = useCallback(
    (id: string, text: string) => {
      onCommit(updateNodeData(doc, id, { text }));
    },
    [doc, onCommit],
  );

  // AUDIT-22 — the list row's hover-trash delete (mock qdel + confirm).
  // deleteNode re-stitches the straight-through chain so the flow never
  // strands. Works for questions AND content steps (§2 — every step is a
  // first-class row). The decider row's delete stays disabled in the list.
  const deleteQuestion = useCallback(
    (id: string) => {
      const kind = doc.nodes.find((n) => n.id === id)?.type === "question" ? "question" : "content page";
      if (typeof window !== "undefined" && !window.confirm(`Delete this ${kind}?`)) return;
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
        if (view === "logic") scrollLogicTo(link.nodeId);
        return;
      }
      if (link.kind === "rule" && link.ruleId) {
        if (view === "logic") {
          scrollLogicTo(); // rules sit at the top of the card
        } else {
          pendingRuleJumpStash = link.ruleId;
          onContinue();
        }
      }
    },
    [view, onContinue, scrollLogicTo],
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
          {/* questions-full-page — the Questions STEP's own ✎/▦ tab pair
              (Questions = nav rail + resizer + phone editor; Overview = the
              bulk-editing content ledger), the mock's hint line, and the
              add/library actions in the sub-head. */}
          <div className="qz-qf-subhead">
            <div className="qz-s3-viewtoggle" role="group" aria-label="Questions or Overview view">
              <button
                type="button"
                aria-pressed={contentTab === "questions"}
                onClick={() => setContentTab("questions")}
              >
                ✎ Questions
              </button>
              <button
                type="button"
                aria-pressed={contentTab === "overview"}
                onClick={() => setContentTab("overview")}
              >
                ▦ Overview
              </button>
            </div>
            <span className="qz-qf-sp" />
            <span className="qz-qf-hint">
              {contentTab === "questions"
                ? "Click any text on the phone to edit it"
                : "Edit any cell inline"}
            </span>
            <button type="button" className="qz-qs-tlib" onClick={() => setLibraryOpen(true)}>
              Question library
            </button>
            <button type="button" className="qz-qs-tbtn" onClick={addQuestion}>
              <IconPlus /> Add
            </button>
          </div>

          {contentTab === "questions" ? (
            <div className="qz-qf-panel">
              <div
                className="qz-qf-view"
                style={{ "--navw": `${navw}px` } as CSSProperties}
              >
                <LeftRail
                  steps={flowSteps}
                  deciderId={decider?.id ?? null}
                  activeId={activeId}
                  captureOn={captureOn}
                  regen={regen}
                  onSelect={(id) => setSelectedId(id)}
                  onRename={renameQuestion}
                  onReorder={reorderQuestion}
                  onDelete={deleteQuestion}
                  onAdd={addQuestion}
                  onAddContent={addContent}
                />
                {/* mock .resizer — drag to resize the nav column (232..max). */}
                <div
                  className="qz-qf-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize the question list"
                  onPointerDown={(e) => {
                    const grid = (e.currentTarget as HTMLElement).parentElement;
                    if (!grid) return;
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    const startX = e.clientX;
                    const startW = navw;
                    const max = grid.clientWidth - 360;
                    const move = (ev: PointerEvent) => {
                      setNavw(Math.max(232, Math.min(max, startW + (ev.clientX - startX))));
                    };
                    const up = () => {
                      document.removeEventListener("pointermove", move);
                      document.removeEventListener("pointerup", up);
                    };
                    document.addEventListener("pointermove", move);
                    document.addEventListener("pointerup", up);
                  }}
                />
                <PhoneCanvas
                  doc={doc}
                  steps={flowSteps}
                  activeId={activeId}
                  captureOn={captureOn}
                  designTokens={designTokens}
                  onNavigate={setSelectedId}
                  onCommit={onCommit}
                />
              </div>
            </div>
          ) : (
            <OverviewLedger
              doc={doc}
              steps={flowSteps}
              deciderId={decider?.id ?? null}
              onCommit={onCommit}
              onReorder={reorderQuestion}
              onDelete={deleteQuestion}
            />
          )}
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

          <LogicTabCard
            doc={doc}
            questions={questions}
            categories={categories}
            collections={collections}
            productIndex={productIndex}
            commit={onCommit}
            quizId={quizId}
          />
          {/* The safety-net + quiz-ending configs keep their own sections —
              they were part of the old scroll, not of the card design. */}
          <FallbackSection
            doc={doc}
            collections={collections}
            productIndex={productIndex}
            onCommit={onCommit}
          />
          <CaptureModule doc={doc} captureOn={captureOn} onCommit={onCommit} />
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
