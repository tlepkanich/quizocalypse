import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { stepNumber, TOTAL_STEPS } from "../../../lib/funnelStages";
import {
  swapScoringModel,
  insertQuestionRelative,
  duplicateQuestionNode,
  moveStep,
  deleteNode,
} from "../../../lib/quizMutations";
import { orderedQuestions, bucketMappedCounts, orphanedBucketIds } from "./questionOrder";
import { QuestionList, type RowAction } from "./QuestionList";
import { OutcomeCoverage } from "./OutcomeCoverage";
import { QuestionCard } from "./QuestionCard";
import { TableView } from "./TableView";
import { ContinueGuard } from "./ContinueGuard";
import { QuestionBankDrawer } from "../../studio/QuestionBankDrawer";
import { LogicFlowMap } from "../../logic/LogicFlowMap";
import type { TableFilter } from "./tableFilters";
import type { SkipOption } from "./AnswerRow";

const NODE_TYPE_LABEL: Record<string, string> = {
  result: "Result page",
  message: "Message",
  email_gate: "Email capture",
  ask_ai: "Ask AI",
  product_cards: "Product cards",
  integration: "Integration",
  branch: "Branch",
};

// `savedAt` is an ISO string from the CLIENT autosave fetcher — it's null on the
// server + initial hydration (the chip never server-renders) and only set after a
// client-side save completes, so formatting it in the merchant's LOCAL time here is
// NOT subject to the SSR date-hydration landmine ([[ssr-unsafe-locale-dates]]).
function savedTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// Questions & Logic spec — the two-panel page shell (260px left + scrolling main).
// Owns the Builder/Table view toggle, the active-question highlight, and the
// IntersectionObserver scroll-sync between the left list and the main card column.
// Server-free: every edit flows through `onCommit` (the funnel's useQuizDraft
// autosave). Table view + Outcome-coverage + Library land in later phases.
export function QuestionsLogicLayout({
  doc,
  onCommit,
  isSaving,
  savedAt,
  saveError,
  onRetry,
  categories,
  quizId,
  navigating,
  onBack,
  onContinue,
  regeneratingId,
  undoNodeId,
  regenError,
  onRegenerate,
  onUndoRegenerate,
  onDismissRegenError,
}: {
  doc: QuizDoc;
  onCommit: (doc: QuizDoc) => void;
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
  categories: BuilderCategory[];
  quizId: string;
  navigating: boolean;
  onBack: () => void;
  onContinue: () => void;
  regeneratingId: string | null;
  undoNodeId: string | null;
  regenError: { nodeId: string; message: string; credits: boolean } | null;
  onRegenerate: (nodeId: string) => void;
  onUndoRegenerate: () => void;
  onDismissRegenError: () => void;
}) {
  const questions = useMemo(() => orderedQuestions(doc), [doc]);
  const idsKey = questions.map((q) => q.node.id).join(",");
  const coverageCounts = useMemo(
    () => bucketMappedCounts(doc, categories.map((c) => c.id)),
    [doc, categories],
  );

  const [view, setView] = useState<"builder" | "table" | "flow">("builder");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState<TableFilter>("");
  // Collapsible left rail — hide the question list so the main area takes the
  // full width (the owner's "understand the real estate" ask; qz-qb-split twin).
  const [leftOpen, setLeftOpen] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [guardNames, setGuardNames] = useState<string[] | null>(null);

  const mainRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const toastTimer = useRef<number | undefined>(undefined);

  // ── Skip-to options: every question as "Q{n}" + any exotic current target +
  // End. The card filters out its own id. ──
  const skipOptions = useMemo<SkipOption[]>(() => {
    const opts: SkipOption[] = questions.map((q) => ({
      value: q.node.id,
      label: `Q${q.qIndex}`,
    }));
    // Preserve any non-question route an answer already points at (so changing
    // the dropdown never blanks an existing exotic destination).
    const seen = new Set(questions.map((q) => q.node.id));
    for (const n of doc.nodes) {
      if (n.type !== "question") continue;
      for (const a of n.data.answers) {
        const e = doc.edges.find(
          (ed) => ed.source === n.id && ed.source_handle === a.edge_handle_id,
        );
        if (!e) continue;
        const tn = doc.nodes.find((x) => x.id === e.target);
        if (!tn || tn.type === "end" || tn.type === "intro" || seen.has(tn.id)) continue;
        seen.add(tn.id);
        opts.push({ value: tn.id, label: NODE_TYPE_LABEL[tn.type] ?? tn.type });
      }
    }
    opts.push({ value: "__end__", label: "End quiz (show results)" });
    return opts;
  }, [questions, doc.nodes, doc.edges]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // Default the active item to the first question.
  useEffect(() => {
    if (!activeId && questions[0]) setActiveId(questions[0].node.id);
  }, [activeId, questions]);

  // Scroll-sync: recompute the active card from geometry whenever any card's
  // intersection with the scroll container changes. Client-only by construction
  // (the stage is ClientOnly-wrapped) but guard the API for safety.
  useEffect(() => {
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === "undefined" || view !== "builder") return;
    const obs = new IntersectionObserver(
      () => {
        const r = root.getBoundingClientRect();
        let bestId: string | null = null;
        let bestOffset = Infinity;
        for (const [id, el] of cardEls.current) {
          const b = el.getBoundingClientRect();
          const offset = b.top - r.top;
          if (offset <= r.height * 0.4 && offset > -b.height && Math.abs(offset) < Math.abs(bestOffset)) {
            bestOffset = offset;
            bestId = id;
          }
        }
        if (bestId) setActiveId(bestId);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of cardEls.current.values()) obs.observe(el);
    return () => obs.disconnect();
  }, [idsKey, view]);

  // Deferred scroll for a freshly-added question (its card mounts after commit).
  useEffect(() => {
    if (!pendingScrollId) return;
    const el = cardEls.current.get(pendingScrollId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(pendingScrollId);
      setPendingScrollId(null);
    }
  }, [pendingScrollId, idsKey]);

  const selectQuestion = useCallback(
    (id: string) => {
      setActiveId(id);
      if (view === "table") {
        const row = typeof document !== "undefined" ? document.getElementById(`qlt-${id}`) : null;
        if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      const el = cardEls.current.get(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [view],
  );

  const addQuestion = useCallback(() => {
    const ref = questions[questions.length - 1]?.node.id;
    if (!ref) return;
    const before = new Set(doc.nodes.map((n) => n.id));
    const next = insertQuestionRelative(doc, ref, "below");
    const newId = next.nodes.find((n) => !before.has(n.id))?.id ?? null;
    onCommit(next);
    if (newId) setPendingScrollId(newId);
  }, [doc, questions, onCommit]);

  const deleteQuestion = useCallback(
    (id: string) => {
      if (questions.length <= 1) return;
      onCommit(deleteNode(doc, id));
      if (activeId === id) setActiveId(null);
    },
    [doc, questions.length, activeId, onCommit],
  );

  // Left-list per-question row actions. Duplicate/insert splice a node into the
  // spine (fresh ids + edge handles) and scroll to it; up/down reorder via moveStep
  // (preserves per-answer skip edges; the Q-numbers + skip labels recompute from
  // orderFlow at render). All ride the same useQuizDraft autosave as every edit.
  const rowAction = useCallback(
    (id: string, action: RowAction) => {
      const before = new Set(doc.nodes.map((n) => n.id));
      if (action === "duplicate" || action === "above" || action === "below") {
        const next =
          action === "duplicate"
            ? duplicateQuestionNode(doc, id)
            : insertQuestionRelative(doc, id, action);
        const newId = next.nodes.find((n) => !before.has(n.id))?.id ?? null;
        onCommit(next);
        if (newId) setPendingScrollId(newId);
        return;
      }
      const idx = questions.findIndex((q) => q.node.id === id);
      if (idx < 0) return;
      if (action === "up" && idx > 0) {
        onCommit(moveStep(doc, id, questions[idx - 1]!.node.id));
        setActiveId(id);
      } else if (action === "down" && idx < questions.length - 1) {
        // Move to just before the question AFTER my next sibling (null = become last).
        onCommit(moveStep(doc, id, questions[idx + 2]?.node.id ?? null));
        setActiveId(id);
      }
    },
    [doc, questions, onCommit],
  );

  // Continue→ gate: warn if any Step-1 bucket has no answers mapped (the shared
  // orphan predicate). Snapshot the NAMES at check-time so the dialog can't drift.
  const handleContinue = useCallback(() => {
    const orphanIds = orphanedBucketIds(doc, categories.map((c) => c.id));
    if (orphanIds.length === 0) {
      onContinue();
      return;
    }
    const idSet = new Set(orphanIds);
    setGuardNames(categories.filter((c) => idSet.has(c.id)).map((c) => c.name));
  }, [doc, categories, onContinue]);

  const model = doc.scoring_model ?? "direct";
  const setCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardEls.current.set(id, el);
    else cardEls.current.delete(id);
  };

  return (
    <div className="qz-ql">
      {/* ── Topbar ── */}
      <header className="qz-ql-topbar">
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={navigating}
          onClick={onBack}
          title="Back to Shape Your Quiz (your work is saved)"
        >
          ← Back
        </button>
        <div className="qz-ql-steplabel">
          Step {stepNumber("question_builder")} of {TOTAL_STEPS} · Questions &amp; Logic
        </div>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          aria-expanded={leftOpen}
          aria-label={leftOpen ? "Collapse the question list" : "Show the question list"}
          onClick={() => setLeftOpen((v) => !v)}
        >
          {leftOpen ? "◀ Hide list" : "▶ Show list"}
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          style={{ fontSize: 12 }}
          title={`Scoring: ${model === "direct" ? "Direct mapping" : "Weighted scoring"} — click to switch (both models are saved)`}
          onClick={() => onCommit(swapScoringModel(doc, model === "direct" ? "weighted" : "direct"))}
        >
          {model === "direct" ? "→ Direct mapping" : "⚖ Weighted scoring"} <span aria-hidden>⚙</span>
        </button>
        <span className="qz-save-status" aria-live="polite">
          {isSaving ? (
            <span className="qz-save-chip is-saving">
              <span className="qz-save-dot" aria-hidden /> Saving…
            </span>
          ) : saveError ? (
            <span className="qz-save-chip is-error">
              <span aria-hidden>⚠</span> {saveError} ·{" "}
              <button type="button" className="qz-ql-retry" onClick={onRetry}>
                Retry
              </button>
            </span>
          ) : savedAt ? (
            <span key={savedAt} className="qz-save-chip is-saved">
              <span aria-hidden>✓</span> Saved {savedTimeLabel(savedAt)}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled
          title="Preview opens after you publish the quiz"
        >
          Preview
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent qz-btn-sm"
          disabled={navigating}
          onClick={handleContinue}
        >
          Continue →
        </button>
      </header>

      {/* ── Body: collapsible 260px left + scrolling main ── */}
      <div className={`qz-ql-body${leftOpen ? "" : " is-collapsed"}`}>
        <aside className="qz-ql-left">
          <div className="qz-ql-tabs qz-segmented qz-segmented--fill" role="group" aria-label="Builder, Table, or Flow view">
            <button type="button" aria-pressed={view === "builder"} onClick={() => setView("builder")}>
              Builder
            </button>
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
              Table
            </button>
            <button type="button" aria-pressed={view === "flow"} onClick={() => setView("flow")}>
              Flow
            </button>
          </div>

          <QuestionList
            questions={questions}
            activeId={activeId}
            onSelect={selectQuestion}
            onRowAction={rowAction}
          />

          {questions.length < 4 || questions.length > 8 ? (
            <p className="qz-ql-qcount-nudge" role="note">
              {questions.length} {questions.length === 1 ? "question" : "questions"} · most quizzes
              work best with 4–8
            </p>
          ) : null}

          <OutcomeCoverage categories={categories} counts={coverageCounts} />

          <div className="qz-ql-left-footer">
            <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm qz-ql-newq" onClick={addQuestion}>
              + New Question
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-ghost qz-btn-sm qz-ql-newq"
              onClick={() => setLibraryOpen(true)}
            >
              ⧉ Question Library
            </button>
          </div>
        </aside>

        {view === "builder" ? (
          <div className="qz-ql-main" ref={mainRef}>
            <div className="qz-ql-cards">
              {questions.length === 0 ? (
                <p className="qz-dim" style={{ padding: 24 }}>
                  No questions yet — add one with “+ New Question”.
                </p>
              ) : (
                questions.map(({ node, qIndex }) => (
                  <QuestionCard
                    key={node.id}
                    doc={doc}
                    node={node}
                    qIndex={qIndex}
                    categories={categories}
                    skipOptions={skipOptions}
                    canDelete={questions.length > 1}
                    active={activeId === node.id}
                    onCommit={onCommit}
                    onDelete={() => deleteQuestion(node.id)}
                    onToast={showToast}
                    onRef={setCardRef(node.id)}
                    onActivate={() => setActiveId(node.id)}
                    regenerating={regeneratingId === node.id}
                    showUndo={undoNodeId === node.id}
                    regenError={regenError?.nodeId === node.id ? regenError : null}
                    onRegenerate={() => onRegenerate(node.id)}
                    onUndoRegenerate={onUndoRegenerate}
                    onRetryRegenerate={() => onRegenerate(node.id)}
                    onDismissRegenError={onDismissRegenError}
                  />
                ))
              )}
            </div>
          </div>
        ) : view === "table" ? (
          <div className="qz-ql-main">
            <TableView
              doc={doc}
              categories={categories}
              skipOptions={skipOptions}
              filter={tableFilter}
              onFilterChange={setTableFilter}
              activeId={activeId}
              onActivate={setActiveId}
              onCommit={onCommit}
            />
          </div>
        ) : (
          <div className="qz-ql-main qz-ql-flowmain">
            <LogicFlowMap
              doc={doc}
              categories={categories}
              selectedNodeId={activeId}
              onSelectResult={setActiveId}
            />
          </div>
        )}
      </div>

      {libraryOpen ? (
        <QuestionBankDrawer doc={doc} onCommit={onCommit} onClose={() => setLibraryOpen(false)} />
      ) : null}

      {guardNames ? (
        <ContinueGuard
          bucketNames={guardNames}
          onFix={() => setGuardNames(null)}
          onContinueAnyway={() => {
            setGuardNames(null);
            onContinue();
          }}
        />
      ) : null}

      {toast ? (
        <div className="qz-ql-toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
