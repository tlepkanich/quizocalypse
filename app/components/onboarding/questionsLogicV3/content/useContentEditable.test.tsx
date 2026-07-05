// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { EditableText } from "./EditableText";

/* QL3-P2 — the caret-safety contract of useContentEditable (via EditableText,
   the real wiring): UNCONTROLLED-WHILE-FOCUSED means the layout effect writes
   el.textContent ONLY when the element is not focused — so a value-prop echo
   arriving mid-typing (every input event commits → re-render) can never move
   the caret. Real caret/selection geometry needs a browser (jsdom has no
   caret), so THAT half is covered by the live probe (type mid-string on the
   deploy build); here we pin the DOM-rewrite invariant + the commit cadence
   (input / blur-trim / maxLength truncation / Enter-blur / IME deferral). */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}

function rerender(el: React.ReactElement) {
  act(() => root!.render(el));
}

function span(): HTMLElement {
  return document.body.querySelector(".qz-s3-editable") as HTMLElement;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

const base = (over: Partial<Parameters<typeof EditableText>[0]> = {}) =>
  createElement(EditableText, {
    value: "Hello",
    onCommit: () => {},
    ariaLabel: "test field",
    ...over,
  });

describe("useContentEditable — uncontrolled-while-focused", () => {
  it("writes the value into the DOM on mount (layout-effect initial fill)", () => {
    mount(base());
    expect(span().textContent).toBe("Hello");
  });

  it("NEVER rewrites the DOM while the element is focused (the caret-safety invariant)", () => {
    mount(base());
    const el = span();
    act(() => el.focus());
    expect(document.activeElement).toBe(el);
    // The user has typed; the DOM is ahead of the prop.
    el.textContent = "Hello, wor";
    // A value echo lands mid-typing (the commit → doc → prop round-trip).
    rerender(base({ value: "Hello, wor" }));
    expect(span().textContent).toBe("Hello, wor");
    // Even a DIVERGENT prop (e.g. a stale echo) must not clobber the focused DOM.
    rerender(base({ value: "Hello" }));
    expect(span().textContent).toBe("Hello, wor");
  });

  it("rewrites the DOM from the prop once the element is NOT focused", () => {
    mount(base());
    const el = span();
    act(() => el.focus());
    el.textContent = "scratch";
    act(() => el.blur());
    rerender(base({ value: "Fresh value" }));
    expect(span().textContent).toBe("Fresh value");
  });

  it("commits on EVERY input event with the current text", () => {
    const onCommit = vi.fn();
    mount(base({ onCommit }));
    const el = span();
    act(() => el.focus());
    el.textContent = "Hello!";
    act(() => el.dispatchEvent(new Event("input", { bubbles: true })));
    expect(onCommit).toHaveBeenCalledWith("Hello!");
  });

  it("skips no-op commits (focus/blur without an edit never dirties the doc)", () => {
    const onCommit = vi.fn();
    mount(base({ onCommit }));
    const el = span();
    act(() => el.focus());
    act(() => el.dispatchEvent(new Event("input", { bubbles: true })));
    act(() => el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("enforces maxLength by truncation on commit", () => {
    const onCommit = vi.fn();
    mount(base({ onCommit, maxLength: 5 }));
    const el = span();
    act(() => el.focus());
    el.textContent = "1234567890";
    act(() => el.dispatchEvent(new Event("input", { bubbles: true })));
    expect(onCommit).toHaveBeenCalledWith("12345");
  });

  it("blur does a final trim-commit", () => {
    const onCommit = vi.fn();
    mount(base({ onCommit }));
    const el = span();
    act(() => el.focus());
    el.textContent = "  padded  ";
    act(() => el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
    expect(onCommit).toHaveBeenCalledWith("padded");
  });

  it("Enter is prevented and blurs (single-line semantics)", () => {
    mount(base());
    const el = span();
    act(() => el.focus());
    const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    act(() => el.dispatchEvent(evt));
    expect(evt.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(el);
  });

  it("IME composition defers the commit to compositionend", () => {
    const onCommit = vi.fn();
    mount(base({ onCommit }));
    const el = span();
    act(() => el.focus());
    act(() => el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    el.textContent = "こん";
    act(() => el.dispatchEvent(new Event("input", { bubbles: true })));
    expect(onCommit).not.toHaveBeenCalled(); // mid-composition input is deferred
    act(() => el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    expect(onCommit).toHaveBeenCalledWith("こん");
  });
});
