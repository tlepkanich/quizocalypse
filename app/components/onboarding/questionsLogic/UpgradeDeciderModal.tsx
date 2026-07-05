import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { Quiz as QuizDoc } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import {
  proposeDeciderFromLegacy,
  executeDeciderUpgrade,
} from "../../../lib/proposeDeciderConversion";

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-10f) — the explicit per-quiz legacy→decider upgrade wizard.
// Portal to document.body (builder-overlay-portal: an in-flow fixed overlay
// inside the builder gets pointer-trapped by the preview pane's container-
// type/zoom transform); reuses the L2-7 report scrim (z-index 1200, proven).
// Confirm applies executeDeciderUpgrade through the caller's useQuizDraft
// commit — ONE history entry, so the top-bar undo restores everything.
// Never a bulk-migration surface: one quiz, one explicit confirmation.
// ════════════════════════════════════════════════════════════════════════════

export default function UpgradeDeciderModal({
  doc,
  categories,
  surface,
  onCommit,
  onClose,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  /** Which host mounts the wizard — the copy is surface-honest: only the
   *  BUILDER has a history stack (one-step undo) and only the FUNNEL reaches
   *  the Recommendation step's capture toggles. */
  surface: "builder" | "funnel";
  onCommit: (next: QuizDoc) => void;
  onClose: () => void;
}) {
  const proposal = useMemo(
    () => proposeDeciderFromLegacy(doc, categories),
    [doc, categories],
  );
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus capture is mount-only (the PathReportPanel split) — a host
  // re-render mid-open (autosave chips etc.) must not snap focus back.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => prev?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // mergedPageNames carries the KEPT page first, then the pages merging in.
  const [keptPage, ...mergedPages] = proposal?.mergedPageNames ?? [];

  return createPortal(
    <div className="qz-ql-report-scrim" onMouseDown={onClose}>
      <div
        className="qz-upg-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Upgrade to Decider logic"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <strong style={{ fontSize: 17, fontFamily: "var(--qz-font-display)" }}>
          ↑ Upgrade to Decider logic
        </strong>

        {proposal ? (
          <>
            <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
              One question decides the result — each of its answers points at one of your
              recommendations, and advanced rules can override it. Here&rsquo;s what changes:
            </p>
            <ul className="qz-upg-list">
              <li>
                <strong>&ldquo;{proposal.decidingQuestionText}&rdquo;</strong> becomes the
                deciding question, with each answer pre-mapped to a recommendation. Your other
                questions stay as qualifiers.
              </li>
              {mergedPages.length > 0 ? (
                <li>
                  Your result pages merge into one —{" "}
                  {mergedPages.map((n) => `“${n}”`).join(", ")} fold into{" "}
                  <strong>&ldquo;{keptPage}&rdquo;</strong>; custom page headlines carry
                  over as per-recommendation overrides.
                </li>
              ) : (
                <li>
                  <strong>&ldquo;{keptPage}&rdquo;</strong> stays as your single results
                  page, configurable per recommendation.
                </li>
              )}
              <li>
                Advanced rules start empty — add overrides in the Rules tab whenever
                you&rsquo;re ready.
              </li>
              <li>
                {/* §7.1 disclosure — copy OWNER-APPROVED 2026-07-03 as drafted. */}
                <strong>Email capture becomes required</strong> on the results reveal once
                you republish
                {surface === "funnel"
                  ? " (you can add name and phone too, or turn capture off entirely in the Recommendation step)"
                  : ""}
                .
              </li>
              <li>
                This converts <strong>this draft only</strong> — your published quiz keeps
                serving exactly as-is until you republish.{" "}
                {surface === "builder"
                  ? "Undo restores everything in one step."
                  : "This draft can't be converted back afterwards, so keep Cancel handy if you're unsure."}
              </li>
            </ul>
            <div className="qz-row" style={{ gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="qz-btn qz-btn-ghost" ref={cancelRef} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="qz-btn qz-btn-accent"
                onClick={() => {
                  onCommit(executeDeciderUpgrade(doc, proposal));
                  onClose();
                }}
              >
                Upgrade this draft →
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="qz-dim" style={{ margin: 0, fontSize: 13.5 }}>
              This quiz&rsquo;s answers don&rsquo;t map cleanly enough onto your recommendations to
              auto-convert — it needs at least two recommendations, a reachable results page, and a
              single-answer question (asked of everyone) whose answers point at two or more
              different recommendations. Adjust the quiz or its recommendations and try again.
            </p>
            <div className="qz-row" style={{ gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="qz-btn qz-btn-ghost" ref={cancelRef} onClick={onClose}>
                Close
              </button>
              <button type="button" className="qz-btn qz-btn-accent" disabled title="No clean auto-conversion found">
                Upgrade this draft →
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
