import { describe, expect, it } from "vitest";
import { Quiz } from "./quizSchema";
import { validateQuiz } from "./quizValidation";
import {
  proposeDeciderFromLegacy,
  executeDeciderUpgrade,
  type ConversionCategory,
} from "./proposeDeciderConversion";

const CATS: ConversionCategory[] = [
  { id: "cat_trail", name: "Trail Boards", tags: ["trail", "all-mountain"] },
  { id: "cat_park", name: "Park Boards", tags: ["park", "freestyle"] },
  { id: "cat_powder", name: "Powder Boards", tags: ["powder", "backcountry"] },
];

function question(
  id: string,
  answers: { id: string; points?: Record<string, number>; tags?: string[] }[],
  question_type = "single_select",
) {
  return {
    id,
    type: "question",
    position: { x: 0, y: 0 },
    data: {
      text: `Question ${id}`,
      question_type,
      answers: answers.map((a) => ({
        id: a.id,
        text: `Answer ${a.id}`,
        edge_handle_id: `h_${a.id}`,
        ...(a.points ? { points: a.points } : {}),
        ...(a.tags ? { tags: a.tags } : {}),
      })),
    },
  };
}

function result(id: string, categoryId?: string, headline = "Your match") {
  return {
    id,
    type: "result",
    position: { x: 0, y: 0 },
    data: {
      headline,
      fallback_collection_id: "gid://shopify/Collection/fb",
      ...(categoryId ? { category_id: categoryId } : {}),
    },
  };
}

/** intro → q1 → q2 → branch(sb_br) → 3 category-bound results — the Smart
 *  Build legacy shape: q1 carries direct points, q2 tags-only; the branch
 *  fans out to one result per bucket. */
