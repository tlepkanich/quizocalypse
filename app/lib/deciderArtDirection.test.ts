import { describe, expect, it } from "vitest";
import { BrandIdentity } from "./brandIdentity";
import { applyGeneratedArtDirection } from "./deciderArtDirection";
import { findContrastIssues } from "./designTokens";
import { Quiz, QuestionType, type ExperienceType } from "./quizSchema";
import { buildSeedQuiz } from "./seedQuiz";
import { getPreset } from "./themePresets";

const EXPERIENCES: ExperienceType[] = [
  "product_match",
  "personality",
  "lead_capture",
  "survey",
];

function decider(name: string, experience: ExperienceType = "product_match") {
  return Quiz.parse({ ...buildSeedQuiz(name, experience), logic_model: "decider" });
}

function identityWith(colors: { primary?: string; secondary?: string }, source = "shop_brand") {
  const preset = getPreset("minimal")!;
  return BrandIdentity.parse({
    summary: "A test identity",
    design: {
      suggested_theme_preset_id: "minimal",
      suggested_layout_variant_id: "classic",
      derived_tokens: {
        ...preset.tokens,
        colors: { ...preset.tokens.colors, ...colors },
      },
    },
    positioning: {},
    updated_at: "2026-07-16T00:00:00.000Z",
    sources: [{ kind: source, detail: "", at: "2026-07-16T00:00:00.000Z" }],
  });
}

