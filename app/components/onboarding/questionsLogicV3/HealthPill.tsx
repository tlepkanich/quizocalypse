import type { ReactNode } from "react";
import type { Tier1Report } from "../../../lib/pathReport";
import { QzPopover } from "../../qz-overlays";

/* quiz-step3 v3 §2 / QL3-P4 — the health verdict pill in TopBar3. The pill,
   the popover it opens, and the Continue gate all read the ONE memoized
   Tier-1 report Step3Shell computes (verdict.blocking folds validateQuiz via
   the S1 structure check) — the three surfaces structurally cannot disagree.
   The pill is a real <button> trigger inside a CONTROLLED QzPopover so the
   blocked Continue ("Fix N issues") can open the same popover from outside. */

export type PillState = "ok" | "warn" | "bad";

/** §7.3 verdict → the pill's tri-state. Blocking wins over warnings; the
 *  copy reuses the report's own verdict vocabulary ("blocking"/"to review"/
 *  the DS-5 locked "Logic valid"). */
export function pillPresentation(verdict: Tier1Report["verdict"]): {
  state: PillState;
  text: string;
} {
  if (verdict.blocking > 0) {
    return { state: "bad", text: `${verdict.blocking} blocking` };
  }
  if (verdict.warnings > 0) {
    return { state: "warn", text: `${verdict.warnings} to review` };
  }
  return { state: "ok", text: "Logic valid" };
}

export function HealthPill({
  verdict,
  open,
  onOpenChange,
  popover,
}: {
  /** The verdict off Step3Shell's single memoized report instance. */
  verdict: Tier1Report["verdict"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The HealthPopover content (composed by the shell with the SAME report). */
  popover: ReactNode;
}) {
  const pill = pillPresentation(verdict);
  return (
    <QzPopover
      open={open}
      onOpenChange={onOpenChange}
      placement="bottom"
      maxWidth={460}
      trigger={
        <button
          type="button"
          className={`qz-s3-healthpill is-${pill.state}`}
          title={verdict.label}
          aria-label={`Quiz health: ${verdict.label}`}
        >
          <span className="qz-s3-healthdot" aria-hidden />
          {pill.text}
        </button>
      }
      content={popover}
    />
  );
}
