import { useEffect, useState } from "react";

// §A3 (LOCKED) — the master loading animation: Variation A. A single centered
// conic-sweep ring that spins AND breathes, with optionally-rotating warm
// messages beneath it. Reduced-motion → static ring + a single message. An
// optional max-wait timeout surfaces "still working…" + retry so a wait never
// dead-hangs. Reused by every indeterminate loading/interstitial state.

// QRTZ-S2 — Quartz retune: the rotation states what the work IS, calmly.
// The jokey interstitials ("grab a coffee ☕", "hi :)") are off-spec for
// Quartz — the mock's loading surfaces carry no jokey tone.
export const QZ_LOADING_MESSAGES = [
  "Reading your catalog…",
  "Matching your products…",
  "Drafting your questions…",
  "Shaping your results…",
  "Adding the finishing touches…",
];

export function QzLoadingRing({
  size = 78,
  /** Cycle these ~2.3s each. Omit to use the locked list; pass [one] to pin it. */
  messages = QZ_LOADING_MESSAGES,
  /** After this many ms show a "still working…" line + optional retry. */
  timeoutMs,
  onRetry,
}: {
  size?: number;
  messages?: readonly string[];
  timeoutMs?: number;
  onRetry?: () => void;
}) {
  const [i, setI] = useState(0);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setI((n) => (n + 1) % messages.length), 2300);
    return () => clearInterval(t);
  }, [messages.length]);

  useEffect(() => {
    if (!timeoutMs) return;
    const t = setTimeout(() => setStalled(true), timeoutMs);
    return () => clearTimeout(t);
  }, [timeoutMs]);

  // Empty `messages` = ring only (the caller shows its own progress copy).
  const msg = messages.length ? messages[i % messages.length] : null;
  return (
    <div className="qz-loadring" role="status" aria-live="polite">
      <div className="qz-ring-wrap" style={{ width: size, height: size }}>
        <div className="qz-ring" style={{ width: size, height: size }} aria-hidden />
      </div>
      {msg ? (
        <div className="qz-loadring-msg" key={msg}>
          {msg}
        </div>
      ) : null}
      {stalled ? (
        <div className="qz-loadring-stall">
          Still working…
          {onRetry ? (
            <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onRetry} style={{ marginLeft: 8 }}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
