import { describe, expect, it } from "vitest";
import { stylesFor } from "./runtimeStyles";

// QZY-R7-3 §7.2 — the primary/Next button gains its own size + radius, applied
// ONLY when the merchant sets them. The load-bearing guarantee is byte-safety:
// a doc with no button tokens must serialize the SAME CSS strings as before the
// feature landed, or the byte pin breaks. These tests pin those exact strings.

describe("primaryBtn — byte-safe when button tokens absent", () => {
  it("keeps the exact prior radius/padding/font-size strings", () => {
    const btn = stylesFor({}).primaryBtn as Record<string, unknown>;
    expect(btn.borderRadius).toBe("var(--qz-radius)");
    expect(btn.padding).toBe("calc(var(--qz-pad) / 2) var(--qz-pad)");
    expect(btn.fontSize).toBe("var(--qz-base-size)");
  });

  it("a radius token that is undefined does not alter the string", () => {
    const btn = stylesFor({ button_radius: undefined }).primaryBtn as Record<string, unknown>;
    expect(btn.borderRadius).toBe("var(--qz-radius)");
  });
});

describe("primaryBtn — applies button tokens when set", () => {
  it("button_radius becomes a literal px radius", () => {
    const btn = stylesFor({ button_radius: 16 }).primaryBtn as Record<string, unknown>;
    expect(btn.borderRadius).toBe("16px");
  });

  it("button_radius of 0 (square) is honoured, not treated as unset", () => {
    const btn = stylesFor({ button_radius: 0 }).primaryBtn as Record<string, unknown>;
    expect(btn.borderRadius).toBe("0px");
  });

  it("button_scale multiplies padding + font-size", () => {
    const btn = stylesFor({ button_scale: 1.2 }).primaryBtn as Record<string, unknown>;
    expect(btn.padding).toBe(
      "calc(var(--qz-pad) / 2 * 1.2) calc(var(--qz-pad) * 1.2)",
    );
    expect(btn.fontSize).toBe("calc(var(--qz-base-size) * 1.2)");
  });

  it("radius + scale compose independently", () => {
    const btn = stylesFor({ button_radius: 8, button_scale: 0.85 }).primaryBtn as Record<
      string,
      unknown
    >;
    expect(btn.borderRadius).toBe("8px");
    expect(btn.fontSize).toBe("calc(var(--qz-base-size) * 0.85)");
  });
});
