import { describe, expect, it } from "vitest";
import { AI_FEATURES, creditTagText } from "./catalog";

describe("creditTagText", () => {
  it("reads the rate and the unit of one use from the feature list", () => {
    expect(creditTagText("rec_copy")).toBe("AI · 0.2 credit per results page");
    expect(creditTagText("ask_ai")).toBe("AI · 0.1 credit per reply");
  });

  it("gives every per-use AI feature a tag built from its own rate and unit", () => {
    for (const feature of AI_FEATURES) {
      expect(creditTagText(feature.key)).toBe(`AI · ${feature.rate} credit per ${feature.per}`);
    }
  });

  it("never states a dollar amount", () => {
    for (const feature of AI_FEATURES) {
      expect(creditTagText(feature.key)).not.toMatch(/\$|USD/);
    }
  });
});
