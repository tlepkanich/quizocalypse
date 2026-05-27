import dagre from "dagre";
import type { Quiz } from "./quizSchema";
import type { z } from "zod";

type QuizDoc = z.infer<typeof Quiz>;

const NODE_WIDTH = 280;
const NODE_HEIGHT = 200;

// Re-flow the graph left-to-right with dagre. Returns a new QuizDoc with
// updated node positions; nodes/edges identity is preserved otherwise.
export function autoLayout(doc: QuizDoc): QuizDoc {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 140,
    marginx: 40,
    marginy: 40,
  });

  for (const node of doc.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of doc.edges) {
    if (g.node(edge.source) && g.node(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(g);

  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      const laid = g.node(n.id);
      if (!laid) return n;
      // dagre returns center coordinates; React Flow positions from top-left.
      return {
        ...n,
        position: {
          x: laid.x - NODE_WIDTH / 2,
          y: laid.y - NODE_HEIGHT / 2,
        },
      };
    }),
  };
}
