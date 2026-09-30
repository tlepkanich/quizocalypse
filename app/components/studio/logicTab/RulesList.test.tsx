// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { logicDoc, rule } from "../../../lib/logicStep.fixtures";
import { ruleStatuses } from "../../../lib/ruleStatus";
import { describeRuleTokens } from "../../../lib/ruleSummary";
import { RulesList, ruleSentenceText, ruleTags, type RulesUndo } from "./RulesList";
import { RecommendationsStrip } from "./RecommendationsStrip";
import { joinNumbers } from "./logicCopy";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Logic step redesign — the ONE rules list (D11, D17, D19) and the
// recommendations strip (D14, B49). Pins: the mock's sentence grammar, the
// tag wording from ruleStatuses, delete/move as inverse-mutation Undo against
// the LATEST doc, and the strip's coverage + labels.

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function render(node: React.ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const cat = (id: string, name: string): BuilderCategory =>
  ({ id, name, description: "", tags: [], productIds: [], source: "manual", sourceRef: null, quizId: "q" }) as BuilderCategory;
const CATS = [cat("cat1", "Dry kit"), cat("cat2", "Oily kit"), cat("cat3", "Both kit"), cat("catX", "Extra")];
const catById = new Map(CATS.map((c) => [c.id, c]));
// (named, so the react/style-prop-object lint does not read the prop as CSS)
const RULES_ONLY = "rules" as const;
const FILTER = "attributes" as const;

function doc3(): Quiz {
  return logicDoc({
    logic_style: "rules",
    rules: [
      rule("r1", [["q1", "a1"], ["q3", "m1"], ["q3", "m2"]], "cat1", { action: "show", any_of: ["q3"] }),
      rule("r2", [["q1", "a2"]], "cat2", { action: "show" }),
      rule("r3", [["q1", "a2"], ["q2", "b1", "is_not"], ["q2", "b2", "is_not"]], "cat2", { action: "show" }),
    ],
  });
}

describe("rule sentence (D17)", () => {
  it("reads verb-first, answers-only, grouped with bold joins", () => {
    const d = doc3();
    const t = describeRuleTokens(d.decision_rules![0]!, d, "rules");
    expect(ruleSentenceText(t, catById)).toBe("Show Dry kit when Dry and (Cheeks or Nose)");
    const t3 = describeRuleTokens(d.decision_rules![2]!, d, "rules");
    expect(ruleSentenceText(t3, catById)).toBe("Show Oily kit when Oily and not (Short or Long)");
  });

  it("renders the chips and the tag of a rule that never runs", () => {
    const d = doc3();
    const el = render(
      createElement(RulesList, {
        variant: "row",
        doc: d,
        style: RULES_ONLY,
        catById,
        statuses: ruleStatuses(d, CATS.map((c) => c.id)),
        getLatestDoc: () => d,
      }),
    );
    const rows = el.querySelectorAll("li.qz-lg-rr");
    expect(rows.length).toBe(3);
    expect(rows[0]!.querySelector(".qz-lg-cchip.is-v")?.textContent).toBe("Show");
    expect(rows[0]!.querySelector(".qz-lg-cchip.is-res")?.textContent).toBe("Dry kit");
    expect(rows[0]!.querySelectorAll(".qz-lg-cj")[0]?.textContent).toBe("and");
    expect(rows[2]!.className).toContain("is-dead");
    expect(rows[2]!.querySelector(".qz-lg-rtag")?.textContent).toBe("never runs · rule 2 catches them first");
    // Read-only host: no arrows, no trash.
    expect(el.querySelectorAll(".qz-lg-xone").length).toBe(0);
    expect(el.querySelector("ol")?.getAttribute("aria-label")).toBe("Rules, run top to bottom");
  });
});

describe("row tags (D19)", () => {
  it("a stored Hide in Rules only says it shows nothing", () => {
    expect(ruleTags({ action: "hide" }, undefined, "rules")).toEqual(["shows nothing · this rule hides"]);
    expect(ruleTags({ action: "hide" }, undefined, "attributes")).toEqual([]);
  });
});

describe("delete and move (D7 inverse mutations)", () => {
  it("delete commits the removal and pushes an Undo that restores at the original index", () => {
    const d = doc3();
    let latest = d;
    const commit = vi.fn((next: Quiz) => {
      latest = next;
    });
    const push = vi.fn();
    const undo: RulesUndo = { push, isLive: () => false };
    const el = render(
      createElement(RulesList, {
        variant: "row",
        doc: d,
        style: RULES_ONLY,
        catById,
        statuses: ruleStatuses(d),
        commit,
        getLatestDoc: () => latest,
        undo,
      }),
    );
    act(() => {
      (el.querySelectorAll(".qz-lg-xdel")[1] as HTMLButtonElement).click();
    });
    expect(latest.decision_rules!.map((r) => r.id)).toEqual(["r1", "r3"]);
    const p = push.mock.calls[0]![0];
    expect(p.message).toBe("Rule 2 deleted");
    expect(p.isDelete).toBe(true);
    // An unrelated edit made while the toast is up survives the Undo.
    const edited = { ...latest, decision_rules: [...latest.decision_rules!, rule("r9", [["q1", "a3"]], "cat3")] };
    expect(p.inverse(edited).decision_rules!.map((r: { id: string }) => r.id)).toEqual(["r1", "r2", "r3", "r9"]);
  });

  it("↓ moves the rule and its Undo moves it back", () => {
    const d = doc3();
    let latest = d;
    const push = vi.fn();
    const el = render(
      createElement(RulesList, {
        variant: "column",
        doc: d,
        style: FILTER,
        catById,
        statuses: ruleStatuses(d),
        commit: (next: Quiz) => {
          latest = next;
        },
        getLatestDoc: () => latest,
        undo: { push, isLive: () => false },
      }),
    );
    act(() => {
      (el.querySelector('[data-rule-id="r1"] [data-move="down"]') as HTMLButtonElement).click();
    });
    expect(latest.decision_rules!.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
    const p = push.mock.calls[0]![0];
    expect(p.message).toBe("Rule 1 moved to position 2");
    expect(p.inverse(latest).decision_rules!.map((r: { id: string }) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});

describe("recommendations strip (D14, B10, B49)", () => {
  it("counts only rules that can show, sorts uncovered first, labels both kinds", () => {
    const d = doc3();
    const el = render(
      createElement(RecommendationsStrip, {
        doc: d,
        style: RULES_ONLY,
        recommendations: CATS.slice(0, 3),
        statuses: ruleStatuses(d, CATS.map((c) => c.id)),
        onCreateFor: () => {},
      }),
    );
    expect(el.querySelector(".qz-lg-viz-sub")?.textContent).toBe("2/3 have a rule");
    const pills = Array.from(el.querySelectorAll("[data-rec-id]"));
    expect(pills.map((p) => p.getAttribute("data-rec-id"))).toEqual(["cat3", "cat1", "cat2"]);
    expect(pills[0]!.tagName).toBe("BUTTON");
    expect(pills[0]!.getAttribute("aria-label")).toBe("Create a rule for Both kit");
    expect(pills[2]!.getAttribute("aria-label")).toBe("Oily kit · used by rules 2 and 3");
  });
});

describe("copy helpers", () => {
  it("joinNumbers reads like the mock's nlist", () => {
    expect(joinNumbers([2])).toBe("2");
    expect(joinNumbers([1, 3])).toBe("1 and 3");
    expect(joinNumbers([1, 2, 4])).toBe("1, 2 and 4");
  });
});
