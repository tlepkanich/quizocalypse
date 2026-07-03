import { useCallback, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { reconcileDraft } from "./draftReconcile";

type QuizDoc = Quiz;

// Shared draft plumbing for the studio shells: local doc state + a debounced
// JSON-PUT autosave to the route action (the exact contract BuilderShell uses
// inline). Extracted so the AI-first workspace and the advanced builder can't
// drift on how edits persist. `commit` updates the live doc AND schedules the
// save; the live doc drives every preview so changes render instantly.
//
// Single-flight AI guard (the autosave-vs-AI race fix): an AI studio intent
// (ai-edit / enrich-reviews / translate-quiz) takes a multi-second LLM call and
// returns a WHOLE new doc built on the doc at dispatch. Without coordination,
// any edit the merchant types DURING the call is silently overwritten when the
// AI doc lands. So the AI panels bracket their request with this hook:
//   • beginAiEdit()  — flush the pending autosave (the server's draft becomes
//     the merchant's latest, which the AI then edits), snapshot that doc as the
//     rebase base, and PAUSE autosave so a debounced PUT can't land a stale
//     interim doc mid-call.
//   • applyAiResult(aiDoc) — 3-way merge the edits typed during the call back on
//     top of the AI's doc (reconcileDraft), then resume autosave.
//   • endAiEdit() — on AI failure, resume autosave and persist whatever was
//     typed while paused (the local doc is untouched by a failed AI call).
export function useQuizDraft(initial: QuizDoc) {
  const [doc, setDoc] = useState<QuizDoc>(initial);
  const saveFetcher = useFetcher<{ ok: boolean; savedAt?: string; error?: string }>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The doc a pending (debounced) autosave will PUT — lets beginAiEdit flush it
  // immediately instead of waiting out the debounce.
  const pending = useRef<QuizDoc | null>(null);
  // Always-current doc, so the AI-seam callbacks can read the live doc without
  // taking `doc` as a dependency (keeps them stable across keystrokes).
  const docRef = useRef(doc);
  docRef.current = doc;
  // Single-flight: the doc the in-flight AI request was dispatched against (the
  // rebase base), and whether a request is currently in flight (autosave paused).
  const aiBase = useRef<QuizDoc | null>(null);
  const aiInFlight = useRef(false);

  const submitSave = useCallback(
    (next: QuizDoc) => {
      pending.current = null;
      saveFetcher.submit(JSON.stringify({ doc: next }), {
        method: "PUT",
        encType: "application/json",
      });
    },
    [saveFetcher],
  );

  const triggerSave = useCallback(
    (next: QuizDoc) => {
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      // Paused while an AI request is in flight — applyAiResult/endAiEdit resume
      // it by committing the reconciled (or current) doc once the call settles.
      if (aiInFlight.current) return;
      timer.current = setTimeout(() => submitSave(next), 700);
    },
    [submitSave],
  );

  const commit = useCallback(
    (next: QuizDoc) => {
      setDoc(next);
      triggerSave(next);
    },
    [triggerSave],
  );

  // Call when DISPATCHING an AI intent. Returns the snapshot the AI should edit
  // (the panel sends it as `baseDoc` so the server applies its ops onto exactly
  // what the merchant sees) and which we later rebase in-flight edits against.
  const beginAiEdit = useCallback((): QuizDoc => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) submitSave(pending.current); // flush latest before the AI reads
    const base = docRef.current;
    aiBase.current = base;
    aiInFlight.current = true;
    return base;
  }, [submitSave]);

  // Call when an AI intent RETURNS A DOC. Re-applies edits made during the call
  // (current doc vs the dispatch snapshot) on top of the AI doc, then resumes
  // autosave by committing the merged result.
  const applyAiResult = useCallback(
    (aiDoc: QuizDoc) => {
      const base = aiBase.current;
      aiBase.current = null;
      aiInFlight.current = false;
      const next = base ? reconcileDraft(base, aiDoc, docRef.current) : aiDoc;
      docRef.current = next;
      setDoc(next);
      triggerSave(next);
    },
    [triggerSave],
  );

  // Call when an AI intent FAILS. Resume autosave and persist whatever the
  // merchant typed while it was paused (their local doc is the source of truth —
  // a failed AI call never touched it).
  const endAiEdit = useCallback(() => {
    aiBase.current = null;
    aiInFlight.current = false;
    triggerSave(docRef.current);
  }, [triggerSave]);

  const isSaving = saveFetcher.state !== "idle";
  const savedAt =
    saveFetcher.data?.ok && saveFetcher.data.savedAt ? saveFetcher.data.savedAt : null;
  // Surface a failed autosave so the funnel can show an "Unable to save · Retry"
  // chip (Questions & Logic spec §5). Additive — existing consumers ignore it.
  const saveError =
    saveFetcher.state === "idle" && saveFetcher.data && !saveFetcher.data.ok
      ? (saveFetcher.data.error ?? "Unable to save")
      : null;
  // Re-PUT the current doc (the source of truth) after a save failure.
  const retrySave = useCallback(() => submitSave(docRef.current), [submitSave]);

  // Flush any pending (debounced) autosave NOW, WITHOUT pausing autosave (unlike
  // beginAiEdit). Used before a same-screen read-only AI call (L2-12c path
  // review) so the server reads the merchant's latest draft, not a stale one.
  const flushSave = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current) submitSave(pending.current);
  }, [submitSave]);

  return {
    doc,
    setDoc,
    commit,
    isSaving,
    savedAt,
    saveError,
    retrySave,
    flushSave,
    beginAiEdit,
    applyAiResult,
    endAiEdit,
  };
}
