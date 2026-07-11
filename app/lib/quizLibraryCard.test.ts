import { describe, it, expect } from "vitest";
import { quizCardFacts } from "./quizLibraryCard";

describe("§R-7 quizCardFacts", () => {
  it("counts questions and distinct persona targets, reads the intro thumb", () => {
    const doc = {
      nodes: [
        { type: "intro", data: { headline: "Find your match", button_label: "Begin" } },
        { type: "question", data: { answers: [{ target_id: "g1" }, { target_id: "g2" }] } },
        { type: "question", data: { answers: [{ target_id: "g1" }, { target_id: "g3" }] } },
      ],
      design_tokens: { colors: { primary: "#123456", background: "#ffffff", text: "#000000" } },
    };
    const f = quizCardFacts(doc);
    expect(f.questions).toBe(2);
    expect(f.personas).toBe(3); // g1,g2,g3 deduped
    expect(f.thumb.headline).toBe("Find your match");
    expect(f.thumb.buttonLabel).toBe("Begin");
    expect(f.thumb.primary).toBe("#123456");
  });

  it("falls back to result-node count when no answer targets exist", () => {
    const doc = {
      nodes: [
        { type: "intro", data: {} },
        { type: "question", data: { answers: [{}, {}] } },
        { type: "result", data: {} },
        { type: "result", data: {} },
      ],
    };
    const f = quizCardFacts(doc);
    expect(f.questions).toBe(1);
    expect(f.personas).toBe(2);
    expect(f.thumb.headline).toBe("New quiz");
    expect(f.thumb.buttonLabel).toBe("Start");
  });

  it("never throws on a junk/empty doc (defensive — cosmetic facts)", () => {
    expect(quizCardFacts(null).questions).toBe(0);
    expect(quizCardFacts(undefined).personas).toBe(0);
    expect(quizCardFacts({ nodes: "not-an-array" }).questions).toBe(0);
    expect(quizCardFacts(42).thumb.headline).toBe("New quiz");
  });
});
