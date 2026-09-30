import type { Quiz } from "../../../lib/quizSchema";
import type { LogicStyle } from "../../../lib/logicStyle";
import type { OrderedQuestion } from "../../../lib/questionOrder";
import type { RuleStatus } from "../../../lib/ruleStatus";
import type { BuilderCategory } from "../../builder/stepProps";
import type { SaveToken } from "../saveTracker";
import type { RulesUndo } from "./RulesList";

// ════════════════════════════════════════════════════════════════════════════
// Logic step redesign — the Table view (PLACEHOLDER; agent F replaces the
// body). Mock tableHTML / sheets; handoff "Table view, Export and Import"
// (D16, D17). LogicTabCard renders this whenever view === "table", in
// either style, under the shared header (whose right side then shows the
// LogicImportExport pair).
//
// PROPS CONTRACT (agent F builds on these; add optional props freely, do
// not rename these without updating LogicTabCard):
//   doc            the live draft (render from it, never a snapshot)
//   style          the SCREEN style (resolveLogicStyle) — which sheets show
//   questions      orderedQuestions(doc) — the rail's numbering (Qn)
//   categories     every category the view knows (quiz-scoped + shop-global,
//                  plus rows created this session)
//   recommendations  this quiz's recommendations (quizId != null), in order
//   statuses       ruleStatuses(doc, knownIds) — tags / "Shown by rules"
//   commit         absent = read-only; every in-cell edit is ONE commit of a
//                  pure mutation (the same mutations Edit uses)
//   commitTracked  optional; a SaveToken per commit for the field save pill
//   getLatestDoc   the newest doc (commit after an await against this)
//   undo           the card's ONE Undo run (shared with the rule rows and
//                  the rule window): push({message, inverse, isDelete, ...})
//   onEditRule(ruleId)          open the rule window on that rule
//   onCreateFor(categoryId)     open "Create a rule" with it picked
//   onSelectQuestion(nodeId)    switch to Edit with that question selected
// ════════════════════════════════════════════════════════════════════════════

export type LogicTableViewProps = {
  doc: Quiz;
  style: LogicStyle;
  questions: OrderedQuestion[];
  categories: readonly BuilderCategory[];
  recommendations: readonly BuilderCategory[];
  statuses: ReadonlyMap<string, RuleStatus>;
  commit?: (doc: Quiz) => void;
  commitTracked?: (doc: Quiz) => SaveToken;
  getLatestDoc: () => Quiz;
  undo?: RulesUndo;
  onEditRule?: (ruleId: string) => void;
  onCreateFor?: (categoryId: string) => void;
  onSelectQuestion?: (nodeId: string) => void;
};

export function LogicTableView(_props: LogicTableViewProps) {
  return (
    <div className="qz-lg-tview" data-testid="logic-table-view">
      <p className="qz-lg-tnote">Table view</p>
    </div>
  );
}
