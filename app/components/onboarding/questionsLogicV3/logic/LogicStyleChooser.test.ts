import { describe, it, expect } from "vitest";

import { recommendEngine } from "./LogicStyleChooser";

/* Chooser Rebuild Handoff §04 — the one decision on the page is a pure
   function over two integers. Four branches, in precedence order: no usable
   attributes → rules; a small catalog → rules (even with strong attributes);
   exactly one strong attribute → attributes, thin; otherwise attributes,
   strong. An empty catalog needs no branch of its own. */
describe("recommendEngine", () => {
  it("lands on rules when no attribute splits the catalog", () => {
    expect(recommendEngine({ productCount: 400, strongCount: 0 })).toEqual({
      engine: "rules",
      confidence: "strong",
    });
  });

  it("lands on rules for a small catalog even with strong attributes", () => {
    expect(recommendEngine({ productCount: 24, strongCount: 3 })).toEqual({
      engine: "rules",
      confidence: "strong",
    });
  });

  it("recommends attributes thinly when only one attribute splits well", () => {
    expect(recommendEngine({ productCount: 25, strongCount: 1 })).toEqual({
      engine: "attributes",
      confidence: "thin",
    });
  });

  it("recommends attributes strongly with two or more splitting attributes", () => {
    expect(recommendEngine({ productCount: 25, strongCount: 2 })).toEqual({
      engine: "attributes",
      confidence: "strong",
    });
  });

  it("treats an empty catalog as the no-attributes case", () => {
    expect(recommendEngine({ productCount: 0, strongCount: 0 }).engine).toBe("rules");
  });
});
