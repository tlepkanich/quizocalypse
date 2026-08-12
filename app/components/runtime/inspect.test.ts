import { describe, expect, it } from "vitest";
import { INSPECT_PART_NAME, inspectAttrs, type InspectTarget } from "./inspect";

const target: InspectTarget = { nodeId: "n1", part: "subtext" };

describe("inspectAttrs — the /q gate", () => {
  it("returns {} without onInspect, even when a selection matches", () => {
    // This is the storefront path: /q renders QuizRuntime without onInspect
    // (and mode="live" forces inspectFn undefined regardless), so inspected
    // elements carry NO class, NO handler, and NO data-qz-sel-tag — the
    // shopper DOM is byte-identical with inspect code present.
    expect(inspectAttrs(undefined, target, target)).toEqual({});
    expect(Object.keys(inspectAttrs(undefined, null, target))).toHaveLength(0);
  });
});

describe("inspectAttrs — builder edit mode", () => {
  const onInspect = () => {};
  it("unselected: hover class only, no type tag", () => {
    const attrs = inspectAttrs(onInspect, null, target);
    expect(attrs.className).toBe("qz-insp");
    expect(attrs["data-qz-sel-tag"]).toBeUndefined();
  });
  it("a different selection does not tag this element", () => {
    const attrs = inspectAttrs(onInspect, { nodeId: "n2", part: "subtext" }, target);
    expect(attrs.className).toBe("qz-insp");
    expect(attrs["data-qz-sel-tag"]).toBeUndefined();
  });
  it("selected: ring class + the type tag (QRTZ-F3, mock .sel-tag)", () => {
    const attrs = inspectAttrs(onInspect, target, target);
    expect(attrs.className).toBe("qz-insp qz-insp-sel");
    expect(attrs["data-qz-sel-tag"]).toBe("Text");
  });
  it("answers match on answerId before tagging", () => {
    const a1: InspectTarget = { nodeId: "n1", part: "answer", answerId: "a1" };
    const a2: InspectTarget = { nodeId: "n1", part: "answer", answerId: "a2" };
    expect(inspectAttrs(onInspect, a1, a2)["data-qz-sel-tag"]).toBeUndefined();
    expect(inspectAttrs(onInspect, a1, a1)["data-qz-sel-tag"]).toBe("Answer");
  });
});

describe("INSPECT_PART_NAME", () => {
  it("names every part with a short non-empty label", () => {
    for (const [part, name] of Object.entries(INSPECT_PART_NAME)) {
      expect(name.length, part).toBeGreaterThan(0);
      expect(name.length, part).toBeLessThanOrEqual(12);
    }
  });
  it("uses the inspector's block kind vocabulary for block-twin parts", () => {
    expect(INSPECT_PART_NAME.headline).toBe("Heading");
    expect(INSPECT_PART_NAME.subtext).toBe("Text");
    expect(INSPECT_PART_NAME.cta).toBe("Button");
  });
});
