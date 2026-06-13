import { describe, it, expect } from "vitest";
import { dialsToBuildDirectives, autoQuizName } from "./dialDirectives";
import { BuildSession, type DesignDials } from "./quizSchema";

const DIALS = (over: Partial<DesignDials> = {}): DesignDials => ({
  imagery: "medium",
  graphics: "medium",
  word_forward: "medium",
  lines: "rounded",
  ...over,
});

describe("dialsToBuildDirectives", () => {
  it("maps the Lines dial directly onto DesignTokens.radius", () => {
    expect(dialsToBuildDirectives(DIALS({ lines: "soft" })).tokenPatch.radius).toBe("pill");
    expect(dialsToBuildDirectives(DIALS({ lines: "sharp" })).tokenPatch.radius).toBe("square");
    expect(dialsToBuildDirectives(DIALS({ lines: "rounded" })).tokenPatch.radius).toBe("rounded");
  });

  it("drives the spacing token from the Graphics dial (high→spacious, low→compact, medium→unset)", () => {
    expect(dialsToBuildDirectives(DIALS({ graphics: "high" })).tokenPatch.spacing).toBe("spacious");
    expect(dialsToBuildDirectives(DIALS({ graphics: "low" })).tokenPatch.spacing).toBe("compact");
    expect(dialsToBuildDirectives(DIALS({ graphics: "medium" })).tokenPatch.spacing).toBeUndefined();
  });

  it("emits a directive line per dial keyed to its level", () => {
    const hi = dialsToBuildDirectives(DIALS({ imagery: "high", word_forward: "high" })).promptDirectives;
    expect(hi).toContain("IMAGERY HIGH");
    expect(hi).toContain("WORD-FORWARD HIGH");
    const lo = dialsToBuildDirectives(DIALS({ imagery: "low", word_forward: "low", graphics: "low" })).promptDirectives;
    expect(lo).toContain("IMAGERY LOW");
    expect(lo).toContain("WORD-FORWARD LOW");
    expect(lo).toContain("GRAPHICS LOW");
  });

  it("always sets a radius, even at all-medium defaults", () => {
    const { tokenPatch } = dialsToBuildDirectives(DIALS());
    expect(tokenPatch.radius).toBe("rounded");
    expect(tokenPatch.spacing).toBeUndefined();
  });
});

describe("autoQuizName", () => {
  it("formats <label> M/D/YY (no leading zeros, 2-digit year)", () => {
    expect(autoQuizName("Skin Routine", new Date(2026, 5, 11))).toBe("Skin Routine 6/11/26");
    expect(autoQuizName("Vitamins", new Date(2026, 11, 1))).toBe("Vitamins 12/1/26");
  });

  it("falls back to 'New quiz' on an empty/blank label", () => {
    expect(autoQuizName("   ", new Date(2026, 0, 5))).toBe("New quiz 1/5/26");
  });
});

describe("BuildSession back-compat (Step 2 fields are additive)", () => {
  it("parses an old Step-1 blob with no Step-2 fields, defaulting the new arrays", () => {
    const old = {
      stage: "templates",
      grouping: { dimension: "collection", confirmed_category_ids: ["c1"], detected_rationale: "x" },
      goal: { goal_text: "help shoppers", struggle_text: "too many specs" },
      template_options: [],
      picked_option_id: "dir-1",
    };
    const parsed = BuildSession.parse(old);
    expect(parsed.stage).toBe("templates"); // legacy stage still valid
    expect(parsed.quiz_types).toEqual([]);
    expect(parsed.rich_templates).toEqual([]);
    expect(parsed.picked_template).toBeUndefined();
  });

  it("accepts the new Step-2 stages", () => {
    for (const stage of ["typing", "types", "templating", "configuring"] as const) {
      expect(BuildSession.parse({ stage }).stage).toBe(stage);
    }
  });
});
