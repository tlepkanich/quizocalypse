// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { RulesStrip } from "./RulesStrip";
import { Quiz } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";

/* BIC-2 D3 — the sticky rules strip (quiz-step3 v3 §5.5): one clickable
   summary line per rule (click = jump home), an honest empty state, and the
   homeless bucket ("Unfinished rules") rendering a FULL editable RuleRow so a
   zero-condition rule can still be fixed from here. */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

const doc = (rules: unknown[]) =>
  Quiz.parse({
    quiz_id: "qz1",
    scope: { collection_ids: [] },
    logic_model: "decider",
    decision_rules: rules,
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Level?",
          question_type: "single_select",
          role: "decides",
          answers: [
            { id: "beginner", text: "Beginner", tags: [], edge_handle_id: "h1", target_id: "cat_park" },
            { id: "advanced", text: "Advanced", tags: [], edge_handle_id: "h2", target_id: "cat_powder" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "Match", fallback_collection_id: "c1" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "r1" },
    ],
  });

const RULE_1 = {
  id: "rule1",
  conditions: [{ question_id: "q1", answer_id: "beginner", op: "is" }],
  target_id: "cat_park",
};
const RULE_2 = {
  id: "rule2",
  conditions: [{ question_id: "q1", answer_id: "advanced", op: "is" }],
  target_id: "cat_powder",
};
const RULE_EMPTY = { id: "rule1", conditions: [], target_id: "cat_park" };

const CATS: BuilderCategory[] = [
  { id: "cat_park", name: "Park gear", description: "", tags: [], productIds: [], source: "collection", sourceRef: "c1", quizId: "db1" },
  { id: "cat_powder", name: "Powder gear", description: "", tags: [], productIds: [], source: "collection", sourceRef: "c2", quizId: "db1" },
];

function ordered(d: Quiz): OrderedQuestion[] {
  return d.nodes
    .filter((n): n is Extract<Quiz["nodes"][number], { type: "question" }> => n.type === "question")
    .map((node, i) => ({ node, qIndex: i + 1 }));
}

function strip(d: Quiz, over: Partial<Parameters<typeof RulesStrip>[0]> = {}) {
  const qs = ordered(d);
  return createElement(RulesStrip, {
    doc: d,
    rules: d.decision_rules ?? [],
    homeless: [],
    questions: qs,
    conditionQuestions: qs,
    categories: CATS,
    expandedRuleId: null,
    flashRuleId: null,
    onRuleClick: () => {},
    onToggleRule: () => {},
    onCommit: () => {},
    registerRuleEl: () => {},
    ...over,
  });
}

describe("RulesStrip", () => {
  it("lists every rule as a clickable jump line in priority order", () => {
    const onRuleClick = vi.fn();
    mount(strip(doc([RULE_1, RULE_2]), { onRuleClick }));

    expect(document.body.textContent).toContain("2 RULES");
    const lines = Array.from(document.body.querySelectorAll("button.qz-s3-ruleline"));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toContain("R1");
    expect(lines[1]!.textContent).toContain("R2");

    act(() => (lines[1] as HTMLButtonElement).click());
    expect(onRuleClick).toHaveBeenCalledTimes(1);
    expect(onRuleClick).toHaveBeenCalledWith("rule2");
  });

  it("zero rules → the empty state, no jump lines", () => {
    mount(strip(doc([])));
    expect(document.body.textContent).toContain("No rules yet");
    expect(document.body.querySelector("button.qz-s3-ruleline")).toBeNull();
  });

  it("a homeless (zero-condition) rule stays EDITABLE from the Unfinished bucket", () => {
    const d = doc([RULE_EMPTY]);
    const onCommit = vi.fn();
    mount(
      strip(d, {
        homeless: [{ ruleId: "rule1", no: 1 }],
        expandedRuleId: "rule1",
        onCommit,
      }),
    );

    expect(document.body.textContent).toContain("Unfinished rules");
    // The full RuleRow renders here — retarget it to prove it is live.
    const target = document.body.querySelector('select[aria-label="Rule 1 result target"]');
    if (!(target instanceof HTMLSelectElement)) throw new Error("homeless rule not editable");
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    desc?.set?.call(target, "cat_powder");
    act(() => {
      target.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.decision_rules?.[0]?.target_id).toBe("cat_powder");
  });
});
