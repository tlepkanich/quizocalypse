// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { createSaveTracker } from "../saveTracker";
import { placeSavePill } from "./FieldSavePill";
import { InlineText, normalizeInlineText, type InlineTextProps } from "./InlineText";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(props: Partial<InlineTextProps> & { value: string }) {
  const full: InlineTextProps = { maxLength: 60, ariaLabel: "Question 1, answer A", ...props };
  act(() =>
    root!.render(
      createElement("div", null, createElement(InlineText, full), createElement("button", { id: "after" }, "Next")),
    ),
  );
  return document.body.querySelector<HTMLElement>(".qz-ed");
}

beforeEach(() => {
  // jsdom lays nothing out; give elements one client rect so "is this control
  // visible" (the next-control search) behaves as in a browser.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function focus(el: HTMLElement) {
  act(() => el.focus());
}
function type(el: HTMLElement, text: string) {
  act(() => {
    el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function key(el: HTMLElement, k: string, extra: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra });
  act(() => void el.dispatchEvent(e));
  return e;
}

describe("normalizeInlineText", () => {
  it("collapses whitespace runs (line breaks, NBSP), trims, clamps whole code points", () => {
    expect(normalizeInlineText("  a\n\tb  c  ", 60)).toBe("a b c");
    expect(normalizeInlineText("ab😀", 3)).toBe("ab");
    expect(normalizeInlineText("abc def", 4)).toBe("abc");
  });
});

describe("InlineText", () => {
  it("renders plain text (no editor) without onCommit", () => {
    mount({ value: "Yes" });
    expect(document.body.querySelector(".qz-ed")).toBeNull();
    expect(document.body.textContent).toContain("Yes");
  });

  it("shows the value as text, never markup (B21)", () => {
    const el = mount({ value: "<img src=x onerror=alert(1)>", onCommit: () => {} })!;
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(el.querySelector("img")).toBeNull();
    expect(el.getAttribute("role")).toBe("textbox");
    expect(el.getAttribute("aria-label")).toBe("Question 1, answer A");
  });

  it("does not rewrite the text while focused", () => {
    const onCommit = vi.fn();
    const el = mount({ value: "Yes", onCommit })!;
    focus(el);
    type(el, "Yess");
    mount({ value: "Other", onCommit });
    expect(el.textContent).toBe("Yess");
  });

  it("Enter commits the normalized text, writes it back and moves focus to the next control", () => {
    const onCommit = vi.fn();
    const onDraftChange = vi.fn();
    const el = mount({ value: "Yes", onCommit, onDraftChange })!;
    focus(el);
    type(el, "  Yes   please ");
    expect(onDraftChange).toHaveBeenLastCalledWith("  Yes   please ");
    const e = key(el, "Enter");
    expect(e.defaultPrevented).toBe(true);
    expect(onCommit).toHaveBeenCalledWith("Yes please");
    expect(el.textContent).toBe("Yes please");
    expect(document.activeElement).toBe(document.getElementById("after"));
  });

  it("Esc restores the snapshot, commits nothing and never reaches a document listener", () => {
    const onCommit = vi.fn();
    const onDraftChange = vi.fn();
    const docListener = vi.fn();
    document.addEventListener("keydown", docListener, true);
    const el = mount({ value: "Yes", onCommit, onDraftChange })!;
    focus(el);
    type(el, "Nope");
    key(el, "Escape");
    document.removeEventListener("keydown", docListener, true);
    expect(docListener).not.toHaveBeenCalled();
    expect(el.textContent).toBe("Yes");
    expect(onDraftChange).toHaveBeenLastCalledWith("Yes");
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(document.body);
  });

  it("an emptied field restores the snapshot and reports no change", () => {
    const onCommit = vi.fn();
    const el = mount({ value: "Yes", onCommit })!;
    focus(el);
    type(el, "   ");
    act(() => el.blur());
    expect(el.textContent).toBe("Yes");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("allowEmpty (scale points) commits the empty text and keeps the placeholder", () => {
    const onCommit = vi.fn();
    const el = mount({ value: "Calm", onCommit, allowEmpty: true, placeholder: "Add label" })!;
    expect(el.getAttribute("data-ph")).toBe("Add label");
    focus(el);
    type(el, "");
    act(() => el.blur());
    expect(onCommit).toHaveBeenCalledWith("");
    expect(el.textContent).toBe("");
  });

  it("a point whose text equals its number stays editable (B45 case C)", () => {
    const onCommit = vi.fn();
    const el = mount({ value: "3", onCommit, allowEmpty: true, placeholder: "Add label" })!;
    expect(el.getAttribute("contenteditable")).toBe("plaintext-only");
    focus(el);
    type(el, "Very");
    act(() => el.blur());
    expect(onCommit).toHaveBeenCalledWith("Very");
  });

  it("refuses an insert that would pass the cap; line breaks never go in", () => {
    const el = mount({ value: "12345", maxLength: 6, onCommit: () => {} })!;
    focus(el);
    const over = new InputEvent("beforeinput", { inputType: "insertText", data: "67", cancelable: true, bubbles: true });
    el.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    const fits = new InputEvent("beforeinput", { inputType: "insertText", data: "6", cancelable: true, bubbles: true });
    el.dispatchEvent(fits);
    expect(fits.defaultPrevented).toBe(false);
    const br = new InputEvent("beforeinput", { inputType: "insertParagraph", cancelable: true, bubbles: true });
    el.dispatchEvent(br);
    expect(br.defaultPrevented).toBe(true);
  });

  it("paste inserts plain text, whitespace collapsed, only what fits", () => {
    const onDraftChange = vi.fn();
    const el = mount({ value: "", maxLength: 150, onCommit: () => {}, onDraftChange })!;
    focus(el);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "a\n\nb ".repeat(200) },
    });
    act(() => void el.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect((el.textContent ?? "").length).toBe(150);
    expect(el.textContent).not.toMatch(/\s\s|\n/);
  });

  it("Enter and Esc belong to the IME while composing", () => {
    const onCommit = vi.fn();
    const el = mount({ value: "Yes", onCommit })!;
    focus(el);
    type(el, "Yesか");
    const e = key(el, "Enter", { isComposing: true });
    expect(e.defaultPrevented).toBe(false);
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(el);
  });

  it("a committed edit shows Saving… until its save settles, then Saved", () => {
    vi.useFakeTimers();
    const tracker = createSaveTracker();
    const onCommit = vi.fn(() => {
      tracker.commit();
      return tracker.token();
    });
    const el = mount({ value: "Yes", onCommit })!;
    focus(el);
    type(el, "Yes please");
    key(el, "Enter");
    const pill = () => document.body.querySelector(".qz-fsp");
    expect(pill()?.textContent).toBe("Saving…");
    expect(pill()?.getAttribute("aria-hidden")).toBe("true");
    act(() => void vi.advanceTimersByTime(2000));
    expect(pill()?.textContent).toBe("Saving…"); // no timer ever fakes "Saved"
    act(() => {
      tracker.sent();
      tracker.result(true);
    });
    act(() => void vi.advanceTimersByTime(10));
    expect(pill()?.textContent).toBe("Saved");
    act(() => void vi.advanceTimersByTime(1500 + 400 + 10));
    expect(pill()).toBeNull();
  });

  it("a failed save shows Not saved until a later success", () => {
    vi.useFakeTimers();
    const tracker = createSaveTracker();
    const el = mount({
      value: "Yes",
      onCommit: () => {
        tracker.commit();
        return tracker.token();
      },
    })!;
    focus(el);
    type(el, "No");
    act(() => el.blur());
    act(() => {
      tracker.sent();
      tracker.result(false);
    });
    act(() => void vi.advanceTimersByTime(700));
    expect(document.body.querySelector(".qz-fsp")?.textContent).toBe("Not saved");
    act(() => {
      tracker.sent();
      tracker.result(true);
    });
    act(() => void vi.advanceTimersByTime(10));
    expect(document.body.querySelector(".qz-fsp")?.textContent).toBe("Saved");
  });
});

describe("placeSavePill (mock svPlace, B61/D5)", () => {
  const line = (top: number, left: number, right: number) => ({ top, bottom: top + 18, left, right, height: 18 });
  const vp = { width: 1200, height: 800 };
  const pill = { width: 70, height: 20 };

  it("sits 8px after the last line, centred on it, when it fits the column", () => {
    const p = placeSavePill({ lastLine: line(100, 20, 200), firstLine: line(100, 20, 200), column: { left: 20, right: 400 }, pill, viewport: vp, under: null });
    expect(p).toEqual({ left: 208, top: 99, under: false });
  });

  it("drops under the end of the line when there is no room beside it", () => {
    const p = placeSavePill({ lastLine: line(100, 20, 380), firstLine: line(100, 20, 380), column: { left: 20, right: 400 }, pill, viewport: vp, under: null });
    expect(p.under).toBe(true);
    expect(p.left).toBe(310);
    expect(p.top).toBe(120);
  });

  it("near the viewport bottom it goes above the FIRST line when it cannot sit beside", () => {
    const p = placeSavePill({
      lastLine: line(780, 20, 1190),
      firstLine: line(760, 20, 1190),
      column: { left: 20, right: 1195 },
      pill,
      viewport: vp,
      under: null,
    });
    expect(p.top).toBe(738);
  });

  it("keeps the decision it was given", () => {
    const p = placeSavePill({ lastLine: line(100, 20, 200), firstLine: line(100, 20, 200), column: { left: 20, right: 400 }, pill, viewport: vp, under: true });
    expect(p.under).toBe(true);
  });
});
