import { describe, it, expect } from "vitest";

import { recommendEngine } from "./LogicStyleChooser";

/* Chooser Rebuild Handoff §04 — the one decision on the page is a pure
   function over two integers. Three branches, in precedence order: no usable
   attributes → rules; a small catalog → rules (even with strong attributes);
   otherwise attributes. The badge is binary (the "Probably right" tier was
   dropped by the owner). An empty catalog needs no branch of its own. */
describe("recommendEngine", () => {
  it("lands on rules when no attribute splits the catalog", () => {
    expect(recommendEngine({ productCount: 400, strongCount: 0 })).toBe("rules");
  });

  it("lands on rules for a small catalog even with strong attributes", () => {
    expect(recommendEngine({ productCount: 24, strongCount: 3 })).toBe("rules");
  });

  it("recommends attributes once the catalog is big enough and splits", () => {
    expect(recommendEngine({ productCount: 25, strongCount: 1 })).toBe("attributes");
    expect(recommendEngine({ productCount: 25, strongCount: 2 })).toBe("attributes");
  });

  it("treats an empty catalog as the no-attributes case", () => {
    expect(recommendEngine({ productCount: 0, strongCount: 0 })).toBe("rules");
  });
});
