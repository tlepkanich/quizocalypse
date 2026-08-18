// GEN-GROUND — the deterministic topical guards, tested against the strings
// from the real 2026-08-16 incident (pet-titled quiz over outdoor buckets).
import { describe, expect, it } from "vitest";
import {
  contentTokens,
  directionMatchesGrounding,
  researchCoversFocus,
} from "./groundingGuard";

const OUTDOOR_GROUNDING = [
  "Northbound Supply",
  "hiking trail-running backpacking ski-touring winter paddling camping",
  "ultralight lightweight standard summer three-season hiking-boot rain-shell",
  "Help shoppers find the right product for their needs by matching their answers to the best fit across your Northbound Supply collections.",
].join(" ");

describe("contentTokens", () => {
  it("drops quiz-generic and function words, keeps category words", () => {
    const t = contentTokens("Pet Life Stage & Health Finder — a quiz matching your needs");
    expect(t.has("pet")).toBe(true);
    expect(t.has("health")).toBe(true);
    expect(t.has("finder")).toBe(false);
    expect(t.has("quiz")).toBe(false);
    expect(t.has("matching")).toBe(false);
    expect(t.has("your")).toBe(false);
  });

  it("plural-trims so boots matches boot", () => {
    const a = contentTokens("hiking boots");
    const b = contentTokens("boot for hiking");
    expect(a.has("boot") && b.has("boot")).toBe(true);
  });
});

describe("directionMatchesGrounding", () => {
  it("flags the incident: pet direction over outdoor buckets", () => {
    expect(
      directionMatchesGrounding(
        "Pet Life Stage & Health Finder — Clinical Route Lead with precise life-stage and breed-size classification, then pivot to health goals for formula precision.",
        OUTDOOR_GROUNDING,
      ),
    ).toBe(false);
  });

  it("passes a genuinely grounded direction", () => {
    expect(
      directionMatchesGrounding(
        "Snowboard Skill & Terrain Match — pick the board for your riding style",
        "Snowboards all-mountain park powder carve beginner Help riders find a board",
      ),
    ).toBe(true);
  });

  it("passes when the overlap is a category word from the tags", () => {
    expect(
      directionMatchesGrounding("Winter Layering Kit Builder", OUTDOOR_GROUNDING),
    ).toBe(true);
  });

  it("sparse direction (too little signal to judge) passes", () => {
    expect(directionMatchesGrounding("Concern?", OUTDOOR_GROUNDING)).toBe(true);
  });

  it("sparse grounding (no buckets/tags/goal to speak of) passes", () => {
    expect(
      directionMatchesGrounding("Pet Life Stage & Health Finder", "misc things"),
    ).toBe(true);
  });
});

describe("researchCoversFocus", () => {
  const PET_RESEARCH =
    "# Product-Recommendation Quiz Best Practices: Pet Nutrition & Functional Skincare\n" +
    "Typical question counts by quiz type. Pet nutrition quizzes succeed by leading with species and life stage. " +
    "Skincare quizzes can stretch to 8-9 questions when each one changes the recommendation.";

  it("flags the incident: pet research does not cover an outdoor focus", () => {
    expect(
      researchCoversFocus(PET_RESEARCH, {
        goal: "Help shoppers find the right product across your Northbound Supply collections.",
        bucket_names: ["Northbound Supply"],
      }),
    ).toBe(false);
  });

  it("covers a same-category focus", () => {
    expect(
      researchCoversFocus(PET_RESEARCH, {
        goal: "Route dog owners to the right nutrition formula",
        bucket_names: ["Puppy", "Adult", "Senior nutrition"],
      }),
    ).toBe(true);
  });

  it("an empty focus can't be judged and passes", () => {
    expect(researchCoversFocus(PET_RESEARCH, { goal: "", bucket_names: [] })).toBe(true);
  });
});
