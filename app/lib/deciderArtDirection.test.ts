import { describe, expect, it } from "vitest";
import { applyGeneratedArtDirection } from "./deciderArtDirection";
import { Quiz } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";

describe("applyGeneratedArtDirection", () => {
  it("keeps legacy documents byte-identical", () => {
    const legacy = buildSeedQuiz("Legacy");
    expect(applyGeneratedArtDirection(legacy, [{ title: "Snowboard" }])).toBe(legacy);
  });

  it("creates one alpine campaign world for a matching decider catalog", () => {
    const seed = buildSeedQuiz("Find your board");
    const doc = Quiz.parse({ ...seed, logic_model: "decider" });
    const out = applyGeneratedArtDirection(doc, [
      { title: "Deep Powder Snowboard", tags: "mountain, freeride" },
    ]);

    expect(out.design_tokens.art_direction?.id).toBe("alpine-afterglow");
    expect(out.design_tokens.colors?.background).toBe("#F1EEE5");
    expect(out.design_tokens.typography?.heading?.family).toBe("Barlow Condensed");
    const intro = out.nodes.find((node) => node.type === "intro");
    expect(intro && out.node_backgrounds?.[intro.id]?.image_url).toContain("hero.webp");
    expect(Quiz.safeParse(out).success).toBe(true);
  });

  it("does not pretend an unsupported catalog fits the alpine world", () => {
    const seed = buildSeedQuiz("Skin finder");
    const doc = Quiz.parse({ ...seed, logic_model: "decider" });
    expect(applyGeneratedArtDirection(doc, [{ title: "Vitamin C serum" }])).toBe(doc);
  });
});
