// BIC-2 C3a — internal helpers shared by the mutation modules. Split out of
// quizMutations.ts as a pure move; nothing here is re-exported by the barrel,
// so uid/nextPosition stay private to app/lib/mutations/*.
import type { Quiz } from "../quizSchema";
import type { z } from "zod";

export type QuizDoc = z.infer<typeof Quiz>;
export type QuizNodeDoc = QuizDoc["nodes"][number];

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const NEW_NODE_OFFSET = 320;

export function nextPosition(doc: QuizDoc, anchor: string | null) {
  if (anchor) {
    const a = doc.nodes.find((n) => n.id === anchor);
    if (a) return { x: a.position.x + NEW_NODE_OFFSET, y: a.position.y };
  }
  if (doc.nodes.length === 0) return { x: 0, y: 0 };
  const maxX = Math.max(...doc.nodes.map((n) => n.position.x));
  const avgY = doc.nodes.reduce((s, n) => s + n.position.y, 0) / doc.nodes.length;
  return { x: maxX + NEW_NODE_OFFSET, y: avgY };
}
