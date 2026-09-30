import { useCallback, useId, useRef } from "react";

import { useQzToast } from "../../qz-toast";

/* D7 (owner 2026-09-22) — Undo as inverse mutations against the LATEST
   document, never a whole-document snapshot, so an unrelated edit made while
   the toast is up survives the Undo.

   While its toast is live, further deletes / moves / clears join the same
   run, so one Undo takes back the whole run (mock snap/toastU, B35): the
   inverses are applied newest-first to getLatestDoc() in ONE commit. The
   run ends when its toast leaves (timeout, replaced by another action toast,
   or Undo pressed). A plain toast never ends it (B7, see qz-toast.tsx).

   Label (mock toastU): "Undo" for one step, and for a run made only of
   deletes (its message already counts them, e.g. "3 rules deleted");
   "Undo both" / "Undo all N" for a mixed run of 2 / N steps. */

export type UndoStep<D> = {
  /** Maps the latest doc to the doc with this one step undone. */
  inverse: (doc: D) => D;
  /** A delete. A run made only of deletes keeps the plain "Undo" label. */
  isDelete: boolean;
  /** Where focus goes after this step is undone (the oldest step's wins). */
  focusAfter?: () => void;
};

export type UndoRun<D> = { steps: UndoStep<D>[] };

export type UndoRunAction<D> =
  | { type: "push"; step: UndoStep<D>; live: boolean }
  | { type: "clear" };

/** Pure accumulator: a push while the run's toast is live extends the run;
    otherwise it starts a new one. */
export function undoRunReducer<D>(run: UndoRun<D> | null, action: UndoRunAction<D>): UndoRun<D> | null {
  if (action.type === "clear") return null;
  if (run && action.live) return { steps: [...run.steps, action.step] };
  return { steps: [action.step] };
}

/** The action label for a run (mock toastU). */
export function undoLabel<D>(run: UndoRun<D> | null): string {
  if (!run) return "Undo";
  const n = run.steps.length;
  const dels = run.steps.filter((s) => s.isDelete).length;
  if (n > 1 && dels < n) return n === 2 ? "Undo both" : `Undo all ${n}`;
  return "Undo";
}

/** Apply every inverse, newest first, to the latest doc. */
export function applyUndoRun<D>(doc: D, run: UndoRun<D>): D {
  let next = doc;
  for (let i = run.steps.length - 1; i >= 0; i--) next = run.steps[i]!.inverse(next);
  return next;
}

export type LogicUndoPush<D> = {
  /** Toast message for the run so far (the caller counts, e.g. "2 rules deleted"). */
  message: string;
  inverse: (doc: D) => D;
  isDelete?: boolean;
  focusAfter?: () => void;
  /** Focus the Undo button (the control that triggered this was destroyed). */
  focusAction?: boolean;
  /** Where focus goes if the toast hides while holding it. */
  returnFocus?: () => void;
  /** Toast duration override (default 6000 for an action toast). */
  duration?: number;
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
  const latest = useRef({ getLatestDoc, commit });
  latest.current = { getLatestDoc, commit };

  const undo = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (!run) return;
    const { getLatestDoc: get, commit: put } = latest.current;
    put(applyUndoRun(get(), run));
    run.steps[0]?.focusAfter?.();
  }, []);

  const push = useCallback(
    (p: LogicUndoPush<D>) => {
      const step: UndoStep<D> = { inverse: p.inverse, isDelete: p.isDelete ?? false };
      if (p.focusAfter) step.focusAfter = p.focusAfter;
      const next = undoRunReducer(runRef.current, { type: "push", step, live: runRef.current !== null });
      runRef.current = next;
      const toastId = toast(p.message, {
        key,
        action: { label: undoLabel(next), onAction: undo },
        ...(p.duration !== undefined ? { duration: p.duration } : {}),
        ...(p.focusAction ? { focusAction: true } : {}),
        ...(p.returnFocus ? { returnFocus: p.returnFocus } : {}),
        onHide: () => {
          // Only the run this toast belongs to ends here; a same-key update
          // never reports a hide, so an extended run survives its re-label.
          if (runRef.current === next) runRef.current = null;
        },
      });
      // No provider mounted (the context default returns 0): nothing is
      // showing, so nothing can accumulate.
      if (toastId === 0) runRef.current = null;
    },
    [toast, key, undo],
  );

  /** Drop the pending run (the toast, if still up, keeps a no-op Undo).
      The run deliberately OUTLIVES an unmount of the host: an Undo on a
      toast that is still showing must still work (D7 — it is the only way
      back from a delete). */
  const clear = useCallback(() => {
    runRef.current = null;
  }, []);

  return { push, undo, clear, isLive: () => runRef.current !== null };
}
