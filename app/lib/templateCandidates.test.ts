import { describe, expect, it } from "vitest";
import { TEMPLATE_GEN_LIMIT_ERROR, friendlyTemplateGenError } from "./templateCandidates";

// FLOW-3 — the candidate generation's four-outcome copy: every class points at
// the starter rail (the templates page's non-AI way forward) and never leaks
// raw error text.

describe("friendlyTemplateGenError (four-outcome copy)", () => {
  it("maps credit depletion to the unavailable class", () => {
    expect(friendlyTemplateGenError(new Error("400 credit balance is too low"))).toMatch(
      /temporarily unavailable/,
    );
  });

  it("maps rate limits to the busy class", () => {
    expect(friendlyTemplateGenError(new Error("429 rate_limit_error"))).toMatch(/busy right now/);
  });

  it("maps everything else to the generic class without leaking the raw error", () => {
    const msg = friendlyTemplateGenError(new Error("ZodError: types invalid"));
    expect(msg).toMatch(/couldn't draft template ideas/);
    expect(msg).not.toMatch(/Zod/);
  });

  it("every class names the starter rail as the way forward", () => {
    for (const msg of [
      friendlyTemplateGenError(new Error("billing")),
      friendlyTemplateGenError(new Error("429")),
      friendlyTemplateGenError(new Error("boom")),
      TEMPLATE_GEN_LIMIT_ERROR,
    ]) {
      expect(msg).toMatch(/ready-made template below/);
    }
  });
});
