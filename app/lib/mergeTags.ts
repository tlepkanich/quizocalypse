import type { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

export interface PathStep {
  questionNodeId: string;
  answerIds: string[];
}

// Build the merge-tag context for a Message node. Maps the visited path of
// question answers + ambient name/email values into a flat record keyed by
// the tag identifier ("name", "email", "answer.<questionNodeId>"). Picks the
// first selected answer per question — multi-select questions render the
// first chosen text rather than a comma-joined list.
export function buildMergeContext(
  path: PathStep[],
  doc: QuizDoc,
  ambient: { name?: string; email?: string } = {},
): Record<string, string> {
  const ctx: Record<string, string> = {};
  if (ambient.name) ctx.name = ambient.name;
  if (ambient.email) ctx.email = ambient.email;
  for (const step of path) {
    const node = doc.nodes.find((n) => n.id === step.questionNodeId);
    if (!node || node.type !== "question") continue;
    const firstAns = node.data.answers.find((a) =>
      step.answerIds.includes(a.id),
    );
    if (firstAns) ctx[`answer.${node.id}`] = firstAns.text;
  }
  return ctx;
}

// Resolve "@tag" tokens inside a text body. Unknown tags pass through
// untouched so a typo doesn't look like an empty string.
export function resolveMergeTags(
  text: string,
  ctx: Record<string, string>,
): string {
  return text.replace(/@([a-zA-Z0-9_.]+)/g, (match, key: string) => {
    const value = ctx[key];
    return typeof value === "string" ? value : match;
  });
}
