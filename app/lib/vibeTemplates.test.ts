import { describe, it, expect } from "vitest";
import { VIBE_TEMPLATES, getVibeTemplate, isModifiedFromTemplate } from "./vibeTemplates";
import { DesignTokens } from "./quizSchema";

describe("vibe templates (Design Settings §2)", () => {
  it("defines exactly the 4 spec vibes, each a valid token set carrying its own template_id", () => {
    expect(VIBE_TEMPLATES.map((t) => t.id)).toEqual([
      "clean_editorial",
      "bold_graphic",
      "warm_lifestyle",
      "minimal_technical",
    ]);
    for (const t of VIBE_TEMPLATES) {
      expect(DesignTokens.parse(t.tokens)).toBeTruthy();
      expect(t.tokens.template_id).toBe(t.id);
      expect(t.tokens.style_bar).toBeDefined();
    }
  });

  it("getVibeTemplate resolves by id (and undefined-safe)", () => {
    expect(getVibeTemplate("bold_graphic")?.name).toBe("Bold / Graphic");
    expect(getVibeTemplate(undefined)).toBeUndefined();
    expect(getVibeTemplate("nope")).toBeUndefined();
  });

  it("isModifiedFromTemplate: false for the pristine baseline, true after a token nudge", () => {
    const t = VIBE_TEMPLATES[1]!; // bold_graphic
    expect(isModifiedFromTemplate(t.tokens, t)).toBe(false);
    expect(isModifiedFromTemplate({ ...t.tokens, radius: "pill" }, t)).toBe(true);
    expect(
      isModifiedFromTemplate({ ...t.tokens, style_bar: { ...t.tokens.style_bar, lines: 99 } }, t),
    ).toBe(true);
    // a different template's tokens diverge from THIS template
    expect(isModifiedFromTemplate(VIBE_TEMPLATES[0]!.tokens, t)).toBe(true);
    expect(isModifiedFromTemplate(undefined, t)).toBe(false);
  });
});
