import { describe, expect, it } from "vitest";
import type { DesignTokens } from "./quizSchema";
import { resolveNodeOverride, SHARED_RESULT_KEY } from "./resultLayout";

const sharedTok: DesignTokens = { colors: { primary: "#aaaaaa" } };
const ownTok: DesignTokens = { colors: { primary: "#bbbbbb" } };

describe("resolveNodeOverride", () => {
  it("result node + shared mode + NO per-node override → the shared template", () => {
    expect(
      resolveNodeOverride("r1", "result", "shared", { [SHARED_RESULT_KEY]: sharedTok }),
    ).toBe(sharedTok);
  });

  it("result node + shared mode + no own + NO shared key → null", () => {
    expect(resolveNodeOverride("r1", "result", "shared", {})).toBeNull();
  });

  it("result node + shared mode + per-node override present → the OWN override (no fallthrough)", () => {
    expect(
      resolveNodeOverride("r1", "result", "shared", { r1: ownTok, [SHARED_RESULT_KEY]: sharedTok }),
    ).toBe(ownTok);
  });

  it("NON-result node never picks up the shared key — own override only", () => {
    expect(
      resolveNodeOverride("q1", "question", "shared", { [SHARED_RESULT_KEY]: sharedTok }),
    ).toBeNull();
    expect(
      resolveNodeOverride("q1", "question", "shared", { q1: ownTok, [SHARED_RESULT_KEY]: sharedTok }),
    ).toBe(ownTok);
  });

  it("result node + CUSTOM mode → own override only (never the shared template)", () => {
    expect(
      resolveNodeOverride("r1", "result", "custom", { [SHARED_RESULT_KEY]: sharedTok }),
    ).toBeNull();
    expect(
      resolveNodeOverride("r1", "result", "custom", { r1: ownTok, [SHARED_RESULT_KEY]: sharedTok }),
    ).toBe(ownTok);
  });
});
