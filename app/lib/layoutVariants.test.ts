import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { applyLayoutVariant, detectLayoutVariant, LAYOUT_VARIANTS } from "./layoutVariants";

const doc = () =>
  Quiz.parse({
    quiz_id: "lv",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      { id: "end", type: "end", position: { x: 200, y: 0 }, data: { headline: "Bye" } },
    ],
    edges: [{ id: "e1", source: "intro", target: "end" }],
    design_tokens: {
      colors: { background: "#0C1018", text: "#F5F2EA", primary: "#E4572E" },
      typography: { heading: { family: "Fraunces" }, body: { family: "Inter", base_size: 16 } },
      radius: "pill",
      button_style: "outline",
      shadow: "elevated",
    },
  });

describe("layout variants", () => {
  it("applies only structural keys — colors/fonts/radius/shadow preserved (composes with themes)", () => {
    const out = applyLayoutVariant(doc(), "editorial");
    const t = out.design_tokens!;
    expect(t.spacing).toBe("spacious");
    expect(t.result_split).toBe(true);
    expect(t.typography?.body?.base_size).toBe(17);
    // The Dark theme survives untouched.
    expect(t.colors?.background).toBe("#0C1018");
    expect(t.typography?.heading?.family).toBe("Fraunces");
    expect(t.typography?.body?.family).toBe("Inter");
    expect(t.radius).toBe("pill");
    expect(t.button_style).toBe("outline");
    expect(t.shadow).toBe("elevated");
    expect(() => Quiz.parse(out)).not.toThrow();
  });

  it("detects the active variant and round-trips all three", () => {
    expect(detectLayoutVariant(doc())).toBe("classic"); // normal/16/no-split defaults
    for (const v of LAYOUT_VARIANTS) {
      expect(detectLayoutVariant(applyLayoutVariant(doc(), v.id))).toBe(v.id);
    }
    expect(applyLayoutVariant(doc(), "nope")).toEqual(doc()); // unknown id = no-op
  });
});
