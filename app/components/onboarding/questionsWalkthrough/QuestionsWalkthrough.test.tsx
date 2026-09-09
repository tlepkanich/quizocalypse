// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Quiz } from "../../../lib/quizSchema";
import { QuestionsWalkthrough } from "./QuestionsWalkthrough";
import { EmailScreen } from "./EmailScreen";
import { walkSteps } from "./walkModel";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
const fixture = () =>
  Quiz.parse({
    quiz_id: "walk",
    logic_model: "decider",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Welcome" },
      },
      {
        id: "q1",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "First question",
          question_type: "single_select",
          answers: [
            { id: "a", text: "Alpha", edge_handle_id: "a", tags: [] },
            { id: "b", text: "Beta", edge_handle_id: "b", tags: [] },
          ],
        },
      },
      {
        id: "m",
        type: "message",
        position: { x: 0, y: 0 },
        data: { text: "A useful pause" },
      },
      {
        id: "q2",
        type: "question",
        position: { x: 0, y: 0 },
        data: {
          text: "Second question",
          question_type: "single_select",
          answers: [
            { id: "c", text: "Gamma", edge_handle_id: "c", tags: [] },
            { id: "d", text: "Delta", edge_handle_id: "d", tags: [] },
          ],
        },
      },
      {
        id: "end",
        type: "end",
        position: { x: 0, y: 0 },
        data: { headline: "Done" },
      },
    ],
    edges: [
      { id: "1", source: "intro", target: "q1" },
      { id: "2", source: "q1", target: "m" },
      { id: "3", source: "m", target: "q2" },
      { id: "4", source: "q2", target: "end" },
    ],
  });
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});
function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(el));
}
function click(label: string) {
  const button = Array.from(
    (
      document.querySelector('[role="alertdialog"]') ??
      document.querySelector('[role="dialog"]') ??
      document
    ).querySelectorAll("button"),
  ).find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  act(() => button.click());
}
const regen = {
  regeneratingId: null,
  undoNodeId: null,
  regenError: null,
  onRegenerate: vi.fn(),
  onUndoRegenerate: vi.fn(),
  onDismissRegenError: vi.fn(),
};
function walk(commit = vi.fn(), onContinue = vi.fn()) {
  mount(
    createElement(QuestionsWalkthrough, {
      doc: fixture(),
      commit,
      onContinue,
      isSaving: false,
      savedAt: null,
      saveError: null,
      onRetry: vi.fn(),
      navigating: false,
      regen,
    }),
  );
  return { commit, onContinue };
}
describe("Questions walkthrough", () => {
  it("numbers questions only and excludes the graph intro", () => {
    expect(walkSteps(fixture()).map((s) => [s.node.id, s.qIndex])).toEqual([
      ["q1", 1],
      ["m", undefined],
      ["q2", 2],
    ]);
  });
  it("opens an early read-only overview without writing quiz state", () => {
    const { commit } = walk();
    click("Start →");
    click("Overview");
    expect(
      document.querySelector('[data-mode="read"] [role="textbox"]'),
    ).toBeNull();
    expect(document.querySelector('[data-mode="read"] button')).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
  it("review navigation never writes the session coverage to the document", () => {
    const { commit, onContinue } = walk();
    click("Start →");
    click("Question 2");
    click("Next ›");
    expect(document.querySelector(".qz-walk-email-title")?.textContent).toBe(
      "Email capture",
    );
    click("Finish ›");
    click("Continue →");
    expect(document.body.textContent).toContain(
      "Some screens are still unread",
    );
    expect(onContinue).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    click("Continue anyway");
    expect(onContinue).toHaveBeenCalledOnce();
  });
  it("two-answer deletion is disabled and question deletion requires a confirm", () => {
    const { commit } = walk();
    click("Start →");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[aria-label="Delete answer 1"]',
      )?.disabled,
    ).toBe(true);
    click("Delete question");
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
    click("Cancel");
    expect(commit).not.toHaveBeenCalled();
  });
  it("enables regeneration only after confirmation", () => {
    regen.onRegenerate.mockClear();
    walk();
    click("Start →");
    click("↻ Regenerate");
    expect(regen.onRegenerate).not.toHaveBeenCalled();
    click("Regenerate");
    expect(regen.onRegenerate).toHaveBeenCalledWith("q1");
  });
  it("email option writes are sparse and disabling email warns before losing SMS", () => {
    const commits: Quiz[] = [];
    function Harness() {
      const [doc, setDoc] = useState(fixture());
      return (
        <EmailScreen
          doc={doc}
          commit={(next) => {
            commits.push(next);
            setDoc(next);
          }}
        />
      );
    }
    mount(<Harness />);
    const terms = Array.from(document.querySelectorAll("label"))
      .find((l) => l.textContent === "Terms and conditions")
      ?.querySelector("input");
    act(() => terms?.click());
    expect(commits.at(-1)?.rec_page_settings?.global).toEqual({
      captureTermsOn: true,
      captureTermsMode: "checkbox",
    });
    const phone = Array.from(document.querySelectorAll("label"))
      .find((l) => l.textContent === "Collect a phone number for SMS")
      ?.querySelector("input");
    act(() => phone?.click());
    const count = commits.length;
    click("Don’t collect");
    expect(commits).toHaveLength(count);
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    click("Don’t collect");
    expect(commits.at(-1)?.rec_page_settings?.global.captureEmail).toBe(false);
    expect(
      commits.at(-1)?.rec_page_settings?.global.capturePhone,
    ).toBeUndefined();
  });
});
