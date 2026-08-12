import { describe, expect, it } from "vitest";
import {
  blockStyleToCss,
  isEmptyBlockStyle,
  nodeScopeClass,
  sanitizeHexColor,
  scopeNodeCss,
} from "./blockStyle";

describe("sanitizeHexColor", () => {
  it("accepts 3/6/8-digit hex", () => {
    expect(sanitizeHexColor("#abc")).toBe("#abc");
    expect(sanitizeHexColor("#A1B2C3")).toBe("#A1B2C3");
    expect(sanitizeHexColor("#11223344")).toBe("#11223344");
  });
  it("trims surrounding whitespace", () => {
    expect(sanitizeHexColor("  #fff  ")).toBe("#fff");
  });
  it("drops non-hex values", () => {
    expect(sanitizeHexColor("red")).toBeUndefined();
    expect(sanitizeHexColor("rgb(0,0,0)")).toBeUndefined();
    expect(sanitizeHexColor("url(x)")).toBeUndefined();
    expect(sanitizeHexColor(undefined)).toBeUndefined();
    expect(sanitizeHexColor("")).toBeUndefined();
  });
});

describe("blockStyleToCss", () => {
  it("maps fields to inline CSS", () => {
    const css = blockStyleToCss({
      align: "center",
      margin_top: 12,
      padding: 8,
      text_color: "#222",
      background: "#fafafa",
      font_size: 18,
      font_weight: 700,
      radius: "pill",
    });
    expect(css.textAlign).toBe("center");
    expect(css.marginTop).toBe(12);
    expect(css.padding).toBe(8);
    expect(css.color).toBe("#222");
    expect(css.background).toBe("#fafafa");
    expect(css.fontSize).toBe(18);
    expect(css.fontWeight).toBe(700);
    expect(css.borderRadius).toBe("999px");
  });
  it("maps radius variants", () => {
    expect(blockStyleToCss({ radius: "square" }).borderRadius).toBe("0px");
    expect(blockStyleToCss({ radius: "rounded" }).borderRadius).toBe("10px");
  });
  it("drops invalid colors", () => {
    const css = blockStyleToCss({ text_color: "red", background: "blue" });
    expect(css.color).toBeUndefined();
    expect(css.background).toBeUndefined();
  });
  it("centers when only max_width is set", () => {
    const css = blockStyleToCss({ max_width: 480 });
    expect(css.maxWidth).toBe(480);
    expect(css.marginLeft).toBe("auto");
    expect(css.marginRight).toBe("auto");
  });
  it("empty / undefined yields {}", () => {
    expect(blockStyleToCss(undefined)).toEqual({});
    expect(blockStyleToCss({})).toEqual({});
  });
});

// ── QRTZ-F3 — per-side padding ──────────────────────────────────────────────
describe("blockStyleToCss per-side padding", () => {
  it("maps each side and wins over the uniform value (longhand after shorthand)", () => {
    const css = blockStyleToCss({
      padding: 8,
      padding_top: 20,
      padding_bottom: 4,
      padding_left: 12,
      padding_right: 16,
    });
    expect(css.padding).toBe(8);
    expect(css.paddingTop).toBe(20);
    expect(css.paddingBottom).toBe(4);
    expect(css.paddingLeft).toBe(12);
    expect(css.paddingRight).toBe(16);
    // Longhand keys must FOLLOW the shorthand so they win in React's
    // insertion-order application and in the SSR style string.
    const keys = Object.keys(css);
    expect(keys.indexOf("padding")).toBeLessThan(keys.indexOf("paddingTop"));
  });
  it("a single side works without the uniform value", () => {
    const css = blockStyleToCss({ padding_left: 24 });
    expect(css.paddingLeft).toBe(24);
    expect(css.padding).toBeUndefined();
  });
  it("counts as a visible effect for isEmptyBlockStyle", () => {
    expect(isEmptyBlockStyle({ padding_top: 2 })).toBe(false);
  });
});

