// The canonical, ordered, merchant-visible steps of the create-a-quiz funnel.
// FLOW-3 (funnel-reconfig) — SHAPE IS RETIRED: every flow now resolves "what
// type of quiz" BEFORE the builder (the Write-Your-Goal and Generate-Quiz-
// Templates front doors, or the recs pop-up), so the visible map is the 4-step
// Recommendations → Questions → Results → Design.
//
// Step-1 spec (quiz-step1-recommendations-spec §1): "bucket" never appears in
// merchant-facing UI — Step 1 is "Recommendations", and the Results step keeps
// the compact canonical label "Results" so the shared chrome remains readable.
//
// Single source of truth for the progress indicator, the "Step N of M" label,
// and Back/Continue navigation. PARSE COMPATIBILITY: every retired/legacy/
// transient stage value stays mapped (an in-flight draft parked at any of them
// must never 500 or fall off the bar) — the shape-family stages route FORWARD
// onto Questions, the step their flows land on. This also retires FLOW-1's
// known cosmetic (the rail highlighting Shape during the headless typing/
// templating passes): those passes now honestly show Questions building.

export const FUNNEL_STEPS = [
  { stage: "grouping", label: "Recommendations", short: "Recommendations" },
  { stage: "question_builder", label: "Question Builder", short: "Questions" },
  { stage: "rec_page", label: "Results", short: "Results" },
  { stage: "design", label: "Design", short: "Design" },
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number]["stage"];

// Every BuildSession.stage value (new, legacy, transient) → its visible step.
const STAGE_TO_STEP: Record<string, FunnelStep> = {
  // visible steps (identity)
  grouping: "grouping",
  question_builder: "question_builder",
  rec_page: "rec_page",
  design: "design",
  // The RETIRED Shape family — the legacy picker stages ("shape"/"types"/
  // "goal"/"templates"/"configuring") and the transient AI-in-flight passes
  // ("typing"/"templating") all route FORWARD onto Questions: their flows'
  // next (and now only) visible destination.
  shape: "question_builder",
  goal: "question_builder",
  typing: "question_builder",
  types: "question_builder",
  templating: "question_builder",
  configuring: "question_builder",
  templates: "question_builder",
  // legacy terminal stages (Overview/Generate retired) → Design, the last
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
