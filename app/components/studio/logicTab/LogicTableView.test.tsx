// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Quiz } from "../../../lib/quizSchema";
import type { BuilderCategory } from "../../builder/stepProps";
import { logicDoc, rule } from "../../../lib/logicStep.fixtures";
import { orderedQuestions } from "../../../lib/questionOrder";
import { ruleStatuses } from "../../../lib/ruleStatus";
import { exportWorkbook } from "../../../lib/logicSheets";
import { LogicTableView, type LogicTableViewProps } from "./LogicTableView";
import type { RulesUndo } from "./RulesList";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Logic step redesign — the Table view renders the SAME rows the export
// writes (D16), rules first in both styles, with real buttons for the row
// actions (B48) and the card's Undo for a delete (D7).

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
  ({ id, name, description: "", tags: [], productIds: ["p1", "p2"], source: "manual", sourceRef: null, quizId: "q" }) as BuilderCategory;
const CATS = [cat("cat1", "Dry kit"), cat("cat2", "Oily kit"), cat("cat3", "Both kit"), cat("catX", "Extra")];
const RULES_ONLY = "rules" as const;
const FILTER = "attributes" as const;

function docWith(): Quiz {
  return logicDoc({
    rules: [
      rule("r1", [["q1", "a1"], ["q3", "m1"], ["q3", "m2"]], "cat1", { action: "show", any_of: ["q3"] }),
      rule("r2", [["q1", "a1"]], "cat2", { action: "show" }),
      rule("r3", [["q2", "b1", "is_not"], ["q2", "b2", "is_not"]], "cat2", { action: "prioritize" }),
    ],
  });
}

function props(doc: Quiz, style: "rules" | "attributes", extra: Partial<LogicTableViewProps> = {}): LogicTableViewProps {
  return {
    doc,
    style,
    questions: orderedQuestions(doc),
    categories: CATS,
    recommendations: CATS,
    statuses: ruleStatuses(doc, CATS.map((c) => c.id)),
    getLatestDoc: () => doc,
    ...extra,
  };
}

const textRows = (table: Element) =>
  Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
    Array.from(tr.querySelectorAll("td")).map((td) => td.textContent ?? ""),
  );

describe("LogicTableView", () => {
  it("Filter Results + Rules: Rules then Answers, the same cells the file writes", () => {
    const d = docWith();
    const el = render(createElement(LogicTableView, props(d, FILTER)));
    const tables = el.querySelectorAll("table");
    expect(Array.from(tables).map((t) => t.getAttribute("aria-label"))).toEqual(["Rules", "Answers"]);
    const file = exportWorkbook(d, { style: FILTER, categories: CATS, recommendations: CATS }).workbook;
    const fileRules = file.sheets[0]!.rows.slice(1);
    textRows(tables[0]!).forEach((cells, i) => {
      expect(cells[0]).toBe(String(fileRules[i]![0]));
      expect(cells[1]).toBe(fileRules[i]![1]);
      expect(cells[3]!.startsWith(String(fileRules[i]![3]))).toBe(true);
    });
    // Bold joins; the shadowed rule carries its tag at full contrast.
    expect(tables[0]!.querySelectorAll("b.qz-lg-cj").length).toBeGreaterThan(0);
    const r2 = tables[0]!.querySelector('[data-rule-id="r2"]')!;
    expect(r2.classList.contains("is-muted")).toBe(false);
    // The Answers sheet: question-level cells on the first row only.
    const ans = textRows(tables[1]!);
    expect(ans[0]!.slice(0, 3)).toEqual(["Q1", "Skin feel", "Single select"]);
    expect(ans[1]![0]).toBe("");
    expect(ans.at(-1)![6]).toBe("Straight to results");
  });

  it("Rules only: Rules then Recommendations; a Needs a rule row opens Create a rule", () => {
    const d = docWith();
    const onCreateFor = vi.fn();
    const el = render(createElement(LogicTableView, props(d, RULES_ONLY, { onCreateFor })));
    const tables = el.querySelectorAll("table");
    expect(Array.from(tables).map((t) => t.getAttribute("aria-label"))).toEqual(["Rules", "Recommendations"]);
    const recs = textRows(tables[1]!);
    expect(recs[0]).toEqual(["Dry kit", "2", "1", "Has a rule"]);
    expect(recs[2]![3]).toBe("Needs a rule");
    const btn = tables[1]!.querySelector<HTMLButtonElement>('button[aria-label="Create a rule for Both kit"]')!;
    act(() => btn.click());
    expect(onCreateFor).toHaveBeenCalledWith("cat3");
    // Every verb reads Show in Rules only.
    expect(textRows(tables[0]!).map((r) => r[1])).toEqual(["Show", "Show", "Show"]);
  });

  it("an empty Rules sheet reads Nothing yet", () => {
    const d = logicDoc({ rules: [] });
    const el = render(createElement(LogicTableView, props(d, RULES_ONLY)));
    expect(textRows(el.querySelector("table")!)).toEqual([["Nothing yet"]]);
  });

  it("the # button edits by rule id; the trash deletes with the card's Undo", () => {
    let current = docWith();
    const commit = vi.fn((d: Quiz) => {
      current = d;
    });
    const pushes: Array<Parameters<RulesUndo["push"]>[0]> = [];
    const undo: RulesUndo = { push: (p) => pushes.push(p), isLive: () => pushes.length > 0 };
    const onEditRule = vi.fn();
    const el = render(
      createElement(
        LogicTableView,
        props(current, FILTER, { commit, getLatestDoc: () => current, undo, onEditRule }),
      ),
    );
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Edit rule 2"]')!.click());
    expect(onEditRule).toHaveBeenCalledWith("r2");
    // A row click opens the same rule; the trash does not.
    act(() => el.querySelector<HTMLButtonElement>('button[aria-label="Delete rule 1"]')!.click());
    expect(onEditRule).toHaveBeenCalledTimes(1);
    expect(current.decision_rules!.map((r) => r.id)).toEqual(["r2", "r3"]);
    expect(pushes[0]!.message).toBe("Rule 1 deleted");
    const restored = pushes[0]!.inverse(current);
    expect(restored.decision_rules!.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});
