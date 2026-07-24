// FIX-1 — anti-slop generation standards: the prompt rules, the deterministic
// stripEmoji sanitizer, and the parse-boundary proof that an emoji-laden AI
// response lands clean (question + answer text only — tags/urls untouched).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClientModule from "./client";
import {
  QUESTION_WRITING_RULES,
  stripEmoji,
  generateQuestionFlow,
  regenerateQuestion,
} from "./generation";

const createMessageMock = vi.hoisted(() => vi.fn());
vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, createMessage: createMessageMock };
});

describe("QUESTION_WRITING_RULES — anti-slop copy standards in the prompt", () => {
  it("bans emoji, exclamation enthusiasm, and Title Case; demands sentence case", () => {
    expect(QUESTION_WRITING_RULES).toContain("NEVER use emoji");
    expect(QUESTION_WRITING_RULES).toContain("exclamation-mark enthusiasm");
    expect(QUESTION_WRITING_RULES).toContain("sentence case");
    expect(QUESTION_WRITING_RULES).toContain("never Title Case");
  });

  it("keeps the AUDIT-21 survey-methodology rules intact (additive, not a rewrite)", () => {
    expect(QUESTION_WRITING_RULES).toContain("double-barreled");
    expect(QUESTION_WRITING_RULES).toContain("mutually exclusive and collectively exhaustive");
    expect(QUESTION_WRITING_RULES).toContain("at most 7 options");
    expect(QUESTION_WRITING_RULES).toContain("max_selections");
  });
});

describe("stripEmoji — deterministic pictograph sanitizer", () => {
  it("strips plain emoji and collapses the doubled space they leave", () => {
    expect(stripEmoji("Find your ride 🏂")).toBe("Find your ride");
    expect(stripEmoji("Ready? 🎉🎊 Pick a board")).toBe("Ready? Pick a board");
    expect(stripEmoji("✨ Glow routine ✨")).toBe("Glow routine");
  });

  it("strips ZWJ sequences, skin tones, flags, and keycaps as whole units", () => {
    expect(stripEmoji("For the 👨‍👩‍👧‍👦 family")).toBe("For the family");
    expect(stripEmoji("Wave 👋🏽 hello")).toBe("Wave hello");
    expect(stripEmoji("Made in 🇺🇸 factories")).toBe("Made in factories");
    expect(stripEmoji("Option 1️⃣ first")).toBe("Option first");
  });

  it("keeps accents, CJK, and legitimate symbols (& % $ ° – © ® ™)", () => {
    expect(stripEmoji("Café & crème brûlée – 50% off, 10° flex, $20")).toBe(
      "Café & crème brûlée – 50% off, 10° flex, $20",
    );
    expect(stripEmoji("初心者向けのボード")).toBe("初心者向けのボード");
    expect(stripEmoji("GORE-TEX® shell™ ©2026")).toBe("GORE-TEX® shell™ ©2026");
  });

  it("never collapses an all-emoji string to empty", () => {
    expect(stripEmoji("🎉🎉")).toBe("🎉🎉");
  });
});

const toolResponse = (name: string, input: unknown) => ({
  content: [{ type: "tool_use", id: "t1", name, input }],
});

beforeEach(() => {
  createMessageMock.mockReset();
});

describe("generation parse boundary — emoji-laden AI output lands clean", () => {
  it("generateQuestionFlow strips emoji from question + answer text only", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_question_flow", {
        questions: [
          {
            text: "How do you like to ride? 🏂✨",
            question_type: "single_select",
            answers: [
              { text: "Carving groomers 🎿", tags: ["carve"] },
              { text: "Park & freestyle", tags: ["park"] },
            ],
          },
        ],
      }),
    );
    const flow = await generateQuestionFlow({
      goalPrompt: "match boards",
      questionCount: 1,
      catalogSummary: "tags: carve, park",
      buckets: [{ id: "b1", name: "Carvers", tags: ["carve"] }],
      flow: { welcome_message: false, email_gate: false, mixed_input_types: false },
      tone: "friendly",
    });
    const q = flow.questions[0];
    if (!q) throw new Error("no question emitted");
    expect(q.text).toBe("How do you like to ride?");
    expect(q.answers.map((a) => a.text)).toEqual(["Carving groomers", "Park & freestyle"]);
    // Routing data is untouched by the sanitizer.
    expect(q.answers[0]?.tags).toEqual(["carve"]);
  });

  it("regenerateQuestion strips emoji from the regenerated copy", async () => {
    createMessageMock.mockResolvedValueOnce(
      toolResponse("emit_question", {
        text: "What's your skin goal? 💖",
        question_type: "single_select",
        answers: [
          { text: "Hydration 💧", tags: ["dry"] },
          { text: "Oil control", tags: ["oily"] },
        ],
      }),
    );
    const regen = await regenerateQuestion({
      catalogSummary: "tags: dry, oily",
      existingQuestion: {
        text: "What's your skin goal?",
        question_type: "single_select",
        required: true,
        answers: [
          { id: "a1", text: "Hydration", tags: ["dry"] },
          { id: "a2", text: "Oil control", tags: ["oily"] },
        ],
      } as never,
      steeringPrompt: "",
    });
    expect(regen.text).toBe("What's your skin goal?");
    expect(regen.answers.map((a) => a.text)).toEqual(["Hydration", "Oil control"]);
  });
});
