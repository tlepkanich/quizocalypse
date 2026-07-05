import { useRef, useState } from "react";
import { QzModal } from "../../../qz-overlays";

/* quiz-step3 v3 §5.4 — the decider flag tab hanging off each section card
   (spec geometry: −19px top / 20px left, styled in .qz-s3-flag). The decider
   wears the solid gold ◆; every qualifier shows the ghost ◇ ALWAYS (moving
   the decider must never require discovering a hover state). Clicking a
   ghost opens the §5.4 confirm dialog — its copy states the locked
   consequences: the current decider's answer MAPPINGS ARE CLEARED, advanced
   RULES ARE KEPT. Multi-select / open-text questions can't decide (§2.2) —
   the tab renders disabled with the reason (moveDecider would no-op anyway;
   the UI says why instead of failing silently). */

export function FlagTab({
  isDecider,
  qIndex,
  blockedReason,
  hasCurrentDecider,
  onConfirm,
}: {
  isDecider: boolean;
  qIndex: number;
  /** Non-null on multi-select/open-text questions — the §2.2 refusal copy. */
  blockedReason: string | null;
  /** False on a no-decider doc (first promotion — nothing gets cleared). */
  hasCurrentDecider: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  if (isDecider) {
    return (
      <span className="qz-s3-flag is-decider" title="This question decides the result">
        <span aria-hidden>◆</span> Decider
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="qz-s3-flag is-ghost"
        disabled={blockedReason !== null}
        title={blockedReason ?? "Make this the deciding question"}
        onClick={() => setConfirming(true)}
      >
        <span aria-hidden>◇</span> Make decider
      </button>

      <QzModal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Make this the deciding question?"
        initialFocusRef={cancelRef}
        footer={
          <>
            <button
              ref={cancelRef}
              type="button"
              className="qz-btn"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="qz-btn qz-btn-primary"
              onClick={() => {
                setConfirming(false);
                onConfirm();
              }}
            >
              ◆ Make it the decider
            </button>
          </>
        }
      >
        {hasCurrentDecider ? (
          <>
            Q{qIndex}&rsquo;s answers will point straight at recommendations. The current
            deciding question&rsquo;s answer mappings are <strong>cleared</strong> — this
            question starts unmapped, so you&rsquo;ll pick a recommendation for each answer.
            Your advanced rules are <strong>kept</strong> exactly as they are (review any
            that reference the old decider).
          </>
        ) : (
          <>
            Q{qIndex}&rsquo;s answers will point straight at recommendations — you&rsquo;ll
            pick one for each answer. Your advanced rules are <strong>kept</strong> exactly
            as they are.
          </>
        )}
      </QzModal>
    </>
  );
}
