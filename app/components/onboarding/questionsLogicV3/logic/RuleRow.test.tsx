// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { RuleRow } from "./RuleRow";
import { Quiz } from "../../../../lib/quizSchema";
import type { BuilderCategory } from "../../../builder/stepProps";
import type { OrderedQuestion } from "../../questionsLogic/questionOrder";

/* BIC-2 D3 — the distributed rule row (quiz-step3 v3 §5.5): collapsed shows
   the summary and only toggles; expanded edits write the updateDecisionRule
   commit shape (whole conditions array / target patch); delete sits behind a
   window.confirm gate. */

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
  vi.restoreAllMocks();
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

const doc = () =>
  Quiz.parse({
    quiz_id: "qz1",
    scope: { collection_ids: [] },
    logic_model: "decider",
    decision_rules: [
      {
        id: "rule1",
        conditions: [{ question_id: "q1", answer_id: "beginner", op: "is" }],
        target_id: "cat_park",
      },
    ],
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Level?",
          question_type: "single_select",
          role: "qualifier",
          answers: [
            { id: "beginner", text: "Beginner", tags: [], edge_handle_id: "h1" },
            { id: "advanced", text: "Advanced", tags: [], edge_handle_id: "h2" },
          ],
        },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Terrain?",
          question_type: "single_select",
          role: "decides",
          answers: [
            { id: "park", text: "Park", tags: [], edge_handle_id: "h3", target_id: "cat_park" },
            { id: "powder", text: "Powder", tags: [], edge_handle_id: "h4", target_id: "cat_powder" },
          ],
        },
      },
      { id: "r1", type: "result", position: { x: 0, y: 0 }, data: { headline: "Match", fallback_collection_id: "c1" } },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "r1" },
    ],
  });

const CATS: BuilderCategory[] = [
  { id: "cat_park", name: "Park gear", description: "", tags: [], productIds: [], source: "collection", sourceRef: "c1", quizId: "db1" },
  { id: "cat_powder", name: "Powder gear", description: "", tags: [], productIds: [], source: "collection", sourceRef: "c2", quizId: "db1" },
];

function ordered(d: Quiz): OrderedQuestion[] {
  return d.nodes
    .filter((n): n is Extract<Quiz["nodes"][number], { type: "question" }> => n.type === "question")
    .map((node, i) => ({ node, qIndex: i + 1 }));
}

function row(
  d: Quiz,
  over: Partial<Parameters<typeof RuleRow>[0]> = {},
) {
  const rule = d.decision_rules?.[0];
  if (!rule) throw new Error("fixture: no rule");
  const qs = ordered(d);
  return createElement(RuleRow, {
    doc: d,
    rule,
    no: 1,
    total: 1,
    questions: qs,
    conditionQuestions: qs,
    categories: CATS,
    expanded: false,
    flash: false,
    onToggle: () => {},
    onCommit: () => {},
    registerEl: () => {},
    ...over,
  });
}

function selectByAria(label: string): HTMLSelectElement {
  const el = document.body.querySelector(`select[aria-label="${label}"]`);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`no select "${label}"`);
  return el;
}

function changeSelect(el: HTMLSelectElement, value: string) {
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  desc?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("RuleRow", () => {
  it("collapsed: summary head only (no editor), aria-expanded false, click toggles", () => {
    const onToggle = vi.fn();
    mount(row(doc(), { onToggle }));
    const head = document.body.querySelector("button.qz-s3-rr-head");
    if (!(head instanceof HTMLButtonElement)) throw new Error("rule head missing");
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(head.textContent).toContain("R1");
    expect(document.body.querySelector('select[aria-label="Rule 1 result target"]')).toBeNull();
    act(() => head.click());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("expanded: retargeting commits the updateDecisionRule shape (target only, conditions kept)", () => {
    const d = doc();
    const onCommit = vi.fn();
    mount(row(d, { expanded: true, onCommit }));

    changeSelect(selectByAria("Rule 1 result target"), "cat_powder");

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.decision_rules?.[0]?.target_id).toBe("cat_powder");
    expect(committed.decision_rules?.[0]?.conditions).toEqual([
      { question_id: "q1", answer_id: "beginner", op: "is" },
    ]);
  });

  it("expanded: flipping the operator commits the whole rebuilt conditions array", () => {
    const d = doc();
    const onCommit = vi.fn();
    mount(row(d, { expanded: true, onCommit }));

    changeSelect(selectByAria("Condition operator"), "is_not");

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.decision_rules?.[0]?.conditions).toEqual([
      { question_id: "q1", answer_id: "beginner", op: "is_not" },
    ]);
    expect(committed.decision_rules?.[0]?.target_id).toBe("cat_park"); // untouched
  });

  it("delete is confirm-gated: declined → no commit; accepted → the rule is removed", () => {
    const d = doc();
    const onCommit = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    mount(row(d, { expanded: true, onCommit }));

    const del = document.body.querySelector('button[aria-label="Delete rule 1"]');
    if (!(del instanceof HTMLButtonElement)) throw new Error("delete button missing");

    act(() => del.click());
    expect(onCommit).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    act(() => del.click());
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    expect(committed.decision_rules).toEqual([]);
  });

  it("priority arrows are disabled at the edges of a single-rule doc", () => {
    mount(row(doc(), { expanded: true }));
    const up = document.body.querySelector('button[aria-label="Raise rule 1 priority"]');
    const down = document.body.querySelector('button[aria-label="Lower rule 1 priority"]');
    expect(up instanceof HTMLButtonElement && up.disabled).toBe(true);
    expect(down instanceof HTMLButtonElement && down.disabled).toBe(true);
  });
});