// QRTZ-F3 equality pin — the dual-model invariant made checkable at the
// mapping level: for any BlockStyle WITHOUT per-side fields, blockStyleToCss
// must return an object deep-equal to the pre-QRTZ-F3 implementation's output
// with the SAME key order (SSR serializes the style object in key order, so
// order IS bytes). `legacy` below is a frozen copy of the mapping as it stood
// before per-side padding landed — do not "sync" it with the live function.
describe("blockStyleToCss legacy equality pin (docs without per-side fields)", () => {
  function legacy(s: Parameters<typeof blockStyleToCss>[0]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!s) return out;
    if (s.align) out.textAlign = s.align;
    if (typeof s.margin_top === "number") out.marginTop = s.margin_top;
    if (typeof s.margin_bottom === "number") out.marginBottom = s.margin_bottom;
    if (typeof s.padding === "number") out.padding = s.padding;
    if (typeof s.max_width === "number") {
      out.maxWidth = s.max_width;
      if (s.margin_top === undefined && s.margin_bottom === undefined) {
        out.marginLeft = "auto";
        out.marginRight = "auto";
      }
    }
    const color = sanitizeHexColor(s.text_color);
    if (color) out.color = color;
    const bg = sanitizeHexColor(s.background);
    if (bg) out.background = bg;
    if (typeof s.font_size === "number") out.fontSize = s.font_size;
    if (typeof s.font_weight === "number") out.fontWeight = s.font_weight;
    if (s.radius) out.borderRadius = s.radius === "square" ? "0px" : s.radius === "pill" ? "999px" : "10px";
    if (typeof s.letter_spacing === "number") out.letterSpacing = s.letter_spacing;
    return out;
  }

  const cases: Parameters<typeof blockStyleToCss>[0][] = [
    undefined,
    {},
    { align: "center" },
    { padding: 0 },
    { padding: 8 },
    { margin_top: 12, margin_bottom: 4, padding: 8 },
    { max_width: 480 },
    { max_width: 480, margin_top: 6 },
    { text_color: "#222", background: "#fafafa" },
    { text_color: "notacolor" },
    { font_size: 18, font_weight: 700, letter_spacing: 0.5 },
    { radius: "square" },
    { radius: "rounded" },
    { radius: "pill" },
    {
      align: "right",
      margin_top: 1,
      margin_bottom: 2,
      padding: 3,
      max_width: 300,
      text_color: "#abc",
      background: "#def",
      font_size: 14,
      font_weight: 500,
      radius: "rounded",
      letter_spacing: -1,
    },
  ];

  it("output is deep-equal to the frozen pre-change mapping", () => {
    for (const s of cases) {
      expect(blockStyleToCss(s)).toEqual(legacy(s));
    }
  });
  it("key ORDER matches the frozen pre-change mapping (SSR byte order)", () => {
    for (const s of cases) {
      expect(Object.keys(blockStyleToCss(s))).toEqual(Object.keys(legacy(s)));
    }
  });
});

describe("isEmptyBlockStyle", () => {
  it("true for empty/undefined", () => {
    expect(isEmptyBlockStyle(undefined)).toBe(true);
    expect(isEmptyBlockStyle({})).toBe(true);
  });
  it("true when only invalid colors are present", () => {
    expect(isEmptyBlockStyle({ text_color: "notacolor" })).toBe(true);
  });
  it("false when an effective field is set", () => {
    expect(isEmptyBlockStyle({ align: "center" })).toBe(false);
    expect(isEmptyBlockStyle({ padding: 4 })).toBe(false);
  });
});

describe("nodeScopeClass", () => {
  it("is deterministic and a valid class token", () => {
    const a = nodeScopeClass("q_abc123");
    expect(a).toBe(nodeScopeClass("q_abc123"));
    expect(a).toMatch(/^qz-node-[a-z0-9]+$/);
  });
  it("differs across node ids", () => {
    expect(nodeScopeClass("a")).not.toBe(nodeScopeClass("b"));
  });
});