function legacyDoc(overrides: Record<string, unknown> = {}) {
  return Quiz.parse({
    quiz_id: "legacy1",
    scope: { collection_ids: [] },
    nodes: [
      { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
      question("q1", [
        { id: "a1", points: { cat_trail: 1 } },
        { id: "a2", points: { cat_park: 1 } },
        { id: "a3", points: { cat_powder: 1 } },
      ]),
      question("q2", [
        { id: "b1", tags: ["trail"] },
        { id: "b2", tags: ["park"] },
      ]),
      {
        id: "sb_br",
        type: "branch",
        position: { x: 0, y: 0 },
        data: {
          label: "Route",
          slots: [
            { id: "s1", label: "Trail" },
            { id: "s2", label: "Park" },
            { id: "s3", label: "Powder" },
          ],
        },
      },
      result("r_trail", "cat_trail", "Trail Boards"),
      result("r_park", "cat_park", "Shred the Park"),
      result("r_powder", "cat_powder", "Your match"),
    ],
    edges: [
      { id: "e1", source: "intro", target: "q1" },
      { id: "e2", source: "q1", target: "q2" },
      { id: "e3", source: "q2", target: "sb_br" },
      { id: "e4", source: "sb_br", target: "r_trail", source_handle: "s1" },
      { id: "e5", source: "sb_br", target: "r_park", source_handle: "s2" },
      { id: "e6", source: "sb_br", target: "r_powder", source_handle: "s3" },
    ],
    results_pages: [
      { id: "r_trail", headline: "Trail Boards", ranked_product_ids: [] },
      { id: "r_park", headline: "Shred the Park", ranked_product_ids: [] },
    ],
    breakpoint_overrides: { r_park: { desktop: {} } },
    ...overrides,
  });
}

describe("proposeDeciderFromLegacy", () => {
  it("picks the points-mapped question over the weaker tags one (dual-source, points win coverage)", () => {
    const p = proposeDeciderFromLegacy(legacyDoc(), CATS);
    expect(p).not.toBeNull();
    expect(p!.decidingQuestionNodeId).toBe("q1"); // 3 distinct vs q2's 2
    expect(p!.answerToTargetMap).toEqual({
      a1: "cat_trail",
      a2: "cat_park",
      a3: "cat_powder",
    });
    expect(p!.keptResultNodeId).toBe("r_trail"); // first result in flow order
    expect(p!.resultNodesToRemove.sort()).toEqual(["r_park", "r_powder"]);
    expect(p!.liveTargetIds).toEqual(CATS.map((c) => c.id));
  });

  it("falls back to tag overlap when no answer carries points, and fills the gap from unused buckets", () => {
    const doc = legacyDoc();
    const noPoints = Quiz.parse({
      ...doc,
      nodes: doc.nodes.filter((n) => n.id !== "q1"),
      edges: [
        { id: "e1", source: "intro", target: "q2" },
        ...doc.edges.filter((e) => !["e1", "e2"].includes(e.id)),
      ],
    });
    const p = proposeDeciderFromLegacy(noPoints, CATS);
    expect(p).not.toBeNull();
    expect(p!.decidingQuestionNodeId).toBe("q2");
    expect(p!.answerToTargetMap.b1).toBe("cat_trail");
    expect(p!.answerToTargetMap.b2).toBe("cat_park");
  });

  it("mergedPageNames carries the KEPT page's headline FIRST (the modal's destructure contract)", () => {
    const p = proposeDeciderFromLegacy(legacyDoc(), CATS)!;
    expect(p.mergedPageNames[0]).toBe("Trail Boards"); // r_trail = keptResultNodeId
    expect(p.mergedPageNames).toHaveLength(3);
  });

  it("seeds sparse settings: emptyFallbackCol from the kept node + non-generic headline overrides only", () => {
    const p = proposeDeciderFromLegacy(legacyDoc(), CATS)!;
    expect(p.recPageSettings.global).toEqual({
      emptyFallbackCol: "gid://shopify/Collection/fb",
    });
    // "Trail Boards"/"Shred the Park" carry identity; "Your match" is generic.
    expect(p.recPageSettings.overrides).toEqual({
      cat_trail: { headline: "Trail Boards" },
      cat_park: { headline: "Shred the Park" },
    });
  });

  it("returns null when no question maps ≥2 distinct live targets from REAL signal (fill never fakes coverage)", () => {
    const doc = legacyDoc();
    const signalless = Quiz.parse({
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.type !== "question"
          ? n
          : {
              ...n,
              data: {
                ...n.data,
                answers: n.data.answers.map((a) => {
                  const { points: _p, ...rest } = a;
                  return { ...rest, tags: [] };
                }),
              },
            },
      ),
    });
    expect(proposeDeciderFromLegacy(signalless, CATS)).toBeNull();
  });

  it("returns null on already-decider docs, <2 categories, and docs without a result page", () => {
    const doc = legacyDoc();
    expect(proposeDeciderFromLegacy({ ...doc, logic_model: "decider" }, CATS)).toBeNull();
    expect(proposeDeciderFromLegacy(doc, CATS.slice(0, 1))).toBeNull();
    const noResults = Quiz.parse({
      ...doc,
      nodes: doc.nodes.filter((n) => n.type !== "result"),
      edges: doc.edges.filter((e) => !e.target.startsWith("r_")),
      results_pages: [],
      breakpoint_overrides: {},
    });
    expect(proposeDeciderFromLegacy(noResults, CATS)).toBeNull();
  });

  it("excludes a bypassable (non-dominator) question — V2 holds by construction", () => {
    // intro → branch: lane s1 → qLane (the ONLY strong-signal question) → r1;
    // lane s2 shortcuts straight to r2. qLane is bypassable via s2, so an
    // auto-conversion picking it would be born unpublishable (decider_bypass).
    const doc = Quiz.parse({
      quiz_id: "bypass1",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "br",
          type: "branch",
          position: { x: 0, y: 0 },
          data: { label: "Split", slots: [{ id: "s1", label: "A" }, { id: "s2", label: "B" }] },
        },
        question("qLane", [
          { id: "a1", points: { cat_trail: 1 } },
          { id: "a2", points: { cat_park: 1 } },
        ]),
        result("r1", "cat_trail"),
        result("r2", "cat_park"),
      ],
      edges: [
        { id: "e1", source: "intro", target: "br" },
        { id: "e2", source: "br", target: "qLane", source_handle: "s1" },
        { id: "e3", source: "br", target: "r2", source_handle: "s2" },
        { id: "e4", source: "qLane", target: "r1" },
      ],
    });
    expect(proposeDeciderFromLegacy(doc, CATS)).toBeNull();
    // The main legacyDoc winner IS a dominator and converts V2-clean (pinned
    // in the executeDeciderUpgrade suite via validateQuiz).
  });

  it("wraps positionally (j % len) once real signal and unused buckets run out", () => {
    const doc = Quiz.parse({
      quiz_id: "wrap1",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        question("q1", [
          { id: "a1", points: { cat_trail: 1 } },
          { id: "a2", points: { cat_park: 1 } },
          { id: "a3", tags: [] },
          { id: "a4", tags: [] },
          { id: "a5", tags: [] },
        ]),
        result("r1", "cat_trail"),
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r1" },
      ],
    });
    const p = proposeDeciderFromLegacy(doc, CATS)!;
    // a3 → the unused cat_powder; a4/a5 wrap positionally (index % 3).
    expect(p.answerToTargetMap).toEqual({
      a1: "cat_trail",
      a2: "cat_park",
      a3: "cat_powder",
      a4: CATS[3 % 3]!.id,
      a5: CATS[4 % 3]!.id,
    });
  });

  it("never proposes a multi_select or freeform question", () => {
    const doc = legacyDoc();
    const multi = Quiz.parse({
      ...doc,
      nodes: doc.nodes.map((n) =>
        n.id === "q1" && n.type === "question"
          ? { ...n, data: { ...n.data, question_type: "multi_select" } }
          : n,
      ),
    });
    const p = proposeDeciderFromLegacy(multi, CATS);
    expect(p).not.toBeNull();
    expect(p!.decidingQuestionNodeId).toBe("q2"); // q1 disqualified
  });
});

