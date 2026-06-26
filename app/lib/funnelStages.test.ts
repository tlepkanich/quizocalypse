import { describe, expect, it } from "vitest";
import {
  FUNNEL_STEPS,
  TOTAL_STEPS,
  stepForStage,
  stepNumber,
  labelForStage,
  nextStep,
  prevStep,
} from "./funnelStages";

describe("funnelStages", () => {
  it("declares the re-sequenced 7-step order", () => {
    expect(FUNNEL_STEPS.map((s) => s.stage)).toEqual([
      "grouping",
      "shape",
      "question_builder",
      "rec_page",
      "design",
      "overview",
      "generate",
    ]);
    expect(TOTAL_STEPS).toBe(7);
  });

  it("maps new stages to themselves", () => {
    for (const s of FUNNEL_STEPS) {
      expect(stepForStage(s.stage)).toBe(s.stage);
    }
  });

  it("folds legacy + transient stages onto their visible step", () => {
    expect(stepForStage("goal")).toBe("shape");
    expect(stepForStage("typing")).toBe("shape");
    expect(stepForStage("types")).toBe("shape"); // the four-card lived here
    expect(stepForStage("templating")).toBe("shape");
    expect(stepForStage("configuring")).toBe("shape"); // battle card
    expect(stepForStage("templates")).toBe("shape");
    expect(stepForStage("done")).toBe("generate");
    expect(stepForStage("generating")).toBe("generate");
  });

  it("defaults an unknown stage to the first step", () => {
    expect(stepForStage("nonsense")).toBe("grouping");
  });

  it("numbers steps 1-based for 'Step N of M'", () => {
    expect(stepNumber("grouping")).toBe(1);
    expect(stepNumber("shape")).toBe(2);
    expect(stepNumber("goal")).toBe(2); // folds to shape
    expect(stepNumber("question_builder")).toBe(3);
    expect(stepNumber("rec_page")).toBe(4);
    expect(stepNumber("design")).toBe(5);
    expect(stepNumber("overview")).toBe(6);
    expect(stepNumber("generate")).toBe(7);
  });

  it("resolves labels through the fold", () => {
    expect(labelForStage("grouping")).toBe("Product Buckets");
    expect(labelForStage("configuring")).toBe("Shape Your Quiz");
    expect(labelForStage("done")).toBe("Generate");
  });

  it("navigates between visible steps and stops at the ends", () => {
    expect(nextStep("grouping")).toBe("shape");
    expect(nextStep("shape")).toBe("question_builder");
    expect(nextStep("generate")).toBeNull();
    expect(nextStep("configuring")).toBe("question_builder"); // from shape
    expect(prevStep("grouping")).toBeNull();
    expect(prevStep("shape")).toBe("grouping");
    expect(prevStep("rec_page")).toBe("question_builder");
  });
});