describe("scopeNodeCss", () => {
  it("declaration-only mode wraps in the node scope", () => {
    const scope = nodeScopeClass("n1");
    expect(scopeNodeCss("n1", "color: red; padding: 4px")).toBe(
      `.${scope}{color: red; padding: 4px}`,
    );
  });

  it("prefixes selectors with the node scope class", () => {
    const scope = nodeScopeClass("n1");
    const out = scopeNodeCss("n1", ".headline { color: #222 } .btn{font-weight:700}");
    expect(out).toBe(`.${scope} .headline{ color: #222 }.${scope} .btn{font-weight:700}`);
  });

  it("re-scopes document-level selectors to the node root", () => {
    const scope = nodeScopeClass("n1");
    expect(scopeNodeCss("n1", ":root { background: #fff }")).toBe(
      `.${scope}{ background: #fff }`,
    );
    expect(scopeNodeCss("n1", "body { color: #000 }")).toBe(`.${scope}{ color: #000 }`);
    expect(scopeNodeCss("n1", "* { margin: 0 }")).toBe(`.${scope}{ margin: 0 }`);
  });

  it("supports & as the node root and the > child combinator", () => {
    const scope = nodeScopeClass("n1");
    expect(scopeNodeCss("n1", "&:hover { opacity: .9 }")).toBe(
      `.${scope}:hover{ opacity: .9 }`,
    );
    expect(scopeNodeCss("n1", ".a > .b { color: #111 }")).toBe(
      `.${scope} .a > .b{ color: #111 }`,
    );
  });

  it("keeps @media but re-scopes its inner selectors", () => {
    const scope = nodeScopeClass("n1");
    const out = scopeNodeCss("n1", "@media (max-width: 600px){ .x { color: #1a1a1a } }");
    expect(out).toBe(`@media (max-width: 600px){.${scope} .x{ color: #1a1a1a }}`);
  });

  it("drops @font-face / @keyframes at-rules", () => {
    const out = scopeNodeCss("n1", "@font-face { font-family: x } .a { color: #222 }");
    const scope = nodeScopeClass("n1");
    expect(out).toBe(`.${scope} .a{ color: #222 }`);
  });

  it("rejects break-out and IE vectors", () => {
    expect(scopeNodeCss("n1", "</style><script>alert(1)</script>")).toBeNull();
    expect(scopeNodeCss("n1", "x { width: expression(alert(1)) }")).toBeNull();
    expect(scopeNodeCss("n1", "a { background: url(javascript:alert(1)) }")).toBeNull();
    expect(scopeNodeCss("n1", "@import url(https://evil.example/x.css)")).toBeNull();
    expect(scopeNodeCss("n1", "x { -moz-binding: url(x.xml) }")).toBeNull();
  });

  it("rejects unsafe url() schemes but allows https + data:image", () => {
    expect(scopeNodeCss("n1", ".a { background: url(http://x/y.png) }")).toBeNull();
    expect(scopeNodeCss("n1", ".a { background: url(/rel.png) }")).toBeNull();
    const scope = nodeScopeClass("n1");
    expect(
      scopeNodeCss("n1", ".a { background: url(https://cdn.example/y.png) }"),
    ).toBe(`.${scope} .a{ background: url(https://cdn.example/y.png) }`);
    expect(scopeNodeCss("n1", ".a { background: url(data:image/png;base64,AAAA) }")).toBe(
      `.${scope} .a{ background: url(data:image/png;base64,AAAA) }`,
    );
  });

  it("returns null for empty / non-string input", () => {
    expect(scopeNodeCss("n1", "")).toBeNull();
    expect(scopeNodeCss("n1", "   ")).toBeNull();
    expect(scopeNodeCss("n1", undefined)).toBeNull();
    expect(scopeNodeCss("n1", null)).toBeNull();
  });
});
