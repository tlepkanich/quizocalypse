import { useCallback, useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Quiz } from "../../lib/quizSchema";

type QuizDoc = Quiz;

// Shared draft plumbing for the studio shells: local doc state + a debounced
// JSON-PUT autosave to the route action (the exact contract BuilderShell uses
// inline). Extracted so the AI-first workspace and the advanced builder can't
// drift on how edits persist. `commit` updates the live doc AND schedules the
// save; the live doc drives every preview so changes render instantly.
export function useQuizDraft(initial: QuizDoc) {
  const [doc, setDoc] = useState<QuizDoc>(initial);
  const saveFetcher = useFetcher<{ ok: boolean; savedAt?: string; error?: string }>();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a stable ref to the current doc so `retry` can resend without a
  // stale closure.
  const docRef = useRef(doc);
  docRef.current = doc;

  const triggerSave = useCallback(
    (next: QuizDoc) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveFetcher.submit(JSON.stringify({ doc: next }), {
          method: "PUT",
          encType: "application/json",
        });
      }, 700);
    },
    [saveFetcher],
  );

  const commit = useCallback(
    (next: QuizDoc) => {
      setDoc(next);
      triggerSave(next);
    },
    [triggerSave],
  );

  const retry = useCallback(() => {
    triggerSave(docRef.current);
  }, [triggerSave]);

  const isSaving = saveFetcher.state !== "idle";
  const savedAt =
    saveFetcher.data?.ok && saveFetcher.data.savedAt ? saveFetcher.data.savedAt : null;
  const saveError =
    saveFetcher.state === "idle" && saveFetcher.data != null && !saveFetcher.data.ok
      ? (saveFetcher.data.error ?? "Save failed")
      : null;

  return { doc, setDoc, commit, isSaving, savedAt, saveError, retry };
}
