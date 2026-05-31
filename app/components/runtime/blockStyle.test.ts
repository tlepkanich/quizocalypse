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
