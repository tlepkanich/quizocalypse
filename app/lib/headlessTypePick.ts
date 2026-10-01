import type { QuizType } from "./quizSchema";

// First-run handoff §11, defect 5 — the headless chains (the goal-first
// confirm and the speculative pre-build) used to auto-pick `types[0]`. The
// types pass always returns 1–2 product_match types and exactly 1
// personality type, in the AI's order, so a recommendation quiz silently got
// a personality framing whenever the AI listed that one first.
//
// Headless builds are decider docs: the merchant picked products, and each
// result is one of those product groups. That IS product matching, so the
// pick is the AI's best-ranked product_match type. Only when the types pass
// degraded to a set with none (its mix check keeps the last parse rather than
// failing) does the top type stand. Pure.

export function pickHeadlessType<T extends Pick<QuizType, "experience_type">>(
  types: readonly T[],
): T | undefined {
  return types.find((t) => t.experience_type === "product_match") ?? types[0];
}
