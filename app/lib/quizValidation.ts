import type { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

export interface NodeIssue {
  nodeId: string;
  kind: "orphan" | "dead_end" | "missing_fallback" | "intro_missing_outbound";
  message: string;
}

// Compute soft validation issues. The Zod schema enforces hard contract;
// this layer surfaces semantic issues a merchant can fix in the builder.
export function validateQuiz(doc: QuizDoc): NodeIssue[] {
  const issues: NodeIssue[] = [];

  const intro = doc.nodes.find((n) => n.type === "intro");
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const e of doc.edges) {
    outgoing.add(e.source);
    incoming.add(e.target);
  }

  // Build reachability set from the intro node.
  const reachable = new Set<string>();
  if (intro) {
    const queue: string[] = [intro.id];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of doc.edges) {
        if (e.source === id) queue.push(e.target);
      }
    }
  }

  for (const node of doc.nodes) {
    if (node.type === "intro") {
      if (!outgoing.has(node.id)) {
        issues.push({
          nodeId: node.id,
          kind: "intro_missing_outbound",
          message: "Intro has no outbound edge.",
        });
      }
      continue;
    }
    if (!reachable.has(node.id)) {
      issues.push({
        nodeId: node.id,
        kind: "orphan",
        message: "Not reachable from intro.",
      });
    }
    if (node.type !== "result" && !outgoing.has(node.id)) {
      issues.push({
        nodeId: node.id,
        kind: "dead_end",
        message: "No outbound edge — dead-end before result.",
      });
    }
    if (node.type === "result" && !node.data.fallback_collection_id) {
      issues.push({
        nodeId: node.id,
        kind: "missing_fallback",
        message: "Result is missing a fallback collection.",
      });
    }
  }

  return issues;
}
