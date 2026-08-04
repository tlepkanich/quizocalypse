import { createContext, useContext, useEffect } from "react";
import type { ReactNode } from "react";

/* One-line-chrome handoff §1 — the funnel's single top bar is owned by
   Step1Funnel (chrome must stay full-bleed while the page content is capped),
   but two of its zones are stage-specific: the save chip on the autosaving
   editing stages (useQuizDraft) and the step's primary Continue. Stages
   publish those through this context instead of mounting their own bars —
   TopBar3 (the Step-3 floating bar) is retired by this seam.

   PUBLISH CONTRACT: the override object MUST be memoized on real state (a
   fresh object every render → publish → parent re-render → fresh object is an
   infinite setState loop). Handlers inside it must be referentially stable
   (useCallback / setState setters / ref-wrapped fetcher submits). */

export type FunnelContinueSpec = {
  label: string;
  onClick: () => void;
  /** Hard-disabled (busy / nothing selected). */
  disabled?: boolean;
  /** Disabled LOOK but still clickable — Logic's "Fix N issues to continue"
   *  routes the click into the diagnose surface instead of advancing. */
  blocked?: boolean;
  /** Tooltip carried on the wrapper when disabled (why it's off). */
  title?: string;
};

export type FunnelBarOverride = {
  saveChip?: ReactNode;
  healthPill?: ReactNode;
  continueSpec?: FunnelContinueSpec;
};

export const FunnelBarContext = createContext<{
  publish: (override: FunnelBarOverride | null) => void;
} | null>(null);

/** Publish stage-specific bar state; clears itself on unmount. */
export function useFunnelBar(override: FunnelBarOverride) {
  const ctx = useContext(FunnelBarContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.publish(override);
    return () => ctx.publish(null);
  }, [ctx, override]);
}

/* §1.3, amended by owner edit (2026-08-02): autosave is silent when healthy —
   no "Saving…"/"Saved" chip in the bar (the step flow owns that width).
   The chip materializes ONLY on a save error, because a failing autosave is
   the one state the merchant must see (it is the truth behind never asking
   to confirm navigation). `isSaving`/`savedAt` stay in the signature so the
   stages' publish contracts are untouched. */
export function FunnelSaveChip({
  saveError,
  onRetry,
}: {
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
}) {
  if (!saveError) return null;
  return (
    <span className="qz-save-status" aria-live="polite">
      <span className="qz-save-chip is-error">
        <span aria-hidden>⚠</span> {saveError} ·{" "}
        <button type="button" className="qz-ql-retry" onClick={onRetry}>
          Retry
        </button>
      </span>
    </span>
  );
}