describe("executeDeciderUpgrade", () => {
  const upgrade = () => {
    const doc = legacyDoc();
    const p = proposeDeciderFromLegacy(doc, CATS)!;
    return { doc, p, next: executeDeciderUpgrade(doc, p) };
  };

  it("stamps + roles + targets, and passes Quiz.parse + validateQuiz V1–V4 clean", () => {
    const { next } = upgrade();
    expect(next.logic_model).toBe("decider");
    const q1 = next.nodes.find((n) => n.id === "q1");
    expect(q1?.type === "question" && q1.data.role).toBe("decides");
    expect(q1?.type === "question" && q1.data.required).toBe(true);
    expect(
      q1?.type === "question" && q1.data.answers.every((a) => Boolean(a.target_id)),
    ).toBe(true);
    const q2 = next.nodes.find((n) => n.id === "q2");
    expect(q2?.type === "question" && q2.data.role).toBe("qualifier");
    const kinds = validateQuiz(next).map((i) => i.kind);
    for (const k of ["missing_decider", "decider_optional", "unmapped_decider_answer", "decider_bypass"]) {
      expect(kinds).not.toContain(k);
    }
  });

  it("merges every result into the kept node and collapses the now-pointless branch", () => {
    const { next } = upgrade();
    const results = next.nodes.filter((n) => n.type === "result");
    expect(results.map((n) => n.id)).toEqual(["r_trail"]);
    // The branch's outbound edges all pointed at removed results → retargeted
    // to r_trail → all-same-target branch collapses; q2 wires straight in.
    expect(next.nodes.some((n) => n.type === "branch")).toBe(false);
    const intoKept = next.edges.filter((e) => e.target === "r_trail");
    expect(intoKept).toHaveLength(1);
    expect(intoKept[0]!.source).toBe("q2");
  });

  it("preserves one-edge-per-(source,handle) on fan-in retargets (the f8a36b3 class)", () => {
    const doc = legacyDoc();
    // Per-answer routing: q2's two answers route to two DIFFERENT results —
    // after the merge both handles retarget to the kept node, and they must
    // stay distinct edges (one per handle), never duplicated or dropped both.
    const routed = Quiz.parse({
      ...doc,
      edges: [
        ...doc.edges.filter((e) => e.id !== "e3"),
        { id: "e7", source: "q2", target: "r_park", source_handle: "h_b1" },
        { id: "e8", source: "q2", target: "r_powder", source_handle: "h_b2" },
        { id: "e9", source: "q2", target: "sb_br" },
      ],
    });
    const p = proposeDeciderFromLegacy(routed, CATS)!;
    // With per-answer routing, q2's direct edges put r_park at an earlier flow
    // column than the branch-fed r_trail — the proposer keeps the first.
    const next = executeDeciderUpgrade(routed, p);
    const fromQ2 = next.edges.filter(
      (e) => e.source === "q2" && e.target === p.keptResultNodeId && e.source_handle,
    );
    const handles = fromQ2.map((e) => e.source_handle).sort();
    expect(handles).toEqual(["h_b1", "h_b2"]);
    const keys = next.edges.map((e) => `${e.source}|${e.source_handle ?? ""}`);
    expect(new Set(keys).size).toBe(keys.length); // no duplicate slots anywhere
    expect(next.nodes.filter((n) => n.type === "result").map((n) => n.id)).toEqual([
      p.keptResultNodeId,
    ]);
  });

  it("drops a retarget whose (source,handle) slot already routes to the kept node", () => {
    const doc = legacyDoc();
    const dup = Quiz.parse({
      ...doc,
      edges: [
        ...doc.edges,
        // q2's b1 handle ALREADY routes to the kept node — the same handle's
        // edge into a removed result must drop, not duplicate.
        { id: "e7", source: "q2", target: "r_trail", source_handle: "h_b1" },
        { id: "e8", source: "q2", target: "r_park", source_handle: "h_b1" },
      ],
    });
    const p = proposeDeciderFromLegacy(dup, CATS)!;
    const next = executeDeciderUpgrade(dup, p);
    const b1Edges = next.edges.filter(
      (e) => e.source === "q2" && e.source_handle === "h_b1",
    );
    expect(b1Edges).toHaveLength(1);
    expect(b1Edges[0]!.target).toBe("r_trail");
  });

  it("cleans results_pages + breakpoint_overrides of removed nodes", () => {
    const { next } = upgrade();
    expect(next.results_pages.map((r) => r.id)).toEqual(["r_trail"]);
    expect(Object.keys(next.breakpoint_overrides)).not.toContain("r_park");
  });

  it("seeds rec_page_settings sparse and reconciles stale targets defensively", () => {
    const { doc, p } = upgrade();
    const stale = {
      ...p,
      answerToTargetMap: { ...p.answerToTargetMap, a3: "cat_deleted" },
      liveTargetIds: p.liveTargetIds,
    };
    const next = executeDeciderUpgrade(doc, stale);
    expect(next.rec_page_settings?.global.emptyFallbackCol).toBe("gid://shopify/Collection/fb");
    const q1 = next.nodes.find((n) => n.id === "q1");
    // a3's stale target never lands (liveIds filter); a1/a2 map fine.
    expect(q1?.type === "question" && q1.data.answers.find((a) => a.id === "a3")?.target_id).toBeUndefined();
    expect(q1?.type === "question" && q1.data.answers.find((a) => a.id === "a1")?.target_id).toBe("cat_trail");
  });

  it("re-anchors a stranded kept node onto the last movable step (the add-anchor rule)", () => {
    // No branch: q2 routes ONLY per-answer to the removed results, and the
    // kept node's sole inbound is one of those handles. Removing + retargeting
    // keeps it wired; but if EVERY inbound vanishes (kept node orphaned in the
    // source doc), the executor wires lastMovable → kept.
    const doc = Quiz.parse({
      quiz_id: "orphan1",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        question("q1", [
          { id: "a1", points: { cat_trail: 1 } },
          { id: "a2", points: { cat_park: 1 } },
        ]),
        result("r_kept", "cat_trail", "Trail Boards"), // orphan — no inbound
        result("r_gone", "cat_park"),
      ],
      edges: [
        { id: "e1", source: "intro", target: "q1" },
        { id: "e2", source: "q1", target: "r_gone" },
      ],
    });
    const p = proposeDeciderFromLegacy(doc, CATS)!;
    // Flow order puts r_gone first (reachable); force keeping the orphan to
    // exercise the re-anchor path deterministically.
    const forced = {
      ...p,
      keptResultNodeId: "r_kept",
      resultNodesToRemove: ["r_gone"],
    };
    const next = executeDeciderUpgrade(doc, forced);
    // q1's default edge to r_gone retargets to r_kept — still anchored; the
    // invariant under test: the kept node ALWAYS ends up reachable.
    expect(next.edges.some((e) => e.target === "r_kept")).toBe(true);
    expect(validateQuiz(next).map((i) => i.kind)).not.toContain("missing_decider");
  });

  it("drops a kept→removed edge instead of minting a kept→kept self-loop", () => {
    // Result→result chain: the kept page links onward to a removed one.
    const doc = legacyDoc();
    const chained = Quiz.parse({
      ...doc,
      edges: [...doc.edges, { id: "e7", source: "r_trail", target: "r_park" }],
    });
    const p = proposeDeciderFromLegacy(chained, CATS)!;
    const next = executeDeciderUpgrade(chained, p);
    expect(next.edges.some((e) => e.source === e.target)).toBe(false);
    expect(next.edges.some((e) => e.source === p.keptResultNodeId)).toBe(false);
  });

  it("ignores a non-result id smuggled into resultNodesToRemove (total executor)", () => {
    const { doc, p } = upgrade();
    const hostile = { ...p, resultNodesToRemove: [...p.resultNodesToRemove, "q2"] };
    const next = executeDeciderUpgrade(doc, hostile);
    expect(next.nodes.some((n) => n.id === "q2")).toBe(true); // question survives
  });

  it("step-9 defense: appends an anchor edge when free, and NEVER steals a live default edge", () => {
    const base = (extraEdges: unknown[]) =>
      Quiz.parse({
        quiz_id: "anchor1",
        scope: { collection_ids: [] },
        nodes: [
          { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
          question("q1", [
            { id: "a1", points: { cat_trail: 1 } },
            { id: "a2", points: { cat_park: 1 } },
          ]),
          question("q2", [{ id: "b1" }, { id: "b2" }]),
          result("r_kept", "cat_trail"),
          result("r_gone", "cat_park"),
        ],
        edges: [{ id: "e1", source: "intro", target: "q1" }, ...extraEdges],
      });
    const forced = (doc: ReturnType<typeof base>) => ({
      ...proposeDeciderFromLegacy(
        // proposals need a reachable result — build one from a wired sibling,
        // then force the orphan kept to exercise the defensive branch.
        legacyDoc(),
        CATS,
      )!,
      decidingQuestionNodeId: "q1",
      answerToTargetMap: { a1: "cat_trail", a2: "cat_park" },
      keptResultNodeId: "r_kept",
      resultNodesToRemove: ["r_gone"],
    });

    // (a) the anchor (a bare intro — the only shape with a FREE default slot,
    // since a run-tail node by definition has one outbound) → edge appended.
    const free = Quiz.parse({ ...base([]), edges: [] });
    const freed = executeDeciderUpgrade(free, forced(free));
    expect(freed.edges.some((e) => e.source === "intro" && e.target === "r_kept")).toBe(true);

    // (b) the anchor's default edge is LIVE (intro→q1, q1→q2) → it must NOT
    // be stolen; the kept node stays unwired (validateQuiz flags it) and
    // every existing path survives intact.
    const busy = base([{ id: "e2", source: "q1", target: "q2" }]);
    const kept = executeDeciderUpgrade(busy, forced(busy));
    expect(kept.edges.some((e) => e.source === "q1" && e.target === "q2")).toBe(true);
    expect(kept.edges.some((e) => e.source === "intro" && e.target === "q1")).toBe(true);
    expect(kept.edges.some((e) => e.target === "r_kept")).toBe(false);
  });

  it("no-ops on already-decider docs and on proposals that no longer match", () => {
    const { doc, p } = upgrade();
    const decider = { ...doc, logic_model: "decider" as const };
    expect(executeDeciderUpgrade(decider, p)).toBe(decider);
    expect(executeDeciderUpgrade(doc, { ...p, decidingQuestionNodeId: "gone" })).toBe(doc);
    expect(executeDeciderUpgrade(doc, { ...p, keptResultNodeId: "gone" })).toBe(doc);
  });

  it("is draft-only by construction: the input doc is not mutated", () => {
    const doc = legacyDoc();
    const frozen = JSON.stringify(doc);
    const p = proposeDeciderFromLegacy(doc, CATS)!;
    executeDeciderUpgrade(doc, p);
    expect(JSON.stringify(doc)).toBe(frozen);
  });
});
