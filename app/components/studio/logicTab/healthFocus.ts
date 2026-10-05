import type { Quiz } from "../../../lib/quizSchema";
import type { Tier1Link } from "../../../lib/pathReport";
import type { LogicFocusRequest } from "./LogicTabCard";

// ════════════════════════════════════════════════════════════════════════════
// The ONE mapping from a health finding's "Go to it" link to the Logic card's
// focus request. The funnel Logic step and the builder's health popover both
// read it, so a link kind one host resolves can never be a dead click in the
// other (the builder once handled only question and rule links). Pure.
// ════════════════════════════════════════════════════════════════════════════

/** Omit distributed over a union (keeps each LogicFocusRequest variant). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A focus request before its host stamps the nonce. */
export type LogicFocusTarget = DistributiveOmit<LogicFocusRequest, "nonce">;

/** Where a finding's link lands in the Logic card. Null = the link names
 *  nothing to land on (a malformed link; never a dead click by design). */
export function healthLinkToFocus(
  link: Tier1Link,
  doc: Quiz,
  opts: { /** open the rule window on a rule link (default true) */ openRule?: boolean } = {},
): LogicFocusTarget | null {
  switch (link.kind) {
    case "question":
      return link.nodeId ? { kind: "question", id: link.nodeId } : null;
    case "rule":
      return link.ruleId
        ? { kind: "rule", id: link.ruleId, open: opts.openRule !== false }
        : null;
    case "rules":
      // With no rules at all the fix is a blank rule window.
      return (doc.decision_rules ?? []).length === 0 ? { kind: "create" } : { kind: "rules" };
    case "recommendation":
      return link.categoryId
        ? {
            kind: "recommendation",
            id: link.categoryId,
            ...(link.nodeId ? { questionId: link.nodeId } : {}),
          }
        : null;
    case "style":
      return { kind: "style" };
  }
}
