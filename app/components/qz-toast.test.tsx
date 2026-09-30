// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import {
  QzToastProvider,
  isToastUndoKey,
  nextToastState,
  toastAnnouncement,
  toastDuration,
  useQzToast,
  type QzToastFn,
} from "./qz-toast";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

describe("nextToastState — queue of one, with D7's one action", () => {
  const undo = { label: "Undo", onAction: () => {} };

  it("a plain message replaces a plain message", () => {
    const first = nextToastState(null, "Saved", 1);
    expect(nextToastState(first, "Added", 2)).toEqual({ id: 2, message: "Added" });
  });

  it("carries the action, duration and key", () => {
    const s = nextToastState(null, "Rule deleted", 1, { action: undo, duration: 7000, key: "undo" });
    expect(s.action).toBe(undo);
    expect(s.duration).toBe(7000);
    expect(s.key).toBe("undo");
  });

  it("B7: a plain message never replaces a live action toast (the Undo survives)", () => {
    const withUndo = nextToastState(null, "Rule deleted", 1, { action: undo });
    const after = nextToastState(withUndo, "Copied", 2);
    expect(after).toBe(withUndo);
  });

  it("an action toast replaces an action toast", () => {
    const a = nextToastState(null, "Rule deleted", 1, { action: undo });
    const b = nextToastState(a, "Rule moved", 2, { action: undo });
    expect(b.id).toBe(2);
    expect(b.message).toBe("Rule moved");
  });

  it("a same-key plain message may update its own action toast", () => {
    const a = nextToastState(null, "Rule deleted", 1, { action: undo, key: "k" });
    const b = nextToastState(a, "Undone", 2, { key: "k" });
    expect(b.message).toBe("Undone");
    expect(b.action).toBeUndefined();
  });

  it("durations: 2400 plain, 6000 with an action, explicit wins", () => {
    expect(toastDuration({})).toBe(2400);
    expect(toastDuration({ action: undo })).toBe(6000);
    expect(toastDuration({ action: undo, duration: 7000 })).toBe(7000);
  });

  it("announcement names the shortcut only when an action exists", () => {
    expect(toastAnnouncement({ message: "Saved" })).toBe("Saved");
    expect(toastAnnouncement({ message: "Rule deleted", action: undo })).toBe(
      "Rule deleted. Press Undo, or Ctrl+Z, to bring it back.",
    );
    expect(toastAnnouncement(null)).toBe("");
  });
});

describe("isToastUndoKey", () => {
  const base = { key: "z", metaKey: false, ctrlKey: true, shiftKey: false, target: document.body };
  it("Ctrl+Z and Cmd+Z, not Shift, not other keys", () => {
    expect(isToastUndoKey(base)).toBe(true);
    expect(isToastUndoKey({ ...base, ctrlKey: false, metaKey: true, key: "Z" })).toBe(true);
    expect(isToastUndoKey({ ...base, shiftKey: true })).toBe(false);
    expect(isToastUndoKey({ ...base, key: "y" })).toBe(false);
    expect(isToastUndoKey({ ...base, ctrlKey: false })).toBe(false);
  });
  it("never inside a text field or contenteditable", () => {
    const input = document.createElement("input");
    const ed = document.createElement("span");
    ed.setAttribute("contenteditable", "plaintext-only");
    const inner = document.createElement("b");
    ed.appendChild(inner);
    expect(isToastUndoKey({ ...base, target: input })).toBe(false);
    expect(isToastUndoKey({ ...base, target: inner })).toBe(false);
  });
});

describe("QzToastProvider", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  let fire: QzToastFn = () => 0;

  function Grab() {
    fire = useQzToast();
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(QzToastProvider, null, createElement(Grab))));
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  const pill = () => document.body.querySelector(".qz-toast");
  const live = () => document.body.querySelector('[role="status"]');

  it("the live region is always mounted and carries the Undo sentence", () => {
    expect(live()).toBeTruthy();
    expect(live()!.textContent).toBe("");
    act(() => void fire("Rule deleted", { action: { label: "Undo", onAction: () => {} } }));
    expect(live()!.textContent).toBe("Rule deleted. Press Undo, or Ctrl+Z, to bring it back.");
    // The pill is not itself a live region (no double announcement).
    expect(pill()!.getAttribute("role")).toBeNull();
  });

  it("a plain toast auto-dismisses after 2.4s", () => {
    act(() => void fire("Saved"));
    expect(pill()!.textContent).toBe("Saved");
    act(() => void vi.advanceTimersByTime(2500));
    expect(pill()).toBeNull();
  });

  it("clicking the action runs it once, hides the toast and reports 'action'", () => {
    const onAction = vi.fn();
    const onHide = vi.fn();
    act(() => void fire("Rule deleted", { action: { label: "Undo", onAction }, onHide }));
    const btn = pill()!.querySelector("button")!;
    expect(btn.textContent).toBe("Undo");
    act(() => btn.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledWith("action");
    expect(pill()).toBeNull();
  });

  it("Ctrl+Z triggers the action only while it is showing", () => {
    const onAction = vi.fn();
    act(() => void fire("Rule deleted", { action: { label: "Undo", onAction } }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("hover pauses the timer; leaving re-arms it", () => {
    act(() => void fire("Rule deleted", { action: { label: "Undo", onAction: () => {} } }));
    const el = pill() as HTMLElement;
    act(() => {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
    });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(pill()).toBeTruthy();
    act(() => {
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });
    act(() => void vi.advanceTimersByTime(6100));
    expect(pill()).toBeNull();
  });

  it("a plain toast does not knock out a live Undo; a replacing action toast fires onHide('replaced')", () => {
    const onHide = vi.fn();
    act(() => void fire("Rule deleted", { action: { label: "Undo", onAction: () => {} }, onHide }));
    act(() => void fire("Copied"));
    expect(pill()!.textContent).toContain("Rule deleted");
    act(() => void fire("Rule moved", { action: { label: "Undo", onAction: () => {} } }));
    expect(onHide).toHaveBeenCalledWith("replaced");
    expect(pill()!.textContent).toContain("Rule moved");
  });

  it("a same-key toast updates in place without onHide", () => {
    const onHide = vi.fn();
    const undo = { label: "Undo", onAction: () => {} };
    act(() => void fire("Rule deleted", { action: undo, key: "u", onHide }));
    act(() => void fire("2 rules deleted", { action: { ...undo, label: "Undo both" }, key: "u", onHide }));
    expect(onHide).not.toHaveBeenCalled();
    expect(pill()!.textContent).toContain("Undo both");
  });

  it("focusAction moves focus to the action; returnFocus runs when it hides holding focus", () => {
    const target = document.createElement("button");
    document.body.appendChild(target);
    const returnFocus = vi.fn(() => target.focus());
    act(() =>
      void fire("Rule deleted", {
        action: { label: "Undo", onAction: () => {} },
        focusAction: true,
        returnFocus,
      }),
    );
    expect(document.activeElement).toBe(pill()!.querySelector("button"));
    act(() => (pill()!.querySelector("button") as HTMLButtonElement).click());
    expect(returnFocus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(target);
  });
});
