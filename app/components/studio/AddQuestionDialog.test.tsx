// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AddQuestionDialog } from "./AddQuestionDialog";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function mount(onSubmit = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AddQuestionDialog, { nextNumber: 6, onSubmit, onClose: vi.fn() })));
  return onSubmit;
}
const setValue = (el: HTMLInputElement, v: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const answers = () => [...document.body.querySelectorAll<HTMLInputElement>('input[aria-label^="Answer "]')];

describe("AddQuestionDialog (handoff 'Add a question')", () => {
  it("the hint counts FILLED answers (B55) and the footer names the next number", () => {
    mount();
    const hint = () => document.body.querySelector('[data-testid="adq-hint"]')?.textContent;
    expect(hint()).toBe("0 of 2 needed");
    setValue(answers()[0]!, "One");
    expect(hint()).toBe("1 of 2 needed");
    setValue(answers()[1]!, "Two");
    expect(hint()).toBe("2 answers");
    expect(document.body.textContent).toContain("Adds Q6 with 2 answers");
  });

  it("caps the rows at 12 and says so (B58); keys continue past Z", () => {
    mount();
    for (let i = 0; i < 20; i++) {
      const add = button("+ Add answer");
      if (!add) break;
      act(() => add.click());
    }
    expect(answers()).toHaveLength(12);
    expect(document.body.textContent).toContain("12 answers is the most a question can have.");
  });

  it("Five-point sends 1–5 and the 1–5 preset", () => {
    const onSubmit = mount();
    act(() => button("Five-point scalethey rate from 1 to 5")?.click());
    const five = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Five-point scale"),
    )!;
    act(() => five.click());
    setValue(document.body.querySelector<HTMLInputElement>('input[aria-label="Question"]')!, "Rate it");
    act(() => button("Add question").click());
    expect(onSubmit).toHaveBeenCalledWith({
      text: "Rate it",
      question_type: "rating",
      answers: ["1", "2", "3", "4", "5"],
      scale_config: { min: 1, max: 5 },
    });
  });

  it("arrow keys on the grip reorder the rows", () => {
    mount();
    setValue(answers()[0]!, "One");
    setValue(answers()[1]!, "Two");
    const grip = document.body.querySelector<HTMLButtonElement>(".qz-lm-agrip")!;
    act(() => {
      grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    expect(answers().map((a) => a.value)).toEqual(["Two", "One"]);
  });
});
