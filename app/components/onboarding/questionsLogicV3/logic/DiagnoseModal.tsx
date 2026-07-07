import { useState } from "react";
import type { z } from "zod";
import type { Quiz } from "../../../../lib/quizSchema";
import type { Tier1Link, Tier1Report } from "../../../../lib/pathReport";
import type { IndexedProduct } from "../../../../lib/recommendationEngine";
import type { BuilderCategory } from "../../../builder/stepProps";
import { QzModal } from "../../../qz-overlays";
import { HealthPopover } from "../HealthPopover";
import { PathTester } from "../../../logic/PathTester";

type QuizDoc = z.infer<typeof Quiz>;

/* QZY-2 (quiz-logic dev-handoff v1.2 §10) — ONE modal combining automated
   diagnostics and manual path testing. Launched from the sub-header's
   "+ Diagnose / Preview" button AND the top-right Fix-N-issues control
   (which opens straight onto Diagnostics). The Diagnostics tab reuses the
   whole health body (Tier-1 checklist with click-to-jump + the ✦ Tier-2
   advisory); Test a path reuses PathTester, which walks the REAL routing
   via tracePath and resolves through the production engine — a branched
   answer skips exactly the questions its route skips (§10.2). */

export type DiagnoseTab = "diagnostics" | "test";

export function DiagnoseModal({
  open,
  initialTab,
  onClose,
  doc,
  quizId,
  report,
  categories,
  productIndex,
  onCommit,
  onFlush,
  onNavigate,
}: {
  open: boolean;
  initialTab: DiagnoseTab;
  onClose: () => void;
  doc: QuizDoc;
  quizId: string;
  report: Tier1Report;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  onCommit: (doc: QuizDoc) => void;
  onFlush: () => void;
  /** Click-to-jump — the host closes the modal and focuses the map element. */
  onNavigate: (link: Tier1Link) => void;
}) {
  const [tab, setTab] = useState<DiagnoseTab>(initialTab);
  // Re-sync the tab each open (the Fix control always lands on Diagnostics).
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setTab(initialTab);
  }

  return (
    <QzModal open={open} onClose={onClose} size="lg" title="Diagnose & preview">
      <div className="qz-segmented" role="group" aria-label="Diagnose mode" style={{ marginBottom: 14 }}>
        <button type="button" aria-pressed={tab === "diagnostics"} onClick={() => setTab("diagnostics")}>
          Diagnostics
        </button>
        <button type="button" aria-pressed={tab === "test"} onClick={() => setTab("test")}>
          Test a path
        </button>
      </div>

      {tab === "diagnostics" ? (
        <HealthPopover
          report={report}
          doc={doc}
          quizId={quizId}
          onCommit={onCommit}
          onFlush={onFlush}
          onNavigate={onNavigate}
        />
      ) : (
        <PathTester doc={doc} productIndex={productIndex} categories={categories} />
      )}
    </QzModal>
  );
}
