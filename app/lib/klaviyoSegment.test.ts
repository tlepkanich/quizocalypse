import { describe, expect, it } from "vitest";
import { defaultSegmentName, segmentDefinition, segmentRules, type SegmentSpec } from "./klaviyoSegment";
import { listActionFor, profileAnswerProperties, questionPropertyName } from "./klaviyoProfile";

const IDS = { completedQuiz: "M_quiz", placedOrder: "M_order", addedToCart: "M_atc", startedCheckout: "M_co" };
const base = (over: Partial<SegmentSpec>): SegmentSpec => ({
  quizId: "qz1",
  quizName: "Skin quiz",
  facet: { kind: "all" },
  status: "all",
  ...over,
});
type Group = { conditions: Array<Record<string, unknown>> };
const groups = (spec: SegmentSpec) => (segmentDefinition(spec, IDS).condition_groups as Group[]);

describe("segmentDefinition", () => {
  it("every segment requires email marketing consent, whatever else it holds", () => {
    for (const status of ["all", "bought", "added", "no-purchase"] as const) {
      const g = groups(base({ status }));
      expect(g.at(-1)!.conditions[0]).toEqual({
        type: "profile-marketing-consent",
        consent: { channel: "email", can_receive_marketing: true, consent_status: { subscription: "subscribed" } },
      });
    }
  });

  it("an answer is a filter on THIS quiz's Completed Quiz event", () => {
    const g = groups(base({ facet: { kind: "answer", questionText: "Skin type?", answerText: "Dry" } }));
    expect(g[0]!.conditions[0]).toMatchObject({
      type: "profile-metric",
      metric_id: "M_quiz",
      measurement: "count",
      measurement_filter: { type: "numeric", operator: "greater-than", value: 0 },
      timeframe_filter: { type: "date", operator: "alltime" },
      metric_filters: [
        { property: "quiz_id", filter: { type: "string", operator: "equals", value: "qz1" } },
        { property: "Skin type?", filter: { type: "list", operator: "contains-any", value: ["Dry"] } },
      ],
    });
  });

  it("Added, not bought = an add to cart and no order in the window", () => {
    const g = groups(base({ status: "added" }));
    expect(g).toHaveLength(4);
    expect(g[1]!.conditions[0]).toMatchObject({ metric_id: "M_atc", measurement_filter: { operator: "greater-than", value: 0 } });
    expect(g[2]!.conditions[0]).toMatchObject({
      metric_id: "M_order",
      measurement_filter: { operator: "equals", value: 0 },
      timeframe_filter: { type: "date", operator: "in-the-last", unit: "day", quantity: 14 },
    });
  });

  it("a status without its metric id throws rather than build a looser segment", () => {
    expect(() => segmentDefinition(base({ status: "bought" }), { completedQuiz: "M_quiz" })).toThrow();
  });
});

describe("segmentRules + name", () => {
  it("lists the rules in the merchant's words, ending with consent", () => {
    expect(segmentRules(base({ facet: { kind: "result", resultName: "Hydrating set" }, status: "bought" }))).toEqual([
      "Took the quiz “Skin quiz”",
      "Got the result “Hydrating set”",
      "Placed an order in the last 14 days",
      "Can receive email marketing",
    ]);
    expect(defaultSegmentName("Dry", "added")).toBe("Wiskr · Dry · Added, not bought");
    expect(defaultSegmentName("All contacts", "all")).toBe("Wiskr · All contacts");
  });
});

describe("profile data", () => {
  it("adds a readable property per answer next to the quiz_q_<id> key", () => {
    expect(
      profileAnswerProperties([{ question_id: "q1", question_text: "Skin type?", answer_texts: ["Dry", "Oily"] }]),
    ).toEqual({ quiz_q_q1: "Dry, Oily", "Skin type?": "Dry, Oily" });
  });

  it("a question can't overwrite a reserved or quiz_ property", () => {
    expect(questionPropertyName("Email")).toBe("Email (quiz)");
    expect(questionPropertyName("quiz_result")).toBe("quiz_result (quiz)");
    expect(questionPropertyName("  ")).toBe("Quiz question");
  });

  it("consent decides the list", () => {
    expect(listActionFor(true)).toBe("subscribe");
    expect(listActionFor(false)).toBe("skip");
    expect(listActionFor(null)).toBe("add_profile");
  });
});