describe("applyGeneratedArtDirection", () => {
  it("keeps legacy documents byte-identical", () => {
    const legacy = buildSeedQuiz("Legacy");
    expect(
      applyGeneratedArtDirection(legacy, [{ title: "Snowboard" }], { quizId: "quiz-a" }),
    ).toBe(legacy);
  });

  it("keeps the vetted alpine campaign for a matching catalog", () => {
    const out = applyGeneratedArtDirection(
      decider("Find your board"),
      [{ title: "Deep Powder Snowboard", tags: "mountain, freeride" }],
      { quizId: "quiz-alpine" },
    );

    expect(out.design_tokens.art_direction?.id).toBe("alpine-afterglow");
    expect(out.design_tokens.colors?.background).toBe("#F1EEE5");
    expect(out.design_tokens.typography?.heading?.family).toBe("Barlow Condensed");
    expect(findContrastIssues(out.design_tokens)).toEqual([]);
    const intro = out.nodes.find((node) => node.type === "intro");
    expect(intro && out.node_backgrounds?.[intro.id]?.image_url).toContain("hero.webp");
    expect(Quiz.safeParse(out).success).toBe(true);
  });

  it("varies the alpine crop and accent by quiz id without changing its campaign family", () => {
    const doc = decider("Find your board");
    const first = applyGeneratedArtDirection(doc, [{ title: "Snowboard" }], {
      quizId: "alpine-sibling-001",
    });
    const sibling = applyGeneratedArtDirection(doc, [{ title: "Snowboard" }], {
      quizId: "alpine-sibling-002",
    });
    expect(first.design_tokens.art_direction?.id).toBe("alpine-afterglow");
    expect(sibling.design_tokens.art_direction?.id).toBe("alpine-afterglow");
    expect(sibling.design_tokens.art_direction?.seed).not.toBe(
      first.design_tokens.art_direction?.seed,
    );
    expect(sibling.node_backgrounds?.intro?.focal_x).not.toBe(
      first.node_backgrounds?.intro?.focal_x,
    );
  });

  it.each(EXPERIENCES)("art-directs the %s experience", (experience) => {
    const out = applyGeneratedArtDirection(decider(`Fresh ${experience}`, experience), [], {
      quizId: `quiz-${experience}`,
    });

    expect(out.design_tokens.art_direction).toBeDefined();
    expect(out.design_tokens.chrome).toBe("minimal");
    expect(Object.keys(out.node_backgrounds ?? {})).toHaveLength(out.nodes.length);
    expect(findContrastIssues(out.design_tokens)).toEqual([]);
    expect(Quiz.safeParse(out).success).toBe(true);
  });

  it("is stable for one quiz id and visibly varies sibling quiz ids", () => {
    const doc = decider("Sibling quiz", "personality");
    const first = applyGeneratedArtDirection(doc, [], { quizId: "quiz-sibling-001" });
    const rerender = applyGeneratedArtDirection(doc, [], { quizId: "quiz-sibling-001" });
    const sibling = applyGeneratedArtDirection(doc, [], { quizId: "quiz-sibling-002" });

    expect(rerender).toEqual(first);
    expect(sibling.design_tokens.art_direction?.seed).not.toBe(
      first.design_tokens.art_direction?.seed,
    );
    expect({
      colors: sibling.design_tokens.colors,
      type: sibling.design_tokens.typography,
      direction: sibling.design_tokens.art_direction,
    }).not.toEqual({
      colors: first.design_tokens.colors,
      type: first.design_tokens.typography,
      direction: first.design_tokens.art_direction,
    });
  });

  it.each(QuestionType.options)("covers the %s question renderer", (questionType) => {
    const seed = decider(`A ${questionType} quiz`);
    const doc = Quiz.parse({
      ...seed,
      nodes: seed.nodes.map((node) =>
        node.type === "question"
          ? {
              ...node,
              data: {
                ...node.data,
                question_type: questionType,
                answers: node.data.answers.map((answer, index) => ({
                  ...answer,
                  image_url: `https://cdn.example.com/answer-${index}.jpg`,
                })),
              },
            }
          : node,
      ),
    });
    const out = applyGeneratedArtDirection(doc, [], { quizId: `quiz-type-${questionType}` });
    const question = out.nodes.find((node) => node.type === "question");

    expect(question?.data.answer_display).toBeDefined();
    if (
      question &&
      (questionType === "image_tile" || questionType === "image_picker" || questionType === "swatch")
    ) {
      expect(question.data.answers.every((answer) => Boolean(answer.image_url))).toBe(true);
      expect(question.data.answer_display?.show_media).toBe(true);
    } else if (question) {
      expect(question.data.answers.every((answer) => answer.image_url === undefined)).toBe(true);
    }
    expect(Quiz.safeParse(out).success).toBe(true);
  });

  it("ignores a pure preset copy even when the identity has brand provenance", () => {
    const presetCopy = identityWith({});
    const baseline = applyGeneratedArtDirection(decider("Brand guard"), [], {
      quizId: "quiz-brand-guard",
    });
    const withPresetCopy = applyGeneratedArtDirection(decider("Brand guard"), [], {
      quizId: "quiz-brand-guard",
      brandIdentity: presetCopy,
    });
    expect(withPresetCopy.design_tokens.colors).toEqual(baseline.design_tokens.colors);
  });

  it("uses a real brand color signal and darkens it when white labels need help", () => {
    const identity = identityWith({ primary: "#59C7D3", secondary: "#335577" });
    const out = applyGeneratedArtDirection(decider("Real brand"), [], {
      quizId: "quiz-real-brand",
      brandIdentity: identity,
    });

    expect(out.design_tokens.colors?.primary).not.toBe("#59C7D3");
    expect(out.design_tokens.colors?.secondary).toBe("#335577");
    expect(findContrastIssues(out.design_tokens)).toEqual([]);
  });

  it("does not treat a catalog-only derived-token change as brand color evidence", () => {
    const catalogOnly = identityWith({ primary: "#123456" }, "catalog");
    const baseline = applyGeneratedArtDirection(decider("Provenance guard"), [], {
      quizId: "quiz-provenance-guard",
    });
    const out = applyGeneratedArtDirection(decider("Provenance guard"), [], {
      quizId: "quiz-provenance-guard",
      brandIdentity: catalogOnly,
    });
    expect(out.design_tokens.colors).toEqual(baseline.design_tokens.colors);
  });

  it("keeps every generated palette on all four contrast axes", () => {
    for (let i = 0; i < 160; i += 1) {
      const out = applyGeneratedArtDirection(decider(`Contrast ${i}`, EXPERIENCES[i % 4]), [], {
        quizId: `quiz-contrast-${i}`,
      });
      expect(findContrastIssues(out.design_tokens), `seed ${i}`).toEqual([]);
    }
  });
});
