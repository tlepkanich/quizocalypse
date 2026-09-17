import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { buildSeedQuiz, seedIntroBestPractice, SEED_INTRO_SUBTEXT } from "./seedQuiz";

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

// Owner 2026-09-16 — intro pages are optional + best-practice copy at funnel
// graduation. These pin the upgrade's guardrails: only the untouched seed
// subtext upgrades, question count and discount drive the copy, and the new
// IntroData.hidden flag round-trips without rewriting legacy docs.

const question = (id: string) => ({
  id,
  type: "question" as const,
  position: { x: 0, y: 0 },
  data: {
    text: `Question ${id}`,
    question_type: "single_select" as const,
    answers: [
      { id: `${id}a`, text: "A", edge_handle_id: `${id}ha`, tags: [] },
      { id: `${id}b`, text: "B", edge_handle_id: `${id}hb`, tags: [] },
    ],
  },
});

function fixture(questions: number, over: Record<string, unknown> = {}) {
  const qs = Array.from({ length: questions }, (_, i) => question(`q${i + 1}`));
  return Quiz.parse({
    quiz_id: "seed-test",
    scope: { collection_ids: [] },
    nodes: [
      {
        id: "intro",
        type: "intro",
        position: { x: 0, y: 0 },
        data: { headline: "Find your match", subtext: SEED_INTRO_SUBTEXT },
      },
      ...qs,
    ],
    edges: qs.map((q, i) => ({
      id: `e${i}`,
      source: i === 0 ? "intro" : qs[i - 1]!.id,
      target: q.id,
    })),
    ...over,
  });
}

const introSubtext = (doc: Quiz) => {
  const n = doc.nodes.find((x) => x.type === "intro");
  return n?.type === "intro" ? n.data.subtext : null;
};

describe("seedIntroBestPractice", () => {
  it("upgrades the untouched seed subtext to the question-count pattern", () => {
    expect(introSubtext(seedIntroBestPractice(fixture(5)))).toBe(
      "5 questions – 1 minute.",
    );
  });

  it("longer quizzes say 2 minutes; a single question is singular", () => {
    expect(introSubtext(seedIntroBestPractice(fixture(9)))).toBe(
      "9 questions – 2 minutes.",
    );
    expect(introSubtext(seedIntroBestPractice(fixture(1)))).toBe(
      "1 question – 1 minute.",
    );
  });

  it("appends the discount hook when a percentage discount is configured", () => {
    const doc = fixture(5, {
      discount_config: { enabled: true, kind: "percentage", value: 15 },
    });
    expect(introSubtext(seedIntroBestPractice(doc))).toBe(
      "5 questions – 1 minute. Unlock your 15% discount at the end!",
    );
  });

  it("non-percentage discounts get the generic hook", () => {
    const doc = fixture(3, {
      discount_config: { enabled: true, kind: "free_shipping" },
    });
    expect(introSubtext(seedIntroBestPractice(doc))).toBe(
      "3 questions – 1 minute. Unlock your discount at the end!",
    );
  });

  it("NEVER rewrites a merchant-edited subtext (returns the same doc object)", () => {
    const doc = fixture(5);
    const edited = {
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === "intro" ? { ...n, data: { ...n.data, subtext: "My own words" } } : n,
      ),
    } as Quiz;
    expect(seedIntroBestPractice(edited)).toBe(edited);
  });

  it("a doc with zero questions stays untouched", () => {
    const doc = Quiz.parse({
      quiz_id: "seed-test-noq",
      scope: { collection_ids: [] },
      nodes: [
        {
          id: "intro",
          type: "intro",
          position: { x: 0, y: 0 },
          data: { headline: "Find your match", subtext: SEED_INTRO_SUBTEXT },
        },
        { id: "m", type: "message", position: { x: 0, y: 0 }, data: { text: "Hi" } },
      ],
      edges: [{ id: "e0", source: "intro", target: "m" }],
    });
    expect(seedIntroBestPractice(doc)).toBe(doc);
  });

  it("buildSeedQuiz seeds the recognisable subtext", () => {
    expect(introSubtext(buildSeedQuiz("Test"))).toBe(SEED_INTRO_SUBTEXT);
  });
});

describe("IntroData.hidden", () => {
  it("is optional — parsing a legacy intro adds NO hidden key (byte-identical round-trip)", () => {
    const parsed = fixture(2);
    const intro = parsed.nodes.find((n) => n.type === "intro");
    expect(intro && "hidden" in intro.data).toBe(false);
  });

  it("round-trips hidden: true", () => {
    const doc = fixture(2);
    const withHidden = Quiz.parse({
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type === "intro" ? { ...n, data: { ...n.data, hidden: true } } : n,
      ),
    });
    const intro = withHidden.nodes.find((n) => n.type === "intro");
    expect(intro?.type === "intro" && intro.data.hidden).toBe(true);
  });
});
