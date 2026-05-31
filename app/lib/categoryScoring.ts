import type { Quiz } from "./quizSchema";

type QuizNode = Quiz["nodes"][number];

// Seed per-answer category points by tag overlap: for each question answer,
// records points[categoryId] = count of the answer's tags found in that
// category's tags (only overlaps ≥1; answers with no tags / no overlap are
// left untouched). Pure. Used by Smart Build (app/lib/smartBuild.ts).
export function seedPointsFromCategories(
  nodes: QuizNode[],
  categories: Array<{ id: string; tags?: string[] }>,
): QuizNode[] {
  const categoryTagSets = categories.map((c) => ({
    id: c.id,
    tags: new Set((c.tags ?? []).map((t) => t.toLowerCase())),
  }));
  return nodes.map((n) => {
    if (n.type !== "question") return n;
    return {
      ...n,
      data: {
        ...n.data,
        answers: n.data.answers.map((answer) => {
          const answerTags = answer.tags.map((t) => t.toLowerCase());
          if (answerTags.length === 0) return answer;
          const points: Record<string, number> = {};
          for (const cat of categoryTagSets) {
            let overlap = 0;
            for (const tag of answerTags) {
              if (cat.tags.has(tag)) overlap += 1;
            }
            if (overlap >= 1) points[cat.id] = overlap;
          }
          if (Object.keys(points).length === 0) return answer;
          return { ...answer, points };
        }),
      },
    } as QuizNode;
  });
}
