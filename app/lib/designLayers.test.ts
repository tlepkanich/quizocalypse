import { describe, expect, it } from "vitest";
import type { DesignTokens } from "./quizSchema";
import { mergeTokens } from "./designLayers";

describe("mergeTokens", () => {
  it("deep-merges colors: patching one key preserves the other color keys (the trap)", () => {
    const cur: DesignTokens = {
      colors: { primary: "#111111", background: "#ffffff", text: "#000000" },
      radius: "rounded",
    };
    const out = mergeTokens(cur, { colors: { secondary: "#ff00ff" } });
    expect(out.colors).toEqual({
      primary: "#111111",
      background: "#ffffff",
      text: "#000000",
      secondary: "#ff00ff",
    });
    expect(out.radius).toBe("rounded"); // sibling top-level field untouched
  });

  it("a patch with NO colors leaves cur.colors fully intact", () => {
    const cur: DesignTokens = { colors: { primary: "#111111" } };
    const out = mergeTokens(cur, { radius: "pill" });
    expect(out.colors).toEqual({ primary: "#111111" });
    expect(out.radius).toBe("pill");
  });

  it("a patched color key OVERRIDES cur's value while keeping siblings", () => {
    const cur: DesignTokens = { colors: { primary: "#111111", accent: "#222222" } };
    const out = mergeTokens(cur, { colors: { primary: "#999999" } });
    expect(out.colors).toEqual({ primary: "#999999", accent: "#222222" });
  });

  it("top-level patch fields override cur", () => {
    expect(mergeTokens({ radius: "square" }, { radius: "pill" }).radius).toBe("pill");
  });

  it("does not mutate either input", () => {
    const cur: DesignTokens = { colors: { primary: "#111111" } };
    const patch: DesignTokens = { colors: { secondary: "#222222" } };
    mergeTokens(cur, patch);
    expect(cur).toEqual({ colors: { primary: "#111111" } });
    expect(patch).toEqual({ colors: { secondary: "#222222" } });
  });
});
