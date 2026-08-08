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
  // One-line-chrome handoff — Logic is its own visible step after Questions:
  // the decider Step-3 shell's former in-shell ▦ Overview view, promoted to a
  // persisted stage so navigation, resume, and the goto-stage trapdoor all
  // treat it like any other step.
  { stage: "logic", label: "Logic", short: "Logic" },
  // DESIGN IS RETIRED as a funnel step (owner, 2026-08-08): the look is
  // inherited from the brand at generation (DGN-1 derived_tokens) and edited
  // in the builder's Design rail afterward. Results is the last step; its
  // Continue opens the builder (generate-build). The "design" STAGE VALUE
  // stays parsed forever (drafts parked there resolve onto Results).
  { stage: "rec_page", label: "Results", short: "Results" },
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number]["stage"];

// Every BuildSession.stage value (new, legacy, transient) → its visible step.
const STAGE_TO_STEP: Record<string, FunnelStep> = {
  // visible steps (identity)
  grouping: "grouping",
  question_builder: "question_builder",
  logic: "logic",
  rec_page: "rec_page",
  // Retired visible step — parked drafts fold onto Results (the last step).
  design: "rec_page",
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
  // legacy terminal stages (Overview/Generate/Design retired) → Results, the
  // last visible step, so an in-flight draft parked there still resolves.
  overview: "rec_page",
  generate: "rec_page",
  generating: "rec_page",
  done: "rec_page",
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
