import { useCallback, useEffect, useId, useRef } from "react";

import { useQzToast } from "../../qz-toast";

/* D7 (owner 2026-09-22) — Undo as inverse mutations against the LATEST
   document, never a whole-document snapshot, so an unrelated edit made while
   the toast is up survives the Undo.

   Three KINDS of Undo, kept apart like the mock's three slots:
     "rules"    (mock UNDO)     rule deletes, moves, copies. While its toast
                is live, further rules steps join the same run, so one Undo
                takes back the whole run (mock snap/toastU, B35): the inverses
                are applied newest-first to getLatestDoc() in ONE commit. The
                run counts its deletes, and a delete's message is built HERE
                from that count ("Rule 2 deleted", "3 rules deleted"), so the
                toast and what Undo restores always agree.
     "question" (mock QUNDO)    role, type and point changes. Its own run; its
                message WAITS (is not shown) while a rules Undo is live, so
                it never relabels or joins a delete's toast (mock toastQ).
     "import"   (mock IMP_UNDO) an import. Always shows, replacing whatever
                toast is up (mock toastImp); an Undo that no longer changes
                anything says so instead of doing nothing.
   A step of another kind always starts a new run. The run ends when its
   toast leaves (timeout, replaced by another action toast, or Undo pressed).
   A plain toast never ends it (B7, see qz-toast.tsx).

   When the host unmounts, the run is dropped and its toast hidden: an Undo
   pressed after the Logic view has gone would commit against a document the
   host no longer tracks (never commit a stale doc).

   Label (mock toastU): "Undo" for one step, and for a rules run made only of
   deletes (its message already counts them, e.g. "3 rules deleted");
   "Undo both" / "Undo all N" for a mixed rules run of 2 / N steps. The other
   kinds always read "Undo". */

export type UndoKind = "rules" | "question" | "import";

export type UndoStep<D> = {
  /** Maps the latest doc to the doc with this one step undone. */
  inverse: (doc: D) => D;
  /** A delete. A run made only of deletes keeps the plain "Undo" label. */
  isDelete: boolean;
  /** Where focus goes after this step is undone (the oldest step's wins). */
  focusAfter?: () => void;
};

export type UndoRun<D> = { kind: UndoKind; steps: UndoStep<D>[] };

export type UndoRunAction<D> =
  | { type: "push"; step: UndoStep<D>; live: boolean; kind?: UndoKind }
  | { type: "clear" };

/** Pure accumulator: a push of the SAME kind while the run's toast is live
    extends the run; anything else starts a new one. */
export function undoRunReducer<D>(run: UndoRun<D> | null, action: UndoRunAction<D>): UndoRun<D> | null {
  if (action.type === "clear") return null;
  const kind = action.kind ?? "rules";
  if (run && action.live && run.kind === kind) return { kind, steps: [...run.steps, action.step] };
  return { kind, steps: [action.step] };
}

/** How many deletes a run holds (mock UNDO.dels). */
export function undoRunDeletes<D>(run: UndoRun<D> | null): number {
  return run ? run.steps.filter((s) => s.isDelete).length : 0;
}

/** The action label for a run (mock toastU). */
export function undoLabel<D>(run: UndoRun<D> | null): string {
  if (!run || run.kind !== "rules") return "Undo";
  const n = run.steps.length;
  const dels = undoRunDeletes(run);
  if (n > 1 && dels < n) return n === 2 ? "Undo both" : `Undo all ${n}`;
  return "Undo";
}

/** Apply every inverse, newest first, to the latest doc. */
export function applyUndoRun<D>(doc: D, run: UndoRun<D>): D {
  let next = doc;
  for (let i = run.steps.length - 1; i >= 0; i--) next = run.steps[i]!.inverse(next);
  return next;
}

/** Whether a question-kind message has to wait (mock toastQ / lossToast:
    while a rules Undo is live, that toast stays). */
export function questionMustWait<D>(run: UndoRun<D> | null, kind: UndoKind): boolean {
  return kind === "question" && run !== null && run.kind === "rules";
}

