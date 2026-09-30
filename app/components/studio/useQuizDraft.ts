import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";
import { reconcileDraft } from "./draftReconcile";
import { createSaveTracker, type SaveOutcome, type SaveToken } from "./saveTracker";

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
//
// Per-commit save tracking (LOGIC-STEP D8, additive — existing callers are
// untouched): every commit takes a sequence number and each PUT records the
// newest one it carries (saveTracker.ts). `commitTracked(doc)` commits and
// returns a SaveToken for THAT commit; `pendingToken()` returns one for the
// newest commit; `flush()` sends any debounced save now (respecting the AI
// pause — it waits for the resumed save instead) and resolves "saved" /
// "failed" once the PUT carrying the newest commit settles. The field save
// pill subscribes to a token, so "Saved" never shows before the save did.
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
  // QRTZ-S2 — reactive read-only mirror of aiInFlight so chrome can draw the
  // "Paused while AI edits" chip (a ref alone can't trigger a re-render). The
  // ref stays the guard; this state changes nothing about the pause seam.
  const [isAiPaused, setIsAiPaused] = useState(false);
  // D8 — sequence bookkeeping shared by every SaveToken this draft hands out.
  const trackerRef = useRef<ReturnType<typeof createSaveTracker> | null>(null);
  if (!trackerRef.current) trackerRef.current = createSaveTracker();
  const tracker = trackerRef.current;

  const submitSave = useCallback(
    (next: QuizDoc) => {
      pending.current = null;
      tracker.sent();
      saveFetcher.submit(JSON.stringify({ doc: next }), {
        method: "PUT",
        encType: "application/json",
      });
    },
    [saveFetcher, tracker],
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
      tracker.commit();
      setDoc(next);
      triggerSave(next);
    },
    [triggerSave, tracker],
  );

  // D8 — commit and get a token that settles when THIS commit is saved (or
  // its save fails; a later success still turns it to saved).
  const commitTracked = useCallback(
    (next: QuizDoc): SaveToken => {
      commit(next);
      return tracker.token();
    },
    [commit, tracker],
  );

  // D8 — a token for the newest commit (for hosts that committed through the
  // plain `commit`).
  const pendingToken = useCallback((): SaveToken => tracker.token(), [tracker]);

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
    setIsAiPaused(true);
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
      setIsAiPaused(false);
      const next = base ? reconcileDraft(base, aiDoc, docRef.current) : aiDoc;
      tracker.commit();
      docRef.current = next;
      setDoc(next);
      triggerSave(next);
    },
    [triggerSave, tracker],
  );

  // Call when an AI intent FAILS. Resume autosave and persist whatever the
  // merchant typed while it was paused (their local doc is the source of truth —
  // a failed AI call never touched it).
  const endAiEdit = useCallback(() => {
    aiBase.current = null;
    aiInFlight.current = false;
    setIsAiPaused(false);
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

  // D8 — awaitable flush: send the debounced save now and resolve when the
  // PUT carrying the newest commit settles. While autosave is paused for an
  // AI edit nothing is sent; it resolves after the resumed save instead.
  const flush = useCallback((): Promise<SaveOutcome> => {
    const token = tracker.token();
    if (!aiInFlight.current) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (pending.current) submitSave(pending.current);
    }
    return token.settled();
  }, [submitSave, tracker]);

  // D8 — feed PUT results into the tracker. A fetcher that went busy → idle
  // with a NEW data object carries the in-flight result; busy → idle with no
  // new data (a thrown/network failure) counts as failed. An aborted PUT
  // never goes idle in between (the next submit keeps it busy), so it never
  // reports — the later PUT settles its sequence.
  const lastData = useRef(saveFetcher.data);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (saveFetcher.state !== "idle") {
      wasBusy.current = true;
      return;
    }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    const data = saveFetcher.data;
    const fresh = data !== lastData.current;
    lastData.current = data;
    tracker.result(fresh && !!data?.ok);
  }, [saveFetcher.state, saveFetcher.data, tracker]);

  return {
    doc,
    setDoc,
    commit,
    isSaving,
    savedAt,
    saveError,
    isAiPaused,
    retrySave,
    flushSave,
    flush,
    commitTracked,
    pendingToken,
    beginAiEdit,
    applyAiResult,
    endAiEdit,
  };
}
