import { useEffect } from "react";
import { createPortal } from "react-dom";

// Questions & Logic spec §8 — the orphaned-bucket soft-warning shown when the
// merchant clicks Continue→ while one or more Step-1 buckets have NO answers
// mapped to them. Lists the orphaned bucket names; "Fix it" dismisses, "Continue
// anyway" proceeds. Portaled to document.body (the builder-overlay-portal lesson:
// a fixed dialog inside a transformed/container ancestor gets pointer-trapped).
export function ContinueGuard({
  bucketNames,
  onFix,
  onContinueAnyway,
}: {
  bucketNames: string[];
  onFix: () => void;
  onContinueAnyway: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFix();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFix]);

  if (typeof document === "undefined") return null;
  const n = bucketNames.length;

  return createPortal(
    <div className="qz-ql-guard-scrim" onMouseDown={onFix}>
      <div
        className="qz-ql-guard"
        role="alertdialog"
        aria-modal="true"
        aria-label="Some buckets have no mapped answers"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="qz-ql-guard-title">
          {n} {n === 1 ? "bucket has" : "buckets have"} no mapped answers
        </div>
        <ul className="qz-ql-guard-list">
          {bucketNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <p className="qz-ql-guard-body">
          Shoppers may never see {n === 1 ? "this product group" : "these product groups"}. Map an
          answer to {n === 1 ? "it" : "each"} so it can be recommended.
        </p>
        <div className="qz-ql-guard-actions">
          <button type="button" className="qz-btn qz-btn-ghost" onClick={onFix}>
            Fix it
          </button>
          <button type="button" className="qz-btn qz-btn-accent" onClick={onContinueAnyway}>
            Continue anyway
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
