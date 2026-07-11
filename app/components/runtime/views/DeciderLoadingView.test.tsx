// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { DeciderLoadingView } from "./DeciderViews";

// §L L3 — the engagement interstitial rides on the EXISTING DeciderLoadingView.
// These tests lock the two contracts that matter: (1) with NO `interstitial`
// prop — every existing decider doc — the view is byte-for-byte the legacy
// spinner + chrome copy (no headline, no progress bar); (2) an opt-in config
// drives the headline, stepped copy, and progress-bar style.

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: React.ReactElement): string {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(node);
  });
  return host.innerHTML;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("DeciderLoadingView — §L interstitial (byte-safe default)", () => {
  it("with no engagement prop, renders the legacy spinner + chrome copy (no headline, no progress bar)", () => {
    const html = render(createElement(DeciderLoadingView, { poolSize: 0, onDone: () => {} }));
    expect(html).toContain("Weighing your answers…"); // default chrome line
    expect(html).toContain("qz-spin"); // the legacy spinner animation
    expect(html).not.toContain("transition:width"); // no progress bar
    expect(html).not.toContain("transition: width");
  });

  it("stepped config renders the merchant headline + first custom step", () => {
    const html = render(
      createElement(DeciderLoadingView, {
        poolSize: 3,
        onDone: () => {},
        interstitial: {
          enabled: true,
          delayMs: 2500,
          style: "stepped",
          steps: ["Reading your answers", "Matching products", "Finalizing"],
          headline: "Calculating your results…",
        },
      }),
    );
    expect(html).toContain("Calculating your results…"); // headline
    expect(html).toContain("Reading your answers"); // first custom step
    expect(html).not.toContain("Weighing your answers…"); // chrome copy replaced
  });

  it("progress style renders a progress bar instead of the spinner", () => {
    const html = render(
      createElement(DeciderLoadingView, {
        poolSize: 3,
        onDone: () => {},
        interstitial: { enabled: true, delayMs: 2000, style: "progress", steps: [], headline: "One sec…" },
      }),
    );
    expect(html).toMatch(/transition: ?width/);
  });

  it("a disabled config falls back to the legacy default (opt-in only)", () => {
    const html = render(
      createElement(DeciderLoadingView, {
        poolSize: 0,
        onDone: () => {},
        interstitial: { enabled: false, delayMs: 2500, style: "progress", steps: [], headline: "SECRETHEADLINE" },
      }),
    );
    expect(html).toContain("Weighing your answers…");
    expect(html).not.toContain("SECRETHEADLINE");
  });

  it("fires onDone after the beats elapse", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    render(createElement(DeciderLoadingView, { poolSize: 0, onDone }));
    for (let i = 0; i < 4; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(onDone).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
