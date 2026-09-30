// Logic step redesign (D1, D5) — the ONE module that reads a decider quiz's
// logic style. Two readers, deliberately different values:
//
//   resolveLogicStyle(doc) — which SCREEN opens. Never null, never writes:
//     doc.logic_style → build_session.logic_style (migration read) →
//     inference → "attributes".
//   engineLogicStyle(doc) — what the ENGINE (and the report, validation and
//     publish gate that must agree with it) actually runs. Only the stored doc
//     field counts; absent means "attributes" (today's engine), and a legacy
//     doc is always "attributes".
//
// They differ on exactly one class of draft: rules, no filter role, no saved
// field. That draft OPENS on Rules only by inference but its shoppers still
// run Filter Results + Rules until the merchant uses the title switch
// (setLogicStyle). No engine/report/gate code may call resolveLogicStyle.
// Pure, type-only imports (this module ships in the /q bundle via
// recommendDecider).
import type { Quiz } from "./quizSchema";

export type LogicStyle = "rules" | "attributes";

type StyleDoc = Pick<
  Quiz,
  "logic_model" | "logic_style" | "build_session" | "decision_rules" | "nodes"
>;

/** The inference step alone (D5): any question with the "filter" role →
 *  Filter Results + Rules; else any decision rule → Rules only; else null. */
export function inferLogicStyle(
  doc: Pick<Quiz, "decision_rules" | "nodes">,
): LogicStyle | null {
  const hasFilter = doc.nodes.some(
    (n) => n.type === "question" && n.data.role === "filter",
  );
  if (hasFilter) return "attributes";
  if ((doc.decision_rules ?? []).length > 0) return "rules";
  return null;
}

/** The SCREEN style (D5). Saved field → legacy build_session key → inference
 *  → "attributes". Never null; writes nothing. Screen code only. */
export function resolveLogicStyle(doc: StyleDoc): LogicStyle {
  if (doc.logic_style) return doc.logic_style;
  const sessionStyle = doc.build_session?.logic_style;
  if (sessionStyle) return sessionStyle;
  return inferLogicStyle(doc) ?? "attributes";
}

/** The ENGINE style (D1). A decider doc runs its stored `logic_style`
 *  (absent → "attributes"); every non-decider doc is "attributes". Read by
 *  resolveTarget, the recommendation engine, buildTier1Report, validateQuiz
 *  and publishQuiz — never the inferred screen style. */
export function engineLogicStyle(
  doc: Pick<Quiz, "logic_model" | "logic_style">,
): LogicStyle {
  return doc.logic_model === "decider"
    ? (doc.logic_style ?? "attributes")
    : "attributes";
}

/** True only for a decider doc whose engine style is Rules only. */
export function isRulesOnly(
  doc: Pick<Quiz, "logic_model" | "logic_style">,
): boolean {
  return engineLogicStyle(doc) === "rules";
}
