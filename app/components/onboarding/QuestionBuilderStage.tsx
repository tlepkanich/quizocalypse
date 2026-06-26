import { useMemo, useState } from "react";
import type { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { validateQuiz, type NodeIssue } from "../../lib/quizValidation";
import { orderFlow } from "../../lib/flowOrder";
import { stepNumber, TOTAL_STEPS } from "../../lib/funnelStages";
import { swapScoringModel } from "../../lib/quizMutations";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory, BuilderCollection, StepProps } from "../builder/stepProps";
import { Step5Preview } from "../builder/Step5Preview";
import { breakpointForWidth } from "../builder/preview/previewWidth";
import { useQuizDraft } from "../studio/useQuizDraft";
import { FlowRail, type WorkspaceView } from "../studio/FlowRail";
import { ContextPanel } from "../studio/ContextPanel";

// ════════════════════════════════════════════════════════════════════════════
// QuestionBuilderStage — the pre-config editing step (Question Builder + Logic
// Mapping). The quiz is ALREADY built (the early question build ran right after
// Shape), so this composes the SAME builder panels the main editor uses —
// FlowRail (left) · live preview (center) · ContextPanel with the Answer-Mapping
// Routing tab (right) — over the funnel-held draft. Edits autosave through
// useQuizDraft's JSON-PUT, which lands on the funnel route's autosave branch and
// persists DOC CONTENT only (build_session/stage is owned by the nav intents, so
// a debounced save can't rewind the step). Client-only (wrapped in ClientOnly by
// the caller) — these panels throw hydration errors when SSR'd.
// ════════════════════════════════════════════════════════════════════════════

export function QuestionBuilderStage({
  quizId,
  initialDoc,
  categories,
  productIndex,
  collections,
  fetcher,
  pendingIntent,
}: {
  quizId: string;
  initialDoc: Quiz;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  fetcher: ReturnType<typeof useFetcher>;
  pendingIntent: string | null;
}) {
  const { doc, commit, isSaving, savedAt } = useQuizDraft(initialDoc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveNodeId, setLiveNodeId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [frameW, setFrameW] = useState(420);

  const allIssues = useMemo<NodeIssue[]>(() => validateQuiz(doc), [doc]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, NodeIssue[]>();
    for (const i of allIssues) {
      const arr = m.get(i.nodeId) ?? [];
      arr.push(i);
      m.set(i.nodeId, arr);
    }
    return m;
  }, [allIssues]);
  const ordered = useMemo(() => orderFlow(doc), [doc]);
  const fallbackCollection = collections[0]?.collectionId ?? "";

  const stepProps: StepProps = {
    quizId,
    doc,
    onCommit: commit,
    productIndex,
    collections,
    categories,
    fallbackCollection,
    allIssues,
    issuesByNode,
    ordered,
    previewUrl: `/q/${quizId}`,
    goToStep: () => {},
  };

  const navigating =
    pendingIntent === "to-rec-page" || pendingIntent === "back-to-types";

  return (
    <div className="qz-qb-stage">
      <header className="qz-row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div className="qz-label" style={{ fontSize: 11, marginBottom: 2 }}>
            Step {stepNumber("question_builder")} of {TOTAL_STEPS} — Question Builder
          </div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Build &amp; map your questions</h2>
          {(() => {
            const qCount = doc.nodes.filter((n) => n.type === "question").length;
            const nudge =
              qCount < 4
                ? " · most quizzes perform best at 4–8"
                : qCount > 8
                  ? " · consider trimming — 4–8 performs best"
                  : "";
            return (
              <p className="qz-dim" style={{ margin: "4px 0 0", fontSize: 13 }}>
                {qCount} question{qCount === 1 ? "" : "s"}
                {nudge}. Edit answers + map each to a bucket in the Mapping tab; set skip
                logic in the Logic tab.
              </p>
            );
          })()}
        </div>
        <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
          {(() => {
            const m = doc.scoring_model ?? "direct";
            const other = m === "direct" ? "weighted" : "direct";
            return (
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                style={{ fontSize: 12 }}
                title={`Scoring: ${m === "direct" ? "Direct mapping" : "Weighted scoring"} — click to switch (both models are saved)`}
                onClick={() => commit(swapScoringModel(doc, other))}
              >
                {m === "direct" ? "→ Direct mapping" : "⚖ Weighted scoring"} <span aria-hidden>⚙</span>
              </button>
            );
          })()}
          <span className="qz-save-status" aria-live="polite">
            {isSaving ? (
              <span className="qz-save-chip is-saving">
                <span className="qz-save-dot" aria-hidden /> Saving…
              </span>
            ) : savedAt ? (
              <span key={savedAt} className="qz-save-chip is-saved">
                <span aria-hidden>✓</span> Saved
              </span>
            ) : null}
          </span>
        </div>
      </header>

      <div className="qz-unified">
        <FlowRail
          doc={doc}
          ordered={ordered}
          issuesByNode={issuesByNode}
          selectedId={selectedId}
          currentId={liveNodeId}
          onSelect={setSelectedId}
          onCommit={commit}
          fallbackCollection={fallbackCollection}
          view={"build" as WorkspaceView}
          onView={() => {}}
          confirmDeleteId={confirmDeleteId}
          onConfirmDelete={setConfirmDeleteId}
          hideViewSwitcher
        />
        <div style={{ minWidth: 0 }}>
          <Step5Preview
            {...stepProps}
            frameW={frameW}
            onFrameWChange={setFrameW}
            focusNodeId={selectedId}
            onNodeShown={setLiveNodeId}
          />
        </div>
        <div style={{ position: "sticky", top: 8 }}>
          {selectedId ? (
            <ContextPanel
              doc={doc}
              nodeId={selectedId}
              onCommit={commit}
              onClose={() => setSelectedId(null)}
              products={productIndex}
              productIndex={productIndex}
              categories={categories}
              frameBreakpoint={breakpointForWidth(frameW)}
            />
          ) : (
            <div className="qz-card" style={{ padding: 12 }}>
              <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
                Select a step in the rail to edit its content, design, and — for questions —
                its answer scoring (the Routing tab).
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="qz-row" style={{ gap: 8, marginTop: 16 }}>
        <button
          type="button"
          className="qz-btn qz-btn-ghost"
          disabled={navigating}
          onClick={() => fetcher.submit({ intent: "back-to-types" }, { method: "post" })}
          title="Re-pick your quiz type (regenerates the questions)"
        >
          ← Back
        </button>
        <button
          type="button"
          className="qz-btn qz-btn-accent"
          disabled={navigating}
          onClick={() => fetcher.submit({ intent: "to-rec-page" }, { method: "post" })}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
