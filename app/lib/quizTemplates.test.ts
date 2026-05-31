import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import {
  TEMPLATES,
  TEMPLATE_LIST,
  buildTemplate,
  buildTemplateQuiz,
  isTemplateId,
  type TemplateId,
} from "./quizTemplates";

const IDS = Object.keys(TEMPLATES) as TemplateId[];
const FB = "gid://shopify/Collection/123";

describe("quiz templates", () => {
  it("exposes the four vertical templates", () => {
    expect(IDS.sort()).toEqual(["clothing", "gifting", "skincare", "vitamins"]);
    expect(TEMPLATE_LIST).toHaveLength(4);
  });

  for (const id of IDS) {
    describe(id, () => {
      it("builds a Quiz.parse-valid doc with intro + ≥3 questions + ≥2 results + a branch", () => {
        const doc = buildTemplate(TEMPLATES[id], FB);
        expect(() => Quiz.parse(doc)).not.toThrow();
        const types = doc.nodes.map((n) => n.type);
        expect(types.filter((t) => t === "intro")).toHaveLength(1);
        expect(types.filter((t) => t === "question").length).toBeGreaterThanOrEqual(3);
        expect(types.filter((t) => t === "result").length).toBeGreaterThanOrEqual(2);
        expect(types.filter((t) => t === "branch")).toHaveLength(1);
      });

      it("injects the fallback collection into every result node", () => {
        const doc = buildTemplate(TEMPLATES[id], FB);
        const results = doc.nodes.filter((n) => n.type === "result");
        for (const r of results) {
          expect(r.type === "result" && r.data.fallback_collection_id).toBe(FB);
          expect(r.type === "result" && r.data.match_ladder).toContain("tag");
        }
      });

      it("every archetype tag is reachable (appears in some answer's tags)", () => {
        const spec = TEMPLATES[id];
        const answerTags = new Set(
          spec.questions.flatMap((q) => q.answers.flatMap((a) => a.tags)),
        );
        for (const arch of spec.archetypes) {
          expect(answerTags.has(arch.tag)).toBe(true);
        }
      });

      it("wires a branch slot+condition edge per archetype plus a default", () => {
        const doc = buildTemplate(TEMPLATES[id], FB);
        const branch = doc.nodes.find((n) => n.type === "branch");
        expect(branch).toBeDefined();
        const spec = TEMPLATES[id];
        // one conditioned edge per archetype + one default
        const branchEdges = doc.edges.filter((e) => e.source === branch!.id);
        expect(branchEdges).toHaveLength(spec.archetypes.length + 1);
        const conditioned = branchEdges.filter((e) => e.condition?.tag);
        expect(conditioned).toHaveLength(spec.archetypes.length);
        const defaultEdge = branchEdges.find((e) => e.source_handle === "sl_default");
        expect(defaultEdge && defaultEdge.condition).toBeUndefined();
      });
    });
  }

  it("uses a placeholder collection when none is provided", () => {
    const doc = buildTemplate(TEMPLATES.skincare, "");
    const result = doc.nodes.find((n) => n.type === "result");
    expect(result && result.type === "result" && result.data.fallback_collection_id).toBe(
      "gid://shopify/Collection/0",
    );
  });

  it("buildTemplateQuiz returns the doc + the template default name", () => {
    const { doc, name } = buildTemplateQuiz("vitamins", FB);
    expect(name).toBe("Build your supplement stack");
    expect(() => Quiz.parse(doc)).not.toThrow();
  });

  it("mints a fresh quiz_id each instantiation", () => {
    expect(buildTemplate(TEMPLATES.gifting, FB).quiz_id).not.toBe(
      buildTemplate(TEMPLATES.gifting, FB).quiz_id,
    );
  });

  it("isTemplateId guards unknown ids", () => {
    expect(isTemplateId("skincare")).toBe(true);
    expect(isTemplateId("nope")).toBe(false);
  });
});
