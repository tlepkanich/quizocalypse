import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Quiz as QuizDoc, DesignTokens } from "../../../lib/quizSchema";
import type { BuilderCategory, BuilderCollection } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { buildTier1Report, type Tier1Link } from "../../../lib/pathReport";
import { resolveLogicStyle, type LogicStyle } from "../../../lib/logicStyle";
import {
  deleteNode,
  insertQuestionRelative,
  insertContentRelative,
  moveStep,
  setLogicStyle,
} from "../../../lib/quizMutations";
import { updateNodeData } from "../../studio/studioDoc";
import { orderedQuestions, orderedFlowSteps, deciderQuestion } from "../../../lib/questionOrder";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { useFunnelBar, FunnelSaveChip, type FunnelBarOverride } from "../funnelChrome";
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
import { LogicTabCard, type LogicFocusRequest } from "../../studio/logicTab/LogicTabCard";
import type { LogicCatalog } from "../../studio/logicTab/AddRecommendationsDialog";
import { CHECK_COPY } from "../../studio/logicTab/logicCopy";
import type { SaveToken } from "../../studio/saveTracker";
import { CaptureModule } from "./logic/CaptureModule";
import { CheckPopover, type CheckRow } from "./logic/CheckPopover";
// Logic step redesign (D5, D23, D4): the first-entry LogicStyleChooser, the
// CatalogStrip, the style bar and the DiagnoseModal door are unmounted from
// this step. Their files stay on disk (LogicStyleChooser/CatalogStrip lose
// their only importer; DiagnoseModal is the surface diagnostics come back to
// when D4 is un-parked). Do not delete them without the owner.

