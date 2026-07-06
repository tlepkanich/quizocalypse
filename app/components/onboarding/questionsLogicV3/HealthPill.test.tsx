// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { HealthPill } from "./HealthPill";

/* BIC-2 D3 — the pill's CONTROLLED QzPopover contract (the pure tri-state
   lives in healthPill.test.ts; this pins the component wiring): the pill is a
   real <button> trigger, the popover open state belongs to the PARENT
   (Step3Shell — so the blocked Continue can open the same popover from
   outside), and every open/close path reports through onOpenChange instead of
   mutating local state. */

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

const verdict = (blocking: number, warnings: number) => ({
  blocking,
  warnings,
  safe: blocking === 0,
  label: `${warnings} to review · ${blocking} blocking`,
});

function pillEl(over: Partial<Parameters<typeof HealthPill>[0]> = {}) {
  return createElement(HealthPill, {
    verdict: verdict(2, 1),
    open: false,
    onOpenChange: () => {},
    popover: createElement("div", null, "HEALTH POPOVER BODY"),
    ...over,
  });
}

function pillButton(): HTMLButtonElement {
  const btn = document.body.querySelector("button.qz-s3-healthpill");
  if (!(btn instanceof HTMLButtonElement)) throw new Error("pill button not rendered");
  return btn;
}

describe("HealthPill (controlled QzPopover contract)", () => {
  it("closed: renders the verdict text on a real <button>, popover content NOT in the DOM", () => {
    mount(pillEl());
    const btn = pillButton();
    expect(btn.textContent).toContain("2 blocking");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("HEALTH POPOVER BODY");
  });

  it("clicking the pill reports onOpenChange(true) — it does NOT open itself (parent-owned state)", () => {
    const onOpenChange = vi.fn();
    mount(pillEl({ onOpenChange }));
    act(() => pillButton().click());
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Still controlled-closed: the parent has not flipped `open`.
    expect(document.body.textContent).not.toContain("HEALTH POPOVER BODY");
  });

  it("open=true renders the popover (portaled) and marks the trigger expanded", () => {
    mount(pillEl({ open: true }));
    expect(document.body.textContent).toContain("HEALTH POPOVER BODY");
    expect(pillButton().getAttribute("aria-expanded")).toBe("true");
  });

  it("re-clicking the open pill reports onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    mount(pillEl({ open: true, onOpenChange }));
    act(() => pillButton().click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Escape closes through onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    mount(pillEl({ open: true, onOpenChange }));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
