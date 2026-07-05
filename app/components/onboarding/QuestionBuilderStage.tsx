import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "@remix-run/react";
import type { useFetcher } from "@remix-run/react";
import type { Quiz, DesignTokens } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory, BuilderCollection } from "../builder/stepProps";
import { useQuizDraft } from "../studio/useQuizDraft";
import { QuestionsLogicLayout } from "./questionsLogic/QuestionsLogicLayout";
import { Step3Shell } from "./questionsLogicV3/Step3Shell";

// ════════════════════════════════════════════════════════════════════════════
// QuestionBuilderStage — Step 3 of the create funnel ("Questions & Logic"), the
// two-panel v1.0 dev-handoff editing surface. This shell owns useQuizDraft (the
// JSON-PUT autosave + the single-flight AI seam) + the Back/Continue navigation +
// the per-question AI-REGENERATE orchestration; the layout below is server-free.
// Client-only (ClientOnly-wrapped by the caller).
//
// Regenerate round-trip: ↻ on a card snapshots the FULL doc (for a 10s undo),
// brackets the request with beginAiEdit/applyAiResult/endAiEdit (so a debounced
// autosave can't clobber the in-flight AI doc), and POSTs the funnel `regenerate-
// node` intent. The server preserves bucket mappings on unchanged answer text and
// keeps the funnel stage; on success we apply the doc + open a 10s Undo; on a
// credit/AI failure we surface an actionable Retry (never a silent no-op).
// ════════════════════════════════════════════════════════════════════════════

type RegenError = { nodeId: string; message: string; credits: boolean };

export function QuestionBuilderStage({
  quizId,
  initialDoc,
  categories,
  fetcher,
  pendingIntent,
  designTokens,
}: {
  quizId: string;
  initialDoc: Quiz;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  fetcher: ReturnType<typeof useFetcher>;
  pendingIntent: string | null;
  // QL3 — the draft's design tokens (FunnelData.designTokens), threaded to the
  // v3 phone canvas so the preview wears the merchant brand.
  designTokens?: DesignTokens | null;
}) {
  const { doc, commit, isSaving, savedAt, saveError, retrySave, flushSave, beginAiEdit, applyAiResult, endAiEdit } =
    useQuizDraft(initialDoc);
  // QL3-P1 — the Step-3 v3 shell mounts ONLY on decider docs behind the
  // client-read ?step3=v3 flag; the legacy layout stays the default (P5 flips).
  const [searchParams] = useSearchParams();
  const useV3 = doc.logic_model === "decider" && searchParams.get("step3") === "v3";
  const navigating =
    pendingIntent === "to-rec-page" || pendingIntent === "back-to-types";

  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [undoNodeId, setUndoNodeId] = useState<string | null>(null);
  const [regenError, setRegenError] = useState<RegenError | null>(null);
  const pendingUndo = useRef<Quiz | null>(null);
  const awaitingRegen = useRef<string | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);

  const startRegenerate = useCallback(
    (nodeId: string) => {
      if (awaitingRegen.current) return; // single-flight
      setRegenError(null);
      setUndoNodeId(null);
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
      pendingUndo.current = doc; // full pre-regen snapshot for an exact undo
      beginAiEdit();
      awaitingRegen.current = nodeId;
      setRegeneratingId(nodeId);
      fetcher.submit({ intent: "regenerate-node", nodeId }, { method: "post" });
    },
    [doc, beginAiEdit, fetcher],
  );

  const undoRegenerate = useCallback(() => {
    if (pendingUndo.current) commit(pendingUndo.current);
    pendingUndo.current = null;
    setUndoNodeId(null);
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
  }, [commit]);

  // Settle the regenerate request: apply on success (+ open the 10s Undo) or
  // surface an actionable error. Gated on awaitingRegen so the shared fetcher's
  // Back/Continue responses are ignored.
  useEffect(() => {
    const pendingId = awaitingRegen.current;
    if (!pendingId || fetcher.state !== "idle") return;
    const data = fetcher.data as
      | { intent?: string; nodeId?: string; ok?: boolean; doc?: Quiz; code?: string; error?: string }
      | undefined;
    // Only consume the response for the node we awaited — the server echoes nodeId,
    // so this can't process a stale Back/Continue or prior-regenerate response on
    // the shared fetcher (independent of React's render batching).
    if (!data || data.intent !== "regenerate-node" || data.nodeId !== pendingId) return;
    awaitingRegen.current = null;
    setRegeneratingId(null);
    if (data.ok && data.doc) {
      applyAiResult(data.doc);
      setUndoNodeId(pendingId);
      undoTimer.current = window.setTimeout(() => {
        setUndoNodeId(null);
        pendingUndo.current = null;
      }, 10000);
    } else {
      endAiEdit();
      pendingUndo.current = null; // failed regenerate never changed the doc
      setRegenError({
        nodeId: pendingId,
        message: data.error ?? "Regenerate failed — try again.",
        credits: data.code === "ai_credits",
      });
    }
  }, [fetcher.state, fetcher.data, applyAiResult, endAiEdit]);

  useEffect(
    () => () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    },
    [],
  );

  if (useV3) {
    return (
      <Step3Shell
        doc={doc}
        quizId={quizId}
        onCommit={commit}
        onFlush={flushSave}
        isSaving={isSaving}
        savedAt={savedAt}
        saveError={saveError}
        onRetry={retrySave}
        categories={categories}
        navigating={navigating}
        onContinue={() => fetcher.submit({ intent: "to-rec-page" }, { method: "post" })}
        designTokens={designTokens}
        regen={{
          regeneratingId,
          undoNodeId,
          regenError,
          onRegenerate: startRegenerate,
          onUndoRegenerate: undoRegenerate,
          onDismissRegenError: () => setRegenError(null),
        }}
      />
    );
  }

  return (
    <QuestionsLogicLayout
      doc={doc}
      onCommit={commit}
      onFlush={flushSave}
      isSaving={isSaving}
      savedAt={savedAt}
      saveError={saveError}
      onRetry={retrySave}
      categories={categories}
      quizId={quizId}
      navigating={navigating}
      onBack={() => fetcher.submit({ intent: "back-to-types" }, { method: "post" })}
      onContinue={() => fetcher.submit({ intent: "to-rec-page" }, { method: "post" })}
      regeneratingId={regeneratingId}
      undoNodeId={undoNodeId}
      regenError={regenError}
      onRegenerate={startRegenerate}
      onUndoRegenerate={undoRegenerate}
      onDismissRegenError={() => setRegenError(null)}
    />
  );
}
