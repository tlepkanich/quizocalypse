import type { QuizNode } from "../../../lib/quizSchema";

// Merchant-facing labels for every node type (Unified P0 — shared by the
// builder chrome, the panels, and the coming FlowRail).
export const NODE_LABEL: Record<QuizNode["type"], string> = {
  intro: "Intro",
  question: "Question",
  email_gate: "Email gate",
  result: "Result",
  message: "Message",
  end: "End",
  branch: "Branch",
  ask_ai: "Ask AI",
  integration: "Integration",
  product_cards: "Products",
};
