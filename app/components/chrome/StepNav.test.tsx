// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";

import { StepNav, type StepNavStep } from "./StepNav";

/* BIC-2 D3 — the §7.6 step-pill contract: aria-current marks the current
   step, DONE steps are the only clickable ones (back-navigation is gated by
   the flow's own Continue rule going forward), and the mono numeral is
   zero-padded. Render-only — the host owns states and navigation. */

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

const STEPS: StepNavStep[] = [
  { id: "grouping", label: "Buckets", number: 1, state: "done" },
  { id: "shape", label: "Shape", number: 2, state: "current" },
  { id: "design", label: "Design", number: 3, state: "upcoming" },
];

function pillByLabel(label: string): HTMLButtonElement {
  const btn = Array.from(document.body.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(label),
  );
  if (!btn) throw new Error(`no pill "${label}"`);
  return btn;
}

describe("StepNav", () => {
  it("marks ONLY the current step with aria-current='step'", () => {
    mount(createElement(StepNav, { steps: STEPS }));
    expect(pillByLabel("Shape").getAttribute("aria-current")).toBe("step");
    expect(pillByLabel("Buckets").getAttribute("aria-current")).toBeNull();
    expect(pillByLabel("Design").getAttribute("aria-current")).toBeNull();
  });

  it("clicking a DONE step routes with its id; done shows the ✓ marker", () => {
    const onStepClick = vi.fn();
    mount(createElement(StepNav, { steps: STEPS, onStepClick }));
    const done = pillByLabel("Buckets");
    expect(done.disabled).toBe(false);
    expect(done.querySelector('[aria-label="done"]')).toBeTruthy();
    act(() => done.click());
    expect(onStepClick).toHaveBeenCalledTimes(1);
    expect(onStepClick).toHaveBeenCalledWith("grouping");
  });

  it("upcoming is disabled; clicking current or upcoming never routes", () => {
    const onStepClick = vi.fn();
    mount(createElement(StepNav, { steps: STEPS, onStepClick }));
    expect(pillByLabel("Design").disabled).toBe(true);
    act(() => pillByLabel("Design").click());
    act(() => pillByLabel("Shape").click());
    expect(onStepClick).not.toHaveBeenCalled();
  });

  it("without an onStepClick handler even done steps are inert (disabled)", () => {
    mount(createElement(StepNav, { steps: STEPS }));
    expect(pillByLabel("Buckets").disabled).toBe(true);
  });

  it("renders the zero-padded mono numeral on non-completed steps", () => {
    mount(createElement(StepNav, { steps: STEPS }));
    // P2 Edit 1 (segmented bar): current + upcoming show the padded numeral;
    // COMPLETED steps show the ✓ check in its place, not the number.
    expect(pillByLabel("Shape").textContent).toContain("02"); // current
    expect(pillByLabel("Design").textContent).toContain("03"); // upcoming
    expect(pillByLabel("Buckets").querySelector('[aria-label="done"]')).toBeTruthy();
  });
});
