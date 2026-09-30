import type { Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { BuilderCategory } from "../../builder/stepProps";
import type { RulesUndo } from "./RulesList";
import { IO_COPY } from "./logicCopy";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — Import | Export (PLACEHOLDER; agent F replaces the
// behaviour). Mock headRight .iox; handoff D16 / D16-template: Export is
// also the template; the library is SheetJS CE 0.20.3 as a LAZY chunk
// (never npm xlsx 0.18.5). LogicHeader renders whatever LogicTabCard passes
// in its `importExport` slot, and only in the Table view.
//
// PROPS CONTRACT (agent F builds on these):
//   doc / style / questions / categories / recommendations — as the Table
//   commit         absent = read-only (Import hidden or disabled)
//   getLatestDoc   an import applies against the newest doc, ONE commit
//   undo           the card's ONE Undo run; an import pushes one entry
//                  whose inverse restores what it replaced (D7)
// Until F lands, both buttons render disabled (no ghost behaviour).
// ════════════════════════════════════════════════════════════════════════════

export type LogicImportExportProps = {
  doc: Quiz;
  style: LogicStyle;
  questions: OrderedQuestion[];
  categories: readonly BuilderCategory[];
  recommendations: readonly BuilderCategory[];
  commit?: (doc: Quiz) => void;
  getLatestDoc: () => Quiz;
  undo?: RulesUndo;
};

export function LogicImportExport(_props: LogicImportExportProps) {
  return (
    <span className="qz-lg-iox" data-testid="logic-io">
      <button type="button" title={IO_COPY.importTip} disabled>
        {IO_COPY.import}
      </button>
      <button type="button" title={IO_COPY.exportTip} disabled>
        {IO_COPY.export}
      </button>
    </span>
  );
}