/* ════════════════════════════════════════════════════════════════════════════
   quiz-step3 v3 — Step3Shell: the decider editing shell, mounted by
   QuestionBuilderStage (legacy points/ladder docs keep QuestionsLogicLayout).
   One-line-chrome — the former in-shell Content·Logic toggle is now TWO
   funnel steps: `mode` ("content" = the Questions step, "logic" = the Logic
   step) is stage-driven; the shared funnel bar owns navigation, and this
   shell publishes its save chip and tri-state Continue through the
   funnel-chrome bridge. Logic step redesign: ONE memoized, style-aware
   Tier-1 report feeds the CTA's "Fix N issues to continue" AND the check
   popover anchored under it (the only door, D4); no health pill.
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
  commitTracked,
  onFlush,
  isAiPaused = false,
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
  lastSyncAt,
  shopifyAdminDomain,
  catalog,
}: {
  doc: QuizDoc;
  quizId: string;
  /** Which funnel step this mount serves — stage-driven, replaces setView. */
  mode: Step3View;
  onCommit: (doc: QuizDoc) => void;
  /** useQuizDraft.commitTracked — SaveTokens for the field save pill (D8). */
  commitTracked?: (doc: QuizDoc) => SaveToken;
  /** Flush the autosave and wait; resolves false when the save failed.
   *  Published as the bar's beforeNavigate (Back / stepper). STABLE. */
  onFlush: () => Promise<boolean>;
  /** useQuizDraft.isAiPaused — the save chip's "Paused while AI edits". */
  isAiPaused?: boolean;
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
  /** QRTZ-B2 — threaded to the Logic card's products popover. */
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
  /** The funnel loader's catalogue, for the Logic card's Add
   *  recommendations window (passed through untouched). */
  catalog?: LogicCatalog;
}) {
  const questions = useMemo(() => orderedQuestions(doc), [doc]);
  // questions-full-page §2 — the FULL flow (content steps included): the nav
  // rail, the Overview ledger, and the phone walk all run over this; the
  // logic surfaces stay question-only.
  const flowSteps = useMemo(() => orderedFlowSteps(doc), [doc]);
  const decider = useMemo(() => deciderQuestion(doc), [doc]);
  // The ONE style-aware Tier-1 report (D3): the CTA count and the check
  // popover read this instance, so they cannot disagree. It checks the
  // ENGINE style (engineLogicStyle, inside the report); R5 iterates this
  // quiz's recommendations; R0 (the unsaved-style note) is opted in because
  // this host has the title switch.
  const recommendationIds = useMemo(
    () => categories.filter((c) => c.quizId != null).map((c) => c.id),
    [categories],
  );
  const report = useMemo(
    () => buildTier1Report(doc, categories, productIndex, { recommendationIds, styleNote: true }),
    [doc, categories, productIndex, recommendationIds],
  );

  const captureOn = doc.rec_page_settings?.global?.captureEmail !== false;

  // ── Logic step redesign (D1, D5) — the style lives on the DOC ─────────────
  // The screen style resolves in one pure helper (saved field → legacy
  // build_session key → inference → Filter Results + Rules) and NOTHING is
  // written on load. The title switch commits setLogicStyle through the
  // draft (autosave), so a Back → Continue round trip keeps it by
  // construction. Choosing the style already shown still writes it: on an
  // inferred draft that one click makes it real (setLogicStyle no-ops only
  // when the stored field already matches).
  const logicStyle = resolveLogicStyle(doc);
  const docRef = useRef(doc);
  docRef.current = doc;
  const pickLogicStyle = useCallback(
    (style: LogicStyle) => {
      const latest = docRef.current;
      const next = setLogicStyle(latest, style);
      if (next !== latest) onCommit(next);
    },
    [onCommit],
  );
  // Check popover (anchored to the bar CTA) + the focus request it sends.
  const [checkOpen, setCheckOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<LogicFocusRequest | null>(null);
  const nonce = useRef(0);
  const request = useCallback((r: DistributiveOmit<LogicFocusRequest, "nonce">) => {
    nonce.current += 1;
    setFocusRequest({ ...r, nonce: nonce.current } as LogicFocusRequest);
  }, []);

  // One-line-chrome — the view IS the funnel step now (Questions vs Logic).
  const view = mode;
  // questions-full-page — the mock's draggable nav-column width (min 232;
  // questions-artifact starts at the artifact's ~24vw resting width).
  const [navw, setNavw] = useState(340);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
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
  // mounts: the card selects and scrolls to that rule (no window: the merchant
  // arrived from elsewhere and gets to see the row first).
  useEffect(() => {
    if (mode !== "logic" || !pendingRuleJumpStash) return;
    const ruleId = pendingRuleJumpStash;
    pendingRuleJumpStash = null;
    request({ kind: "rule", id: ruleId, open: false });
  }, [mode, request]);

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
  // Logic step redesign (B38): a jump sends a focus request to the card,
  // which switches to Edit first and then selects / opens the target.
  const handleHealthNavigate = useCallback(
    (link: Tier1Link, opts: { open?: boolean } = {}) => {
      setCheckOpen(false);
      if (view !== "logic") {
        if (link.kind === "question" && link.nodeId) {
          setSelectedId(link.nodeId);
          scrollLogicTo(link.nodeId);
        } else if (link.kind === "rule" && link.ruleId) {
          pendingRuleJumpStash = link.ruleId;
          onContinue();
        }
        return;
      }
      switch (link.kind) {
        case "question":
          if (link.nodeId) request({ kind: "question", id: link.nodeId });
          return;
        case "rule":
          if (link.ruleId) request({ kind: "rule", id: link.ruleId, open: opts.open !== false });
          return;
        case "rules":
          request(rulesLinkIsEmpty(docRef.current) ? { kind: "create" } : { kind: "rules" });
          return;
        case "recommendation":
          if (link.categoryId) {
            request({
              kind: "recommendation",
              id: link.categoryId,
              ...(link.nodeId ? { questionId: link.nodeId } : {}),
            });
          }
          return;
        case "style":
          request({ kind: "style" });
          return;
      }
    },
    [view, onContinue, scrollLogicTo, request],
  );
  const onCheckJump = useCallback(
    (row: CheckRow) => {
      if (row.link) {
        // V8 (shadowed): the fix is a reorder, so scroll to the rule and do
        // not open the window (handoff "Row actions").
        handleHealthNavigate(row.link, { open: row.checkId !== "V8" });
        return;
      }
      // V1 with no picking question (mock "fixpick"): the first question,
      // its role control asked for (the pane focuses it).
      const first = questions[0]?.node.id;
      setCheckOpen(false);
      if (first) request({ kind: "question", id: first, control: "role" });
    },
    [handleHealthNavigate, questions, request],
  );

  // The bar (one-line-chrome §1.3) — the save chip (errors and AI pauses
  // only, D8) and the tri-state Continue, published through the
  // funnel-chrome bridge. Logic step redesign (D3/D4): no health pill; while
  // something blocks, the CTA reads "Fix N issues to continue" in the
  // outlined crit look and toggles the check popover anchored under it.
  // Every field is memoized on real state; handlers are stable.
  const blocking = report.verdict.blocking;
  // The popover lives on the blocked CTA only: once nothing blocks, it is
  // closed for good (never reopening by itself when a block comes back).
  useEffect(() => {
    if (blocking === 0) setCheckOpen(false);
  }, [blocking]);
  const checkContent = useMemo(
    () => <CheckPopover report={report} onJump={onCheckJump} />,
    [report, onCheckJump],
  );
  const barOverride = useMemo<FunnelBarOverride>(() => {
    return {
      saveChip: (
        <FunnelSaveChip
          isSaving={isSaving}
          savedAt={savedAt}
          saveError={saveError}
          onRetry={onRetry}
          isAiPaused={isAiPaused}
        />
      ),
      beforeNavigate: onFlush,
      continueSpec:
        mode === "logic" && blocking > 0
          ? {
              label: CHECK_COPY.ctaBlocked(blocking),
              blocked: true,
              blockedLook: "outline",
              disabled: navigating,
              onClick: () => setCheckOpen((o) => !o),
              popover: {
                content: checkContent,
                open: checkOpen,
                onOpenChange: setCheckOpen,
                width: 360,
                ariaLabel: CHECK_COPY.label,
              },
            }
          : { label: "Continue →", disabled: navigating, loading: navigating, onClick: onContinue },
    };
  }, [
    mode,
    blocking,
    isSaving,
    savedAt,
    saveError,
    onRetry,
    isAiPaused,
    onFlush,
    navigating,
    onContinue,
    checkContent,
    checkOpen,
  ]);
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
      ) : (
        <div className="qz-s3-logicview">
          {/* Logic step redesign (D23): no page heading, "How this works",
              catalog strip, style bar or "Check my logic": the card's own
              header carries the title switch and the description. */}
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
            ruleFlow="onboarding"
            style={logicStyle}
            onStyleChange={pickLogicStyle}
            showHeader
            headingLevel="h1"
            focusRequest={focusRequest}
            {...(catalog ? { catalog } : {})}
            {...(commitTracked ? { commitTracked } : {})}
          />
        </div>
      )}

      {libraryOpen ? (
        <QuestionBankDrawer doc={doc} onCommit={onCommit} onClose={() => setLibraryOpen(false)} />
      ) : null}
    </div>
  );
}

/** Omit distributed over a union (keeps each LogicFocusRequest variant). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** "rules" findings: with no rules at all the fix is a blank rule window. */
function rulesLinkIsEmpty(doc: QuizDoc): boolean {
  return (doc.decision_rules ?? []).length === 0;
}
