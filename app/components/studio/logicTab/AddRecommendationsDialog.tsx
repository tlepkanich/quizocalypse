import type { FunnelData } from "../../onboarding/stages/stagesShared";
import type { BuilderCategory } from "../../builder/stepProps";
import { QzModal } from "../../qz-overlays";
import { STRIP_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the "Add recommendations" window (PLACEHOLDER; agent
// E replaces the body). Mock arHTML / drawAR; handoff "The Add
// recommendations window" (D15): it writes through POST
// /api/categories/ensure-targets with the new "group" kind, batches of at
// most 12, tag keys as Step-1 slugs, rows always quiz-scoped; new rows are
// lifted into the view through onCategoriesCreated (the loader only
// refreshes on autosave revalidation). Toast "Added 1 recommendation. It
// needs a rule" / "Added N recommendations. Each needs a rule" (B65).
//
// PROPS CONTRACT (agent E builds on these):
//   open                 mounted only while open is fine; the card passes
//                        true while it is showing
//   quizId               the ensure-targets endpoint needs it
//   catalog              the funnel loader's catalogue, passed through
//                        UNTOUCHED (FunnelData["catalog"]: tags, collections,
//                        groups, products). Absent on the builder today (its
//                        loader has no lean lists yet, D6 parked).
//   categories           every category the view knows (to mark rows that
//                        are already in this quiz)
//   onCategoriesCreated  lift new quiz-scoped rows into the view at once
//   onClose              close (Esc / Cancel / ×; a scrim click never closes
//                        a window that holds a draft)
// ════════════════════════════════════════════════════════════════════════════

export type LogicCatalog = FunnelData["catalog"];

export type AddRecommendationsDialogProps = {
  open: boolean;
  quizId: string;
  catalog?: LogicCatalog;
  categories: readonly BuilderCategory[];
  onCategoriesCreated: (cats: BuilderCategory[]) => void;
  onClose: () => void;
};

export function AddRecommendationsDialog({ open, onClose }: AddRecommendationsDialogProps) {
  return (
    <QzModal open={open} onClose={onClose} size="sm" title={STRIP_COPY.addRecommendationsLabel} draftSafe>
      <p className="qz-dim" style={{ margin: 0 }} data-testid="add-recs-placeholder">
        Adding recommendations from here is on its way.
      </p>
    </QzModal>
  );
}
