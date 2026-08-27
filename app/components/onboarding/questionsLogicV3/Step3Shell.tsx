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
// Owner decision (2026-08-18) — the funnel Questions step is the ✎ view ONLY.
// The ▦ Overview tab is retired HERE but ./OverviewLedger.tsx stays parked:
// it is earmarked for the main builder later. Do not delete it.
import { PhoneCanvas } from "./content/PhoneCanvas";
// Logic-tab migration — the funnel's Logic step renders the SAME two-card
// view as the studio builder (docs/design/logic-tab/HANDOFF.md + QRTZ-G3:
// the artifact's Rules card + Questions card, nothing else). The fallback
// config moved to the Results step (resultsGuided); the capture config moved
// to the Questions step's Email-capture rail row.
import { LogicTabCard } from "../../studio/logicTab/LogicTabCard";
import { CaptureModule } from "./logic/CaptureModule";
import { DiagnoseModal, type DiagnoseTab } from "./logic/DiagnoseModal";
import {
  LogicStyleChooser,
  buildChooserScan,
  type LogicStyle,
} from "./logic/LogicStyleChooser";

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
  onPickLogicStyle,
  designTokens,
  regen,
  lastSyncAt,
  shopifyAdminDomain,
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
  /** Logic-step §2 — persists the chooser's pick (set-logic-style intent).
   *  STABLE by contract, same as onContinue. */
  onPickLogicStyle: (style: LogicStyle) => void;
  designTokens: DesignTokens | null | undefined;
  regen: RegenApi;
  /** QRTZ-B2 — threaded to the Logic card's products popover. */
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
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

  // ── Logic-step §2 — the style chooser, once per quiz ──────────────────────
  // The persisted pick (server-owned build_session) wins; a just-clicked card
  // shows the workspace immediately while the intent lands (localStyle); and
  // a quiz that ALREADY has logic work infers its style rather than asking a
  // question it has effectively answered (rules or filter roles predate the
  // chooser — interrupting them would be noise, and the style bar's Switch
  // stays available). A genuinely fresh Logic step resolves to null → chooser.
  const [localStyle, setLocalStyle] = useState<LogicStyle | null>(null);
  const sessionStyle = doc.build_session?.logic_style ?? null;
  const logicStyle = useMemo<LogicStyle | null>(() => {
    if (sessionStyle) return sessionStyle;
    if (localStyle) return localStyle;
    const hasFilter = questions.some((q) => q.node.data.role === "filter");
    if (hasFilter) return "attributes";
    if ((doc.decision_rules ?? []).length > 0) return "rules";
    return null;
  }, [sessionStyle, localStyle, questions, doc.decision_rules]);
  const pickLogicStyle = useCallback(
    (style: LogicStyle) => {
      setLocalStyle(style);
      onPickLogicStyle(style);
    },
    [onPickLogicStyle],
  );
  // Live .lbar's computed line + the chooser's scan (§10 read-out; the
  // strong counts arrive once buildAttributeReadout is wired — until then
  // the scan degrades to the product count, which the chooser handles).
  const narrowCount = useMemo(
    () => questions.filter((q) => q.node.data.role === "filter").length,
    [questions],
  );
  const chooserScan = useMemo(
    () => buildChooserScan(productIndex),
    [productIndex],
  );

  // One-line-chrome — the view IS the funnel step now (Questions vs Logic).
  const view = mode;
  // questions-full-page — the mock's draggable nav-column width (min 232;
  // questions-artifact starts at the artifact's ~24vw resting width).
  const [navw, setNavw] = useState(340);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  // QZY-2 (spec §10) — the diagnose/preview modal. QRTZ-G3: its Logic-view
  // subhead entry is gone (the artifact draws none); the Fix-N-issues health
  // pill and a blocked Continue are its remaining doors, both landing on the
  // Diagnostics tab (Test-a-path stays reachable inside the modal).
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

  // Valid canvas positions; a stale selection (deleted question) falls back
  // derived-style — no effect needed. QRTZ-G3: CAPTURE_ID is always valid —
  // the Email-capture rail row is the capture CONFIG surface now, so it must
  // stay selectable even while capture is switched off (to switch it back on).
  const activeId = useMemo(() => {
    const valid = new Set(flowSteps.map((s) => s.node.id));
    valid.add(CAPTURE_ID);
    valid.add(REVEAL_ID);
    if (selectedId && valid.has(selectedId)) return selectedId;
    return flowSteps[0]?.node.id ?? REVEAL_ID;
  }, [selectedId, flowSteps]);

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

  // The bar (one-line-chrome §1.3) — save chip (error-only) · the tri-state
  // Continue, published through the funnel-chrome bridge. Owner 2026-08-18:
  // the ambient "Logic valid" health pill is GONE from the nav — the pill
  // renders only in its Fix-N-issues state (a functional door into the
  // diagnose modal, not status decoration). Questions: always advanceable
  // (to-logic). Logic + healthy: to-rec-page. Logic + blocking: "Fix N
  // issues to continue" stays CLICKABLE and opens the diagnose modal — the
  // gate is the SAME report instance the pill and modal render, so the
  // surfaces cannot disagree.
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
      healthPill:
        blocking > 0 ? (
          <button
            type="button"
            className={`qz-s3-healthpill is-${pill.state}`}
            aria-haspopup="dialog"
            title={verdictLabel}
            onClick={openDiagnose}
          >
            <span className="qz-s3-healthdot" aria-hidden />
            {fixLabel}
          </button>
        ) : undefined,
      continueSpec:
        mode === "logic" && blocking > 0
          ? { label: `${fixLabel} to continue`, blocked: true, disabled: navigating, onClick: openDiagnose }
          : { label: "Continue →", disabled: navigating, onClick: onContinue },
    };
  }, [mode, blocking, verdictLabel, pill.state, isSaving, savedAt, saveError, onRetry, navigating, onContinue]);
  useFunnelBar(barOverride);

  return (
    <div className="qz-s3">
      {view === "content" ? (
        <div className="qz-s3-contentview">
          {/* questions-artifact (owner, 2026-08-18) — the step IS the card:
              no sub-head above it (the hint is gone; Question library and the
              add actions live in the rail's sticky foot), the ✎/▦ tab pair is
              retired (OverviewLedger stays parked for the main builder), and
              the card runs bigger — 1200px resting, 1400px while the desktop
              preview is on (the .qz-page.is-funnel :has() rules). */}
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
                onOpenLibrary={() => setLibraryOpen(true)}
                capturePanel={
                  /* QRTZ-G3 — the capture CONFIG (formerly the Logic
                     step's CaptureModule, unchanged) opens under the
                     Email-capture row while that row is selected. */
                  activeId === CAPTURE_ID ? (
                    <CaptureModule doc={doc} captureOn={captureOn} onCommit={onCommit} />
                  ) : null
                }
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
        </div>
      ) : logicStyle === null ? (
        <div className="qz-s3-logicview">
          {/* Logic-step §2 / Live screen A — first entry lands on the style
              chooser, once per quiz. Point based is inert; both live picks
              land on the same workspace below (the same logic_model). */}
          <LogicStyleChooser scan={chooserScan} onPick={pickLogicStyle} />
        </div>
      ) : (
        <div className="qz-s3-logicview">
          {/* Live screen B/K — the workspace's own heading + the one
              collapsible explainer (onboarding: useful once, noise on the
              tenth visit). */}
          <h1 className="qz-ls-h1">What should each answer do?</h1>
          <details className="qz-ls-ledebox" open>
            <summary>How this works</summary>
            <p className="qz-ls-lede">
              {logicStyle === "rules" ? (
                <>
                  <b>Every outcome is a rule you write</b> — it says which products
                  to recommend, based on how someone answered.
                  <span className="qz-ls-ll is-ex">
                    If they answer <b>an answer</b> and <b>another</b>, show{" "}
                    <b>a result</b>.
                  </span>
                </>
              ) : (
                <>
                  <b>First</b> pick which question decides how to prioritize your
                  set of products.
                  <span className="qz-ls-ll">
                    <b>Some</b> narrow that set by matching answers to values
                    already in your catalog.
                  </span>
                  <span className="qz-ls-ll">
                    <b>The rest</b> just collect an answer and leave the products
                    alone.
                  </span>
                  <span className="qz-ls-ll">
                    <b>Rules</b> at the bottom cover anything those three cannot
                    say.
                  </span>
                </>
              )}
            </p>
          </details>
          {/* Live .lbar — Style · name · the computed line · Switch (right).
              "✓ Check my logic" stays: the revived Logic Checker door (owner
              ask; the nav stays untouched). Same DiagnoseModal as the pill. */}
          <div className="qz-lsb" data-testid="logic-style-bar">
            <span className="qz-lsb-label">Style</span>
            <span className="qz-lsb-style">
              {logicStyle === "attributes" ? "Attributes + Rules" : "Rules only"}
            </span>
            <span className="qz-lsb-note">
              ·{" "}
              {logicStyle === "rules"
                ? "no question narrows — rules decide everything"
                : `${narrowCount} question${narrowCount === 1 ? "" : "s"} narrow${
                    narrowCount === 1 ? "s" : ""
                  } the catalog`}
            </span>
            <span className="qz-lsb-right">
              <button
                type="button"
                className="qz-lsb-check"
                aria-haspopup="dialog"
                onClick={() => setDiagnose({ open: true, tab: "diagnostics" })}
              >
                ✓ Check my logic
              </button>
              <button
                type="button"
                className="qz-lsb-switch"
                onClick={() =>
                  pickLogicStyle(logicStyle === "attributes" ? "rules" : "attributes")
                }
              >
                Switch to{" "}
                {logicStyle === "attributes" ? "rules only" : "attributes + rules"}
              </button>
            </span>
          </div>
          {/* QRTZ-G3 — the artifact's Logic screen is EXACTLY two cards,
              Rules then Questions (shared.mjs screenLogic), nothing else.
              The subhead entries, the "How this quiz resolves" strip, the
              fallback and capture modules are gone from this surface: the
              fallback config lives on the Results step (resultsGuided), the
              capture config on the Questions step's Email-capture rail row.
              Diagnose stays reachable through the bar's health pill. */}
          <LogicTabCard
            doc={doc}
            questions={questions}
            categories={categories}
            collections={collections}
            productIndex={productIndex}
            commit={onCommit}
            quizId={quizId}
            lastSyncAt={lastSyncAt}
            shopifyAdminDomain={shopifyAdminDomain}
            logicStyle={logicStyle}
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