export type LogicUndoPush<D> = {
  /** Toast message. A function gets the run's delete count after this step
      is added (build "Rule 2 deleted" / "3 rules deleted" from it). */
  message: string | ((deletes: number) => string);
  inverse: (doc: D) => D;
  /** Which Undo slot (default "rules"). */
  kind?: UndoKind;
  isDelete?: boolean;
  focusAfter?: () => void;
  /** Focus the Undo button (the control that triggered this was destroyed). */
  focusAction?: boolean;
  /** Where focus goes if the toast hides while holding it. */
  returnFocus?: () => void;
  /** Toast duration override (default 6000 for an action toast). */
  duration?: number;
  /** Shown instead of a silent no-op when pressing Undo changes nothing
      (the quiz changed after the step, e.g. an import). */
  staleMessage?: string;
};

export function useLogicUndo<D>({
  getLatestDoc,
  commit,
}: {
  /** The newest document (a ref read — never a render-time snapshot). */
  getLatestDoc: () => D;
  /** Commits one document (useQuizDraft.commit or the builder's commit). */
  commit: (doc: D) => void;
}) {
  const toast = useQzToast();
  const key = `logic-undo-${useId()}`;
  const runRef = useRef<UndoRun<D> | null>(null);
  const staleRef = useRef<string | null>(null);
  const messageRef = useRef("");
  const latest = useRef({ getLatestDoc, commit, toast });
  latest.current = { getLatestDoc, commit, toast };

  const undo = useCallback(() => {
    const run = runRef.current;
    const stale = staleRef.current;
    runRef.current = null;
    staleRef.current = null;
    if (!run) return;
    const { getLatestDoc: get, commit: put, toast: say } = latest.current;
    const before = get();
    const next = applyUndoRun(before, run);
    if (next === before) {
      // Nothing left to take back: say so rather than do nothing (§10).
      if (stale) say(stale);
      return;
    }
    put(next);
    run.steps[0]?.focusAfter?.();
  }, []);

  const push = useCallback(
    (p: LogicUndoPush<D>) => {
      const kind = p.kind ?? "rules";
      const live = runRef.current !== null;
      if (live && questionMustWait(runRef.current, kind)) return;
      const step: UndoStep<D> = { inverse: p.inverse, isDelete: p.isDelete ?? false };
      if (p.focusAfter) step.focusAfter = p.focusAfter;
      const next = undoRunReducer(runRef.current, { type: "push", step, live, kind });
      runRef.current = next;
      staleRef.current = p.staleMessage ?? null;
      const message = typeof p.message === "function" ? p.message(undoRunDeletes(next)) : p.message;
      messageRef.current = message;
      const toastId = toast(message, {
        key,
        action: { label: undoLabel(next), onAction: undo },
        ...(p.duration !== undefined ? { duration: p.duration } : {}),
        ...(p.focusAction ? { focusAction: true } : {}),
        ...(p.returnFocus ? { returnFocus: p.returnFocus } : {}),
        onHide: () => {
          // Only the run this toast belongs to ends here; a same-key update
          // never reports a hide, so an extended run survives its re-label.
          if (runRef.current === next) {
            runRef.current = null;
            staleRef.current = null;
          }
        },
      });
      // No provider mounted (the context default returns 0): nothing is
      // showing, so nothing can accumulate.
      if (toastId === 0) runRef.current = null;
    },
    [toast, key, undo],
  );

  /** Drop the pending run (the toast, if still up, keeps a no-op Undo). */
  const clear = useCallback(() => {
    runRef.current = null;
    staleRef.current = null;
  }, []);

  // D7: the run never outlives its host. On unmount it is dropped and its
  // toast taken down (a same-key update that expires at once), so a late
  // Undo can never commit against a document this view no longer holds.
  useEffect(
    () => () => {
      if (!runRef.current) return;
      runRef.current = null;
      staleRef.current = null;
      latest.current.toast(messageRef.current, { key, duration: 0 });
    },
    [key],
  );

  return { push, undo, clear, isLive: () => runRef.current !== null };
}
