import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { reconcileBucketsToResultNodes, type BucketRow } from "./bucketReconcile";

function baseDoc(extraNodes: unknown[] = [], extraEdges: unknown[] = []) {
  return Quiz.parse({
    quiz_id: "q1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      {
        id: "q1",
        type: "question",
        position: { x: 1, y: 0 },
        data: {
          text: "Pick",
          question_type: "single_select",
          answers: [
            { id: "a1", text: "A", edge_handle_id: "h1" },
            { id: "a2", text: "B", edge_handle_id: "h2" },
          ],
        },
      },
      ...extraNodes,
    ],
    edges: [{ id: "e1", source: "intro", target: "q1" }, ...extraEdges],
  });
}

function resultNode(id: string, categoryId?: string, headline = "Your match") {
  return {
    id,
    type: "result",
    position: { x: 2, y: 0 },
    data: {
      headline,
      fallback_collection_id: "gid://c/fb",
      ...(categoryId ? { category_id: categoryId } : {}),
    },
  };
}

const results = (doc: ReturnType<typeof baseDoc>) =>
  doc.nodes.filter((n) => n.type === "result");

const FB = "gid://shopify/Collection/1";
const TWO: BucketRow[] = [
  { id: "cat_dry", name: "Dry & dehydrated skin" },
  { id: "cat_oily", name: "Oily & acne-prone skin" },
];

describe("reconcileBucketsToResultNodes", () => {
  it("adds one result node per bucket when none exist, bound + headlined + category ladder", () => {
    const next = reconcileBucketsToResultNodes(baseDoc(), TWO, FB);
    const rs = results(next);
    expect(rs).toHaveLength(2);
    const byCat = new Map(rs.map((r) => [r.type === "result" ? r.data.category_id : "", r]));
    const dry = byCat.get("cat_dry");
    expect(dry && dry.type === "result" && dry.data.headline).toBe("Dry & dehydrated skin");
    expect(dry && dry.type === "result" && dry.data.match_ladder).toContain("category");
    expect(byCat.has("cat_oily")).toBe(true);
  });

  it("is idempotent — re-running yields no duplicate nodes", () => {
    const once = reconcileBucketsToResultNodes(baseDoc(), TWO, FB);
    const twice = reconcileBucketsToResultNodes(once, TWO, FB);
    expect(results(twice)).toHaveLength(2);
  });

  it("is a no-op for a quiz whose result nodes are already bound to its buckets", () => {
    const doc = baseDoc(
      [resultNode("r_dry", "cat_dry"), resultNode("r_oily", "cat_oily")],
      [
        { id: "e2", source: "q1", target: "r_dry" },
        { id: "e3", source: "q1", target: "r_oily" },
      ],
    );
    const before = JSON.stringify(doc.nodes);
    const next = reconcileBucketsToResultNodes(doc, TWO, FB);
    expect(results(next)).toHaveLength(2);
    expect(JSON.stringify(next.nodes)).toBe(before);
  });

  it("appends exactly one node when a single new bucket is added", () => {
    const doc = baseDoc(
      [resultNode("r_dry", "cat_dry")],
      [{ id: "e2", source: "q1", target: "r_dry" }],
    );
    const next = reconcileBucketsToResultNodes(doc, TWO, FB);
    expect(results(next)).toHaveLength(2);
    const oily = results(next).find((r) => r.type === "result" && r.data.category_id === "cat_oily");
    expect(oily).toBeDefined();
  });

  it("reuses an unbound result node before appending", () => {
    const doc = baseDoc(
      [resultNode("r_unbound")],
      [{ id: "e2", source: "q1", target: "r_unbound" }],
    );
    const next = reconcileBucketsToResultNodes(doc, [TWO[0]!], FB);
    const rs = results(next);
    expect(rs).toHaveLength(1); // reused, not appended
    expect(rs[0]!.type === "result" && rs[0]!.data.category_id).toBe("cat_dry");
    expect(rs[0]!.id).toBe("r_unbound");
  });

  it("keeps the result reachable (new node has an inbound edge)", () => {
    const next = reconcileBucketsToResultNodes(baseDoc(), [TWO[0]!], FB);
    const r = results(next)[0]!;
    expect(next.edges.some((e) => e.target === r.id)).toBe(true);
  });

  it("re-parses cleanly against the Quiz schema", () => {
    const next = reconcileBucketsToResultNodes(baseDoc(), TWO, FB);
    expect(() => Quiz.parse(next)).not.toThrow();
  });
});
