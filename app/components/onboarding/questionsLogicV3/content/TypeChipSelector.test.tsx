// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { TypeChipSelector } from "./TypeChipSelector";
import { Quiz } from "../../../../lib/quizSchema";
import type { QuestionNode } from "../../../../lib/questionOrder";

/* BIC-2 D3 + QZY-3 — the type chip after the owner supplement:
   — the picker is CURATED (Single select · Multi-select · Five-point scale ·
     Rating; the current stored type stays listed) — freeform picks are gone;
   — decider + multi-select → BLOCK dialog, onCommit NEVER called;
   — card ↔ card commits DIRECTLY and KEEPS the original answers, mappings,
     and per-answer routing (nothing resets anymore);
   — Five-point scale = the rating type + a 1–5 scale preset. */

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

// The fixture goes through Quiz.parse (never a hand-shaped literal). q1 is a
// qualifier with a per-answer skip edge off handle h1; q2 is the decider.
const doc = () =>
  Quiz.parse({
    quiz_id: "qz1",
    scope: { collection_ids: [] },
    logic_model: "decider",
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
      {
        id: "r1",
        type: "result",
        position: { x: 0, y: 0 },
        data: { headline: "Match", fallback_collection_id: "c1" },
      },
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      // The per-answer skip edge setQuestionType must prune on a type change.
      { id: "e4", source: "q1", source_handle: "h1", target: "r1" },
      { id: "e3", source: "q2", target: "r1" },
    ],
  });

function questionNode(d: Quiz, id: string): QuestionNode {
  const node = d.nodes.find((n) => n.id === id);
  if (!node || node.type !== "question") throw new Error(`fixture: ${id} is not a question`);
  return node;
}

function typeSelect(): HTMLSelectElement {
  const el = document.body.querySelector('select[aria-label="Question type"]');
  if (!(el instanceof HTMLSelectElement)) throw new Error("type select not rendered");
  return el;
}

function pickType(value: string) {
  const el = typeSelect();
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  desc?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

describe("TypeChipSelector — decider BLOCK dialog", () => {
  it("decider → multi-select is REFUSED: block dialog opens, onCommit is never called", () => {
    const d = doc();
    const onCommit = vi.fn();
    mount(createElement(TypeChipSelector, { doc: d, node: questionNode(d, "q2"), onCommit }));

    pickType("multi_select");
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Multi-select can't decide the result");
    expect(onCommit).not.toHaveBeenCalled();

    act(() => buttonByText("Got it").click());
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled(); // doc untouched end to end
  });

  it("QZY-3 — the picker is curated: no freeform picks offered", () => {
    const d = doc();
    mount(createElement(TypeChipSelector, { doc: d, node: questionNode(d, "q2"), onCommit: vi.fn() }));
    const values = Array.from(typeSelect().options).map((o) => o.value);
    expect(values).toEqual(["single_select", "multi_select", "rating5", "rating"]);
  });

  it("decider → Five-point scale commits DIRECTLY, keeps the role + answers, sets the 1–5 preset", () => {
    const d = doc();
    const onCommit = vi.fn();
    mount(createElement(TypeChipSelector, { doc: d, node: questionNode(d, "q2"), onCommit }));

    pickType("rating5");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull(); // no dialog — nothing resets
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    const q2 = questionNode(committed, "q2");
    expect(q2.data.question_type).toBe("rating");
    expect(q2.data.scale_config).toMatchObject({ min: 1, max: 5 });
    expect(q2.data.role).toBe("decides"); // no silent demotion on a decidable type
    expect(q2.data.answers.map((a) => a.id)).toEqual(["park", "powder"]); // answers KEPT
  });
});

describe("TypeChipSelector — QZY-3 card ↔ card keeps everything (no dialog)", () => {
  it("qualifier → multi-select commits directly: answers, text, and the skip edge all survive", () => {
    const d = doc();
    const onCommit = vi.fn();
    mount(createElement(TypeChipSelector, { doc: d, node: questionNode(d, "q1"), onCommit }));

    pickType("multi_select");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]![0] as Quiz;
    const q1 = questionNode(committed, "q1");
    expect(q1.data.question_type).toBe("multi_select");
    expect(q1.data.text).toBe("Level?"); // question text preserved
    // The owner-reported bug: answers used to reset to placeholders.
    expect(q1.data.answers.map((a) => a.text)).toEqual(["Beginner", "Advanced"]);
    // The per-answer skip edge SURVIVES a card→card type change now.
    expect(committed.edges.some((e) => e.source === "q1" && e.source_handle === "h1")).toBe(true);
    expect(committed.edges.some((e) => e.id === "e2")).toBe(true);
  });
});
