import { describe, expect, it } from "vitest";
import { pillPresentation } from "./HealthPill";

// QL3-P4 — the pill's tri-state derives from the SAME verdict object that
// gates Continue (Step3Shell's single memoized buildTier1Report), so these
// pin the presentation contract: blocking wins, then warnings, then valid.
const verdict = (blocking: number, warnings: number) => ({
  blocking,
  warnings,
  safe: blocking === 0,
  label: `${warnings} to review · ${blocking} blocking · ${blocking === 0 ? "safe" : "not safe"} to publish`,
});

describe("pillPresentation", () => {
  it("healthy → green 'Logic valid'", () => {
    expect(pillPresentation(verdict(0, 0))).toEqual({ state: "ok", text: "Logic valid" });
  });

  it("warnings only → amber 'N to review'", () => {
    expect(pillPresentation(verdict(0, 3))).toEqual({ state: "warn", text: "3 to review" });
  });

  it("blocking → red 'N blocking'", () => {
    expect(pillPresentation(verdict(2, 0))).toEqual({ state: "bad", text: "2 blocking" });
  });

  it("blocking wins over warnings (the gate's severity order)", () => {
    expect(pillPresentation(verdict(1, 5))).toEqual({ state: "bad", text: "1 blocking" });
  });
});
