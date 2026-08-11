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
  /** QRTZ-S2 (handoff STATES §Button·Loading): submit in flight. The label
   *  MUST stay constant — a 14px ring joins it instead of the copy changing
   *  ("Opening builder…"-style label swaps resize the button mid-action). */
  loading?: boolean;
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

/* Quartz states.mjs icon vocabulary (24-viewBox, 1.8 stroke). */
function SvIcon({ spin, children }: { spin?: boolean; children: ReactNode }) {
  return (
    <svg
      className={spin ? "qz-sv-spin" : undefined}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/* QRTZ-S2 (owner-call 8a resolved: the 2026-08-09 mock wins over the
   2026-08-02 error-only edit) — the chip draws all FOUR autosave states from
   the states.mjs sv- pattern:
     Saving…  isSaving — the fetcher is busy, i.e. ONLY after the 700ms
              debounce fired, so typing never flickers the chip.
     Saved    savedAt set — ✓ in the ok tone.
     Not saved · Retry
              saveError — persists, never fades, until a retry succeeds
              (the merchant's work is only in the tab).
     Paused while AI edits
              isAiPaused — useQuizDraft suspended autosave so a debounced PUT
              cannot land a stale doc mid-AI-call. Accent-ink tone. */
export function FunnelSaveChip({
  isSaving,
  savedAt,
  saveError,
  onRetry,
  isAiPaused = false,
}: {
  isSaving: boolean;
  savedAt: string | null;
  saveError: string | null;
  onRetry: () => void;
  /** useQuizDraft().isAiPaused — optional so existing call sites are untouched. */
  isAiPaused?: boolean;
}) {
  let body: ReactNode = null;
  if (saveError) {
    body = (
      <span className="qz-sv is-error">
        <SvIcon>
          <path d="M12 8v5" />
          <circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none" />
          <path d="M10.3 3.9 2.7 17.2A2 2 0 0 0 4.4 20.2h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </SvIcon>
        Not saved
        <button type="button" className="qz-sv-retry" onClick={onRetry}>
          Retry
        </button>
      </span>
    );
  } else if (isAiPaused) {
    body = (
      <span className="qz-sv is-paused">
        <SvIcon>
          <path d="M9 5v14M15 5v14" />
        </SvIcon>
        Paused while AI edits
      </span>
    );
  } else if (isSaving) {
    body = (
      <span className="qz-sv is-saving">
        <SvIcon spin>
          <path d="M12 3a9 9 0 1 0 9 9" />
        </SvIcon>
        Saving…
      </span>
    );
  } else if (savedAt) {
    body = (
      <span className="qz-sv is-saved">
        <SvIcon>
          <path d="m4.5 12.5 5 5 10-11" />
        </SvIcon>
        Saved
      </span>
    );
  }
  if (!body) return null;
  return (
    <span className="qz-save-status" aria-live="polite">
      {body}
    </span>
  );
}
