// The canonical, ordered, merchant-visible steps of the create-a-quiz funnel
// (the re-sequenced flow: Product Buckets → Shape Your Quiz → Question Builder →
// Recommendation Page → Design → the builder).
//
// Single source of truth for the progress indicator, the "Step N of M" label,
// and Back/Continue navigation. Transient AI-in-flight stages (typing /
// templating) and the legacy Step-2 selection stages map onto their owning
// VISIBLE step, so an in-flight draft mid-old-flow still resolves to a sensible
// position instead of falling off the progress bar.
//
// NOTE: the merchant goal is folded INTO Shape ("write your goal"), and Design's
// Continue opens the main builder directly — the legacy Overview + Generate steps
// are retired from the flow (the build runs right after Shape). The builder is
// NOT itself a funnel step.

export const FUNNEL_STEPS = [
  { stage: "grouping", label: "Product Buckets", short: "Buckets" },
  { stage: "shape", label: "Shape Your Quiz", short: "Shape" },
  { stage: "question_builder", label: "Question Builder", short: "Questions" },
  { stage: "rec_page", label: "Recommendation Page", short: "Rec Page" },
  { stage: "design", label: "Design", short: "Design" },
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number]["stage"];

// Every BuildSession.stage value (new, legacy, transient) → its visible step.
const STAGE_TO_STEP: Record<string, FunnelStep> = {
  // visible steps (identity)
  grouping: "grouping",
  shape: "shape",
  question_builder: "question_builder",
  rec_page: "rec_page",
  design: "design",
  // `goal` folds into Shape (the spec's Card 3 "Write your goal").
  goal: "shape",
  // transient AI-in-flight + legacy Step-2 selection stages live under Shape.
  typing: "shape",
  types: "shape",
  templating: "shape",
  configuring: "shape",
  templates: "shape",
  // legacy terminal stages (Overview/Generate retired) → Design, the new last
  // visible step, so an in-flight draft parked there still resolves on the bar.
  overview: "design",
  generate: "design",
  generating: "design",
  done: "design",
};

export const TOTAL_STEPS = FUNNEL_STEPS.length;

// The visible step a (possibly legacy/transient) stage belongs to.
export function stepForStage(stage: string): FunnelStep {
  return STAGE_TO_STEP[stage] ?? "grouping";
}

// 0-based index of a stage's visible step within FUNNEL_STEPS.
export function stepIndex(stage: string): number {
  const step = stepForStage(stage);
  return FUNNEL_STEPS.findIndex((s) => s.stage === step);
}

// 1-based number for "Step N of M".
export function stepNumber(stage: string): number {
  return stepIndex(stage) + 1;
}

export function labelForStage(stage: string): string {
  const step = stepForStage(stage);
  return FUNNEL_STEPS.find((s) => s.stage === step)?.label ?? "";
}

// The next / previous VISIBLE step's stage, or null at the ends. Navigation
// always moves between visible steps (never into a transient AI stage).
export function nextStep(stage: string): FunnelStep | null {
  const i = stepIndex(stage);
  return i >= 0 && i < FUNNEL_STEPS.length - 1 ? FUNNEL_STEPS[i + 1]!.stage : null;
}

export function prevStep(stage: string): FunnelStep | null {
  const i = stepIndex(stage);
  return i > 0 ? FUNNEL_STEPS[i - 1]!.stage : null;
}
