import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { orderFlow } from "./flowOrder";
import { validateQuiz } from "./quizValidation";
import { buildDemoQuiz } from "./demoQuiz";

const FB = "gid://shopify/Collection/42";

describe("buildDemoQuiz", () => {
  it("is Quiz.parse-valid and has no validation blockers (publish-ready)", () => {
    const doc = buildDemoQuiz(FB);
    expect(() => Quiz.parse(doc)).not.toThrow();
    expect(validateQuiz(doc)).toEqual([]);
  });

  it("has no unreachable steps", () => {
    expect(orderFlow(buildDemoQuiz(FB)).orphans).toEqual([]);
  });

  it("showcases the feature set", () => {
    const doc = buildDemoQuiz(FB);
    const types = doc.nodes.map((n) => (n.type === "question" ? n.data.question_type : n.type));
    // mixed question types + email gate + ab branch + 2 results
    expect(types).toContain("dropdown");
    expect(types).toContain("multi_select");
    expect(doc.nodes.some((n) => n.type === "email_gate" && n.data.collect_phone)).toBe(true);
    expect(doc.nodes.some((n) => n.type === "branch" && n.data.mode === "ab_split")).toBe(true);
    expect(doc.nodes.filter((n) => n.type === "result")).toHaveLength(2);
    // a discounted result + a multi-stage result
    expect(doc.nodes.some((n) => n.type === "result" && n.data.include_discount)).toBe(true);
    expect(doc.nodes.some((n) => n.type === "result" && n.data.stages.length >= 2)).toBe(true);
    // quiz-level discount enabled
    expect(doc.discount_config.enabled).toBe(true);
  });

  it("injects the fallback collection into both result pages", () => {
    const doc = buildDemoQuiz(FB);
    for (const r of doc.nodes.filter((n) => n.type === "result")) {
      expect(r.type === "result" && r.data.fallback_collection_id).toBe(FB);
    }
  });
});
