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

  it("uses authored decider questions instead of a generic intro, without changing the doc", () => {
    const doc = {
      logic_model: "decider",
      nodes: [
        { type: "intro", data: { headline: "New quiz" } },
        { type: "question", data: {
          text: "Where do you ride?", question_type: "image_tile",
          answers: ["Powder", "Park", "Groomers", "Everywhere"].map((text) => ({ text, image_url: `https://example.com/${text}.jpg` })),
        } },
      ],
    };
    const before = JSON.stringify(doc);
    const thumb = quizCardFacts(doc).thumb;
    expect(thumb.isNew).toBe(false);
    expect(thumb.headline).toBe("Where do you ride?");
    expect(thumb.question?.answers.map((a) => a.text)).toEqual(["Powder", "Park", "Groomers"]);
    expect(thumb.question?.remainingAnswers).toBe(1);
    expect(thumb.question?.tiles).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
    expect(quizCardFacts({ ...doc, logic_model: undefined }).thumb.question).toBeUndefined();
    expect(quizCardFacts({ ...doc, logic_model: undefined }).thumb.headline).toBe("New quiz");
  });

  it("skips unfinished questions and respects hidden answer media", () => {
    const thumb = quizCardFacts({ logic_model: "decider", nodes: [
      { type: "question", data: { text: "", question_type: "text" } },
      { type: "question", data: {
        text: "Your style?", question_type: "image_picker",
        answer_display: { show_media: false },
        answers: [null, { text: "Classic", image_url: "https://example.com/classic.jpg" }],
      } },
    ] }).thumb;
    expect(thumb.question?.text).toBe("Your style?");
    expect(thumb.question?.answers).toEqual([{ text: "Classic", imageUrl: undefined }]);
    expect(thumb.question?.tiles).toBe(false);
  });

  it("keeps freeform input metadata and drops unsafe image URLs", () => {
    const thumb = quizCardFacts({ logic_model: "decider", nodes: [
      { type: "question", data: {
        text: "What is your name?", question_type: "text",
        image_url: "file:///private/image.png", input_config: { placeholder: "First name" }, answers: [],
      } },
    ] }).thumb;
    expect(thumb.question?.type).toBe("text");
    expect(thumb.question?.placeholder).toBe("First name");
    expect(thumb.question?.imageUrl).toBeUndefined();
  });
});
