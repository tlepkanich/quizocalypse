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
  it("declares the 5-step order (Shape retired — FLOW-3; Logic added — one-line-chrome)", () => {
    expect(FUNNEL_STEPS.map((s) => s.stage)).toEqual([
      "grouping",
      "question_builder",
      "logic",
      "rec_page",
      "design",
    ]);
    expect(TOTAL_STEPS).toBe(5);
  });

  it("maps visible stages to themselves", () => {
    for (const s of FUNNEL_STEPS) {
      expect(stepForStage(s.stage)).toBe(s.stage);
    }
  });

  it("routes the retired shape family FORWARD onto Questions", () => {
    // Parse compatibility: an in-flight draft parked at ANY shape-family stage
    // (the legacy picker or a transient AI pass) resolves forward onto the
    // Questions step, never off the bar and never backwards.
    expect(stepForStage("shape")).toBe("question_builder");
    expect(stepForStage("goal")).toBe("question_builder");
    expect(stepForStage("typing")).toBe("question_builder");
    expect(stepForStage("types")).toBe("question_builder"); // the Shape picker lived here
    expect(stepForStage("templating")).toBe("question_builder");
    expect(stepForStage("configuring")).toBe("question_builder"); // battle card
    expect(stepForStage("templates")).toBe("question_builder");
    // Overview + Generate are retired → they fold onto Design (terminal step).
    expect(stepForStage("overview")).toBe("design");
    expect(stepForStage("generate")).toBe("design");
    expect(stepForStage("done")).toBe("design");
    expect(stepForStage("generating")).toBe("design");
  });

  it("defaults an unknown stage to the first step", () => {
    expect(stepForStage("nonsense")).toBe("grouping");
  });

  it("numbers steps 1-based for 'Step N of M'", () => {
    expect(stepNumber("grouping")).toBe(1);
    expect(stepNumber("question_builder")).toBe(2);
    expect(stepNumber("types")).toBe(2); // shape family folds to Questions
    expect(stepNumber("typing")).toBe(2);
    expect(stepNumber("logic")).toBe(3);
    expect(stepNumber("rec_page")).toBe(4);
    expect(stepNumber("design")).toBe(5);
    expect(stepNumber("overview")).toBe(5); // folds to design (last step)
    expect(stepNumber("generate")).toBe(5);
  });

  it("resolves labels through the fold", () => {
    expect(labelForStage("grouping")).toBe("Recommendations");
    expect(labelForStage("configuring")).toBe("Question Builder");
    expect(labelForStage("done")).toBe("Design");
  });

  it("navigates between visible steps and stops at the ends", () => {
    expect(nextStep("grouping")).toBe("question_builder");
    expect(nextStep("question_builder")).toBe("logic");
    expect(nextStep("logic")).toBe("rec_page");
    expect(nextStep("design")).toBeNull(); // design is the last step
    expect(nextStep("configuring")).toBe("logic"); // folds to Questions first
    expect(prevStep("grouping")).toBeNull();
    expect(prevStep("question_builder")).toBe("grouping");
    expect(prevStep("logic")).toBe("question_builder");
    expect(prevStep("rec_page")).toBe("logic");
  });
});
