import type { Quiz as QuizDoc, MatchLadderStrategy } from "./quizSchema";
import { addResultNode } from "./quizMutations";
import { orderFlow } from "./flowOrder";

// ───────────────────────────────────────────────────────────────────────────
// Bucket → result-node reconciliation (Phase 2 product-first builder, Step 1).
//
// Each Step-1 "outcome bucket" (a quiz-scoped Category row) must surface as a
// result page in the quiz. This pure, IDEMPOTENT pass ensures every bucket has
// a result node bound to it via `data.category_id`, reusing unbound result
// nodes first and only then appending new ones. Safe to re-run on every Next
// from Step 1.
//
// Back-compat: an AI-generated quiz whose result nodes are already bound to its
// Category rows reconciles to a NO-OP — nothing is regenerated or rewired.
// ───────────────────────────────────────────────────────────────────────────

export interface BucketRow {
  id: string;
  name: string;
}

const DEFAULT_HEADLINES = new Set(["", "Your match", "Your results", "Result", "Your pick"]);

function ensureCategoryLadder(
  ladder: MatchLadderStrategy[],
): MatchLadderStrategy[] {
  return ladder.includes("category") ? ladder : ["category", ...ladder];
}

// The node a new result should hang off so it's reachable, not orphaned:
// the last question/branch on the spine, else the last non-terminal step,
// else the intro.
function findAnchor(doc: QuizDoc): string | null {
  const ordered = orderFlow(doc);
  const spine = ordered.steps;
  for (let i = spine.length - 1; i >= 0; i--) {
    const t = spine[i]!.type;
    if (t === "question" || t === "branch") return spine[i]!.nodeId;
  }
  for (let i = spine.length - 1; i >= 0; i--) {
    const t = spine[i]!.type;
    if (t !== "result" && t !== "end") return spine[i]!.nodeId;
  }
  return ordered.introId ?? doc.nodes.find((n) => n.type === "intro")?.id ?? null;
}

function bindResultNode(doc: QuizDoc, nodeId: string, bucket: BucketRow): QuizDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId || n.type !== "result") return n;
      const headline = DEFAULT_HEADLINES.has(n.data.headline) ? bucket.name : n.data.headline;
      return {
        ...n,
        data: {
          ...n.data,
          category_id: bucket.id,
          headline,
          match_ladder: ensureCategoryLadder(n.data.match_ladder),
        },
      };
    }),
  };
}

export function reconcileBucketsToResultNodes(
  doc: QuizDoc,
  buckets: BucketRow[],
  fallbackCollectionId: string,
): QuizDoc {
  const bucketIds = new Set(buckets.map((b) => b.id));

  // Unbind result nodes whose bound bucket no longer exists (re-grouping in
  // Step 1 replaces the Category rows with fresh ids). Resetting the headline to
  // a default lets the reuse pass below rebind + rename them to a live bucket
  // instead of leaving stale, orphaned result pages.
  let next: QuizDoc = {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.type === "result" && n.data.category_id && !bucketIds.has(n.data.category_id)
        ? { ...n, data: { ...n.data, category_id: undefined, headline: "Your match" } }
        : n,
    ),
  };

  const boundCategoryIds = new Set<string>();
  for (const n of next.nodes) {
    if (n.type === "result" && n.data.category_id) boundCategoryIds.add(n.data.category_id);
  }
  // Unbound result nodes are reused (in declaration order) before appending.
  const unboundResultIds = next.nodes
    .filter((n) => n.type === "result" && !n.data.category_id)
    .map((n) => n.id);
  let unboundIdx = 0;

  for (const bucket of buckets) {
    if (boundCategoryIds.has(bucket.id)) continue; // already represented

    if (unboundIdx < unboundResultIds.length) {
      next = bindResultNode(next, unboundResultIds[unboundIdx]!, bucket);
      unboundIdx++;
    } else {
      const anchor = findAnchor(next);
      next = addResultNode(next, anchor, fallbackCollectionId, undefined);
      const newId = next.nodes[next.nodes.length - 1]?.id;
      if (newId) next = bindResultNode(next, newId, bucket);
    }
    boundCategoryIds.add(bucket.id);
  }

  return next;
}
