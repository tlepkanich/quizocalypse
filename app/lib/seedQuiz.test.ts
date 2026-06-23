import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";

describe("buildSeedQuiz", () => {
  it("produces a valid quiz with an intro + a starter question", () => {
    const doc = buildSeedQuiz("My quiz");
    expect(() => Quiz.parse(doc)).not.toThrow();
    expect(doc.nodes.some((n) => n.type === "intro")).toBe(true);
    expect(doc.nodes.some((n) => n.type === "question")).toBe(true);
    const intro = doc.nodes.find((n) => n.type === "intro");
    expect(intro && intro.type === "intro" && intro.data.headline).toBe("My quiz");
  });

  it("seeds the starter question with an sb_ id so Smart Build can replace it", () => {
    const doc = buildSeedQuiz("X");
    expect(doc.nodes.some((n) => n.type === "question" && n.id.startsWith("sb_"))).toBe(true);
  });

  it("falls back to a default headline on empty name", () => {
    const doc = buildSeedQuiz("   ");
    const intro = doc.nodes.find((n) => n.type === "intro");
    expect(intro && intro.type === "intro" && intro.data.headline).toBe("Find your match");
  });

  it("strips an auto-name date so the shopper headline reads clean (name keeps it)", () => {
    const doc = buildSeedQuiz("The Skin Science Diagnostic 6/22/26");
    const intro = doc.nodes.find((n) => n.type === "intro");
    expect(intro && intro.type === "intro" && intro.data.headline).toBe("The Skin Science Diagnostic");
  });
});
