import { useCallback, useEffect, useRef, useState } from "react";
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
  mode = "questions",
  initialDoc,
  categories,
  productIndex,
  collections,
  fetcher,
  pendingIntent,
  designTokens,
  lastSyncAt,
  shopifyAdminDomain,
}: {
  quizId: string;
  /** One-line-chrome — which funnel step this mount serves: "questions" (the
   *  content editing surface) or "logic" (the decider map/rules view, its own
   *  stage now). Legacy points/ladder docs render QuestionsLogicLayout — one
   *  combined surface — for either value. */
  mode?: "questions" | "logic";
  initialDoc: Quiz;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  collections: BuilderCollection[];
  fetcher: ReturnType<typeof useFetcher>;
  pendingIntent: string | null;
  // QL3 — the draft's design tokens (FunnelData.designTokens), threaded to the
  // v3 phone canvas so the preview wears the merchant brand.
  designTokens?: DesignTokens | null;
  // QRTZ-B2 — sync freshness + the Shopify ADMIN domain, threaded to the Logic
  // card's products popover (FunnelData.lastSyncAt / .shopifyAdminDomain).
  lastSyncAt?: string | null;
  shopifyAdminDomain?: string | null;
}) {
  const { doc, commit, isSaving, savedAt, saveError, retrySave, flushSave, beginAiEdit, applyAiResult, endAiEdit } =
    useQuizDraft(initialDoc);
  // QL3-P5 — the flip: decider docs render the Step-3 v3 shell UNCONDITIONALLY
  // (the ?step3=v3 flag is retired); legacy (points/ladder) docs keep the
  // QuestionsLogicLayout surface unchanged.
  const useV3 = doc.logic_model === "decider";
  const navigating =
    pendingIntent === "to-rec-page" ||
    pendingIntent === "to-logic" ||
    pendingIntent === "goto-stage" ||
    pendingIntent === "back-to-types";

  // The bar's Continue is published through the funnel-chrome bridge, whose
  // contract needs referentially STABLE handlers — the fetcher rides in a ref.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // Questions → Logic; Logic → Results. Legacy docs keep the one combined
  // step, so their Continue always heads to the Results step.
  const continueIntent = useV3 && mode === "questions" ? "to-logic" : "to-rec-page";
  const submitContinue = useCallback(() => {
    fetcherRef.current.submit({ intent: continueIntent }, { method: "post" });
  }, [continueIntent]);
  // Logic-step §2 — the style chooser's persist. build_session is server-owned,
  // so the pick rides an intent (never the JSON autosave). Stable via the ref.
  const submitLogicStyle = useCallback((style: "rules" | "attributes") => {
    fetcherRef.current.submit({ intent: "set-logic-style", style }, { method: "post" });
  }, []);

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
        mode={mode === "logic" ? "logic" : "content"}
        onCommit={commit}
        onFlush={flushSave}
        isSaving={isSaving}
        savedAt={savedAt}
        saveError={saveError}
        onRetry={retrySave}
        categories={categories}
        collections={collections}
        productIndex={productIndex}
        navigating={navigating}
        onContinue={submitContinue}
        onPickLogicStyle={submitLogicStyle}
        designTokens={designTokens}
        lastSyncAt={lastSyncAt}
        shopifyAdminDomain={shopifyAdminDomain}
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
      isSaving={isSaving}
      savedAt={savedAt}
      saveError={saveError}
      onRetry={retrySave}
      categories={categories}
      navigating={navigating}
      onContinue={submitContinue}
      regeneratingId={regeneratingId}
      undoNodeId={undoNodeId}
      regenError={regenError}
      onRegenerate={startRegenerate}
      onUndoRegenerate={undoRegenerate}
      onDismissRegenError={() => setRegenError(null)}
    />
  );
}
