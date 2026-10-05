import { describe, expect, it } from "vitest";
import type { Quiz } from "../../../lib/quizSchema";
import type { Tier1Link } from "../../../lib/pathReport";
import { healthLinkToFocus } from "./healthFocus";

// Every link kind the Tier-1 report produces must land somewhere: a kind
// that maps to null is a dead "Go to it" click.

const docWith = (ruleCount: number): Quiz =>
  ({
    decision_rules: Array.from({ length: ruleCount }, (_, i) => ({ id: `r${i + 1}` })),
  }) as unknown as Quiz;

describe("healthLinkToFocus", () => {
  it("a question link selects that question", () => {
    expect(healthLinkToFocus({ kind: "question", nodeId: "q1" }, docWith(0))).toEqual({
      kind: "question",
      id: "q1",
    });
  });

  it("a rule link opens the rule window unless the host asks for the row only", () => {
    const link: Tier1Link = { kind: "rule", ruleId: "r1" };
    expect(healthLinkToFocus(link, docWith(1))).toEqual({ kind: "rule", id: "r1", open: true });
    expect(healthLinkToFocus(link, docWith(1), { openRule: false })).toEqual({
      kind: "rule",
      id: "r1",
      open: false,
    });
  });

  it("a rules link opens a blank rule window when there are no rules, else the list", () => {
    expect(healthLinkToFocus({ kind: "rules" }, docWith(0))).toEqual({ kind: "create" });
    expect(healthLinkToFocus({ kind: "rules" }, docWith(2))).toEqual({ kind: "rules" });
  });

  it("a recommendation link carries the recommendation and the picking question when named", () => {
    expect(
      healthLinkToFocus({ kind: "recommendation", categoryId: "cat1", nodeId: "q2" }, docWith(0)),
    ).toEqual({ kind: "recommendation", id: "cat1", questionId: "q2" });
    expect(healthLinkToFocus({ kind: "recommendation", categoryId: "cat1" }, docWith(0))).toEqual({
      kind: "recommendation",
      id: "cat1",
    });
  });

  it("a style link opens the style menu", () => {
    expect(healthLinkToFocus({ kind: "style" }, docWith(0))).toEqual({ kind: "style" });
  });

  it("a link that names nothing maps to null", () => {
    expect(healthLinkToFocus({ kind: "question" }, docWith(0))).toBeNull();
    expect(healthLinkToFocus({ kind: "rule" }, docWith(0))).toBeNull();
    expect(healthLinkToFocus({ kind: "recommendation" }, docWith(0))).toBeNull();
  });
});
