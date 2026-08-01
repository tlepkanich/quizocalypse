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

// `savedAt` is an ISO string from the CLIENT autosave fetcher — never
// server-rendered, so local-time formatting is safe ([[ssr-unsafe-locale-dates]]).
function savedTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/* §1.3 — the bar's save chip (autosave truth: the reason nothing asks you to
   confirm navigation). Reuses the builder's .qz-save-chip states. */
export function FunnelSaveChip({
  isSaving,
  savedAt,
  saveError,
  onRetry,
}: {
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
}) {
  return (
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
  );
}
