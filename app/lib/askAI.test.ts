import { describe, expect, it } from "vitest";
import { buildAskAISystem } from "./claude";

describe("buildAskAISystem", () => {
  it("includes persona name in the role line", () => {
    const out = buildAskAISystem({
      systemPrompt: "Be brief.",
      personaName: "Iris",
      quizContext: "- Q: skin? → Oily",
      catalogSummary: "- Oil-Free Cleanser (handle: ofc) — tags: [oily]",
    });
    expect(out).toMatch(/You are "Iris"/);
  });

  it("falls through merchant prompt verbatim", () => {
    const out = buildAskAISystem({
      systemPrompt: "Always end with a question.",
      personaName: "Iris",
      quizContext: "",
      catalogSummary: "",
    });
    expect(out).toContain("Always end with a question.");
  });

  it("notes when no quiz answers exist yet", () => {
    const out = buildAskAISystem({
      systemPrompt: "x",
      personaName: "x",
      quizContext: "",
      catalogSummary: "",
    });
    expect(out).toContain("(no quiz answers yet)");
  });

  it("includes both the catalog and safety rules sections", () => {
    const out = buildAskAISystem({
      systemPrompt: "x",
      personaName: "x",
      quizContext: "x",
      catalogSummary: "- A Product (handle: ap)",
    });
    expect(out).toContain("PRODUCT CATALOG");
    expect(out).toContain("- A Product (handle: ap)");
    expect(out).toContain("SAFETY RULES");
  });
});
