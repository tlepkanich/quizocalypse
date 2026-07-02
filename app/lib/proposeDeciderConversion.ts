import type { Quiz as QuizDoc, RecPageSettings } from "./quizSchema";
import { Quiz, isFreeformType } from "./quizSchema";
import { orderFlow } from "./flowOrder";
import { straightThroughRun } from "./quizMutations";
import { reconcileDeciderTargets, DEFAULT_HEADLINES } from "./bucketReconcile";
import { REC_PAGE_DEFAULTS } from "./recommendDecider";

// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-10e) — the legacy→decider upgrade wizard ENGINE. Pure and
// draft-only by construction: the proposer READS a legacy doc + the quiz's
// Category rows and returns a heuristic conversion proposal (or null when
// answers don't map cleanly enough to auto-convert); the executor applies the
// proposal as ONE ordered mutation the caller commits through useQuizDraft
// (single history entry = one-step undo). publishedJson is never touched —
// the live quiz keeps serving as-is until the merchant explicitly republishes.
// Never bulk: this runs only from the explicit per-quiz wizard (L2-10f).
// ════════════════════════════════════════════════════════════════════════════

export interface ConversionCategory {
  id: string;
  name: string;
  tags: readonly string[];
}

export interface DeciderProposal {
  decidingQuestionNodeId: string;
  /** Modal display — the proposed deciding question's text. */
  decidingQuestionText: string;
  /** answerId → live Category id, complete over the deciding question. */
  answerToTargetMap: Record<string, string>;
  /** The reveal terminus — the first REACHABLE result node in flow order. */
  keptResultNodeId: string;
  resultNodesToRemove: string[];
  /** Modal display — the KEPT page's headline first, then every page merging
   *  into it. (Category NAMES aren't carried — the 10f caller holds the same
   *  `categories` array it passed the proposer.) */
  mergedPageNames: string[];
  /** Sparse §3 seed (global.emptyFallbackCol + per-target headline carries). */
  recPageSettings: RecPageSettings;
  /** The live Category ids the proposal was built against — the executor's
   *  reconcile set (keeps the executor pure with no DB read). */
  liveTargetIds: string[];
}

type QuizNode = QuizDoc["nodes"][number];
type QuestionNode = Extract<QuizNode, { type: "question" }>;
type ResultNode = Extract<QuizNode, { type: "result" }>;

// The legacy seed/reconcile headlines (bucketReconcile's shared set) — pages
// still carrying one of these have no per-target identity worth preserving.
// The v2 read-time default is excluded too (seeding it is a no-op override).
const GENERIC_HEADLINES = new Set([...DEFAULT_HEADLINES, REC_PAGE_DEFAULTS.headline]);

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Every node reachable from the intro, in flow order (spine first, then
 *  branch lanes) — the deterministic "first in flow" ordering the proposal
 *  uses for tie-breaks and the kept result node. */
function flowOrderedNodes(doc: QuizDoc): QuizNode[] {
  const flow = orderFlow(doc);
  const byId = new Map(doc.nodes.map((n) => [n.id, n] as const));
  const seen = new Set<string>();
  const ordered: QuizNode[] = [];
  const push = (id: string) => {
    if (seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id);
    ordered.push(node);
  };
  for (const step of flow.steps) push(step.nodeId);
  for (const lane of flow.branches) for (const step of lane.steps) push(step.nodeId);
  return ordered;
}

/** True when EVERY intro→terminal path passes through `candidateId` — the
 *  same stop-at-the-node walk validateQuiz's V2 (decider_bypass) runs, so a
 *  dominator candidate makes V2 hold BY CONSTRUCTION on the converted doc.
 *  A non-dominator winner would convert into an immediately-unpublishable
 *  draft with no modal disclosure — so it's excluded up front. */
function dominatesEveryPath(doc: QuizDoc, candidateId: string): boolean {
  const intro = doc.nodes.find((n) => n.type === "intro");
  if (!intro) return false;
  const seen = new Set<string>();
  const queue: string[] = [intro.id];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === candidateId) continue; // reach it, never pass beyond it
    for (const e of doc.edges) {
      if (e.source === id) queue.push(e.target);
    }
  }
  return !doc.nodes.some((n) => (n.type === "result" || n.type === "end") && seen.has(n.id));
}

/** The REAL-signal target for one answer: argmax over its EXISTING points
 *  restricted to live categories (covers weighted docs AND direct docs —
 *  setAnswerBucketDirect stores a single-key points map), falling back to
 *  case-insensitive tag overlap vs category tags. Null when neither signal
 *  points anywhere — deliberately NO positional fill here, so a signal-less
 *  question can't fake distinct coverage (the fill only completes the
 *  WINNING question's map, mirroring deciderMapping's semantics). */
function realTargetFor(
  answer: QuestionNode["data"]["answers"][number],
  categories: readonly ConversionCategory[],
): string | null {
  let bestId: string | null = null;
  let bestPoints = 0;
  for (const cat of categories) {
    const pts = answer.points?.[cat.id] ?? 0;
    if (pts > bestPoints) {
      bestPoints = pts;
      bestId = cat.id;
    }
  }
  if (bestId) return bestId;

  const answerTags = answer.tags.map((t) => t.toLowerCase());
  let bestOverlap = 0;
  for (const cat of categories) {
    const set = new Set(cat.tags.map((t) => t.toLowerCase()));
    let overlap = 0;
    for (const tag of answerTags) if (set.has(tag)) overlap += 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestId = cat.id;
    }
  }
  return bestId;
}

/** Heuristic proposal from a LEGACY doc. Null when the doc is already a
 *  decider doc, has no REACHABLE result page to keep, has fewer than two live
 *  buckets, or no eligible DOMINATOR question maps its answers onto ≥2
 *  DISTINCT live targets from real signal (points or tags) — the wizard's
 *  honest "can't auto-convert". */
export function proposeDeciderFromLegacy(
  doc: QuizDoc,
  categories: readonly ConversionCategory[],
): DeciderProposal | null {
  if (doc.logic_model === "decider") return null;
  if (categories.length < 2) return null;

  const ordered = flowOrderedNodes(doc);
  const orderedQuestions = ordered.filter((n): n is QuestionNode => n.type === "question");

  // Best candidate = most DISTINCT real-signal targets among single-answer
  // DOMINATOR questions; strict > keeps ties on the earliest in flow order.
  let winner: QuestionNode | null = null;
  let winnerTargets: (string | null)[] = [];
  let bestScore = 0;
  for (const q of orderedQuestions) {
    if (q.data.question_type === "multi_select" || isFreeformType(q.data.question_type)) continue;
    const targets = q.data.answers.map((a) => realTargetFor(a, categories));
    const distinct = new Set(targets.filter((t): t is string => t !== null)).size;
    if (distinct > bestScore && dominatesEveryPath(doc, q.id)) {
      bestScore = distinct;
      winner = q;
      winnerTargets = targets;
    }
  }
  if (!winner || bestScore < 2) return null;

  // Result pages: keep the first REACHABLE one (an orphan can't be the reveal
  // terminus of an auto-conversion); every other result node — reachable or
  // orphan, removing orphans also clears S1 debris — merges into it.
  const orderedResults = ordered.filter((n): n is ResultNode => n.type === "result");
  const allResults = doc.nodes.filter((n): n is ResultNode => n.type === "result");
  const kept = orderedResults[0];
  if (!kept) return null;
  const resultNodesToRemove = allResults.filter((n) => n.id !== kept.id).map((n) => n.id);

  // Complete the winning map: real signal first, then unused buckets in order
  // (maximises distinct coverage), then positional wrap — every deciding
  // answer gets a target (V4 by construction; deciderMapping's fill rule).
  const used = new Set(winnerTargets.filter((t): t is string => t !== null));
  const unused = categories.filter((c) => !used.has(c.id)).map((c) => c.id);
  let u = 0;
  const answerToTargetMap: Record<string, string> = {};
  winner.data.answers.forEach((a, j) => {
    answerToTargetMap[a.id] =
      winnerTargets[j] ??
      (u < unused.length ? unused[u++]! : categories[j % categories.length]!.id);
  });

  // Sparse rec-page seed. Per-target override headlines carry the old pages'
  // identity forward (first page per category wins, in flow-then-doc order);
  // whyCopy is deliberately left to the runtime default (node subtext rarely
  // reads as "why we recommend" copy — flagged owner default).
  const liveIds = new Set(categories.map((c) => c.id));
  const overrides: Record<string, { headline: string }> = {};
  const orderedResultSet = new Set(orderedResults.map((n) => n.id));
  const resultsForOverrides = [
    ...orderedResults,
    ...allResults.filter((n) => !orderedResultSet.has(n.id)),
  ];
  for (const node of resultsForOverrides) {
    const cat = node.data.category_id;
    if (!cat || !liveIds.has(cat) || overrides[cat]) continue;
    const headline = node.data.headline;
    if (!GENERIC_HEADLINES.has(headline)) overrides[cat] = { headline };
  }

  const mergedPageNames = [kept, ...allResults.filter((n) => n.id !== kept.id)].map(
    (n) => n.data.headline || "Result page",
  );

  return {
    decidingQuestionNodeId: winner.id,
    decidingQuestionText: winner.data.text,
    answerToTargetMap,
    keptResultNodeId: kept.id,
    resultNodesToRemove,
    mergedPageNames,
    recPageSettings: {
      global: { emptyFallbackCol: kept.data.fallback_collection_id },
      overrides,
    },
    liveTargetIds: categories.map((c) => c.id),
  };
}

// "|" is safe: node ids + handles are cuid/underscore strings, never piped.
const edgeKey = (source: string, handle: string | undefined) => `${source}|${handle ?? ""}`;

/** The next branch node whose every wired outbound edge targets `keptId` —
 *  hoisted out of the fixpoint loop (and its reassigned closures). */
function findCollapsibleBranch(
  nodes: readonly QuizNode[],
  edges: QuizDoc["edges"],
  keptId: string,
): QuizNode | undefined {
  return nodes.find((n) => {
    if (n.type !== "branch") return false;
    const outbound = edges.filter((e) => e.source === n.id);
    return outbound.length > 0 && outbound.every((e) => e.target === keptId);
  });
}

/** The ordered conversion mutation — pure, draft-only, single-commit. Applies
 *  the proposal per the L2-10 conversion algorithm: stamp → roles → targets →
 *  sparse settings → fan-in-aware edge retarget with (source, source_handle)
 *  dedupe (NOT deleteNode — result nodes are fan-in, and the runtime resolves
 *  routes via find() first-wins, so a duplicate handle silently strands) →
 *  node/results_pages/breakpoint_overrides removal → branch collapse →
 *  zero-inbound re-anchor on the last movable step → reconcile → Quiz.parse.
 *  No-ops (returns the doc unchanged) on already-decider docs or a proposal
 *  that no longer matches the doc. */
export function executeDeciderUpgrade(doc: QuizDoc, proposal: DeciderProposal): QuizDoc {
  if (doc.logic_model === "decider") return doc;
  const decider = doc.nodes.find(
    (n): n is QuestionNode => n.id === proposal.decidingQuestionNodeId && n.type === "question",
  );
  const kept = doc.nodes.find(
    (n): n is ResultNode => n.id === proposal.keptResultNodeId && n.type === "result",
  );
  if (!decider || !kept) return doc;
  if (decider.data.question_type === "multi_select" || isFreeformType(decider.data.question_type)) {
    return doc;
  }

  const liveIds = new Set(proposal.liveTargetIds);
  // Total over hostile/stale proposals: only ACTUAL result nodes (and never
  // the kept one) are removable — a question id here must not delete it.
  const resultIds = new Set(
    doc.nodes.filter((n) => n.type === "result").map((n) => n.id),
  );
  const removeSet = new Set(
    proposal.resultNodesToRemove.filter((id) => id !== kept.id && resultIds.has(id)),
  );

  // (1)–(4) stamp + roles + targets. Answers without a live map entry are left
  // untouched (reconcile at step 9 drops any dangling target that slips by).
  let nodes: QuizNode[] = doc.nodes.map((n) => {
    if (n.type !== "question") return n;
    if (n.id === decider.id) {
      return {
        ...n,
        data: {
          ...n.data,
          role: "decides" as const,
          required: true,
          answers: n.data.answers.map((a) => {
            const target = proposal.answerToTargetMap[a.id];
            return target && liveIds.has(target) ? { ...a, target_id: target } : a;
          }),
        },
      };
    }
    return { ...n, data: { ...n.data, role: "qualifier" as const } };
  });

  // (6) fan-in-aware retarget. One pass in array order: an edge into a removed
  // result retargets to the kept node unless its (source, handle) slot already
  // routes there — then it drops (one-edge-per-handle invariant, f8a36b3).
  const keepKeys = new Set(
    doc.edges.filter((e) => e.target === kept.id).map((e) => edgeKey(e.source, e.source_handle)),
  );
  let edges: QuizDoc["edges"] = [];
  for (const e of doc.edges) {
    if (!removeSet.has(e.target)) {
      edges.push(e);
      continue;
    }
    // A kept→removed edge must VANISH, not become a kept→kept self-loop —
    // the kept node is the reveal terminus (review-caught).
    if (e.source === kept.id) continue;
    const key = edgeKey(e.source, e.source_handle);
    if (keepKeys.has(key)) continue; // duplicate slot → drop
    keepKeys.add(key);
    edges.push({ ...e, target: kept.id });
  }

  // (7) delete the removed result nodes + every artifact keyed on them.
  nodes = nodes.filter((n) => !removeSet.has(n.id));
  edges = edges.filter((e) => !removeSet.has(e.source) && !removeSet.has(e.target));
  const results_pages = doc.results_pages.filter((r) => !removeSet.has(r.id));
  const breakpoint_overrides = Object.fromEntries(
    Object.entries(doc.breakpoint_overrides).filter(([id]) => !removeSet.has(id)),
  );

  // (8) branch collapse to fixpoint: a branch whose every WIRED outbound edge
  // now targets the kept node is a no-op fork — delete it and retarget its
  // inbound edges (handle/condition preserved, deduped per slot). Unwired
  // slots don't block the collapse: shoppers stuck on them now flow to the
  // reveal instead — an accepted simplification of the conversion. Terminates:
  // every iteration deletes one branch node.
  for (;;) {
    const branch = findCollapsibleBranch(nodes, edges, kept.id);
    if (!branch) break;
    const keptKeys = new Set(
      edges
        .filter((e) => e.target === kept.id && e.source !== branch.id)
        .map((e) => edgeKey(e.source, e.source_handle)),
    );
    const next: QuizDoc["edges"] = [];
    for (const e of edges) {
      if (e.source === branch.id) continue; // the branch's slot edges go away
      if (e.target !== branch.id) {
        next.push(e);
        continue;
      }
      // Same self-loop guard as step 6: a kept→branch edge dies here.
      if (e.source === kept.id) continue;
      const key = edgeKey(e.source, e.source_handle);
      if (keptKeys.has(key)) continue;
      keptKeys.add(key);
      next.push({ ...e, target: kept.id });
    }
    edges = next;
    nodes = nodes.filter((n) => n.id !== branch.id);
  }

  let working: QuizDoc = {
    ...doc,
    logic_model: "decider",
    nodes,
    edges,
    results_pages,
    breakpoint_overrides,
    // (5) sparse seed — an existing merchant-set config wins (legacy docs
    // shouldn't carry one; defensive parity with the L2-10c build seed).
    rec_page_settings: doc.rec_page_settings ?? proposal.recPageSettings,
  };

  // (9) re-anchor a stranded reveal terminus — defense only: the proposer
  // guarantees a REACHABLE kept node, whose inbound edges steps 6–8 preserve.
  // Wire the LAST MOVABLE step of the straight-through run (never the
  // terminal — the add-anchor rule) to the kept node, but ONLY by appending
  // where the anchor has no default-handle edge: stealing a live default edge
  // would silently orphan its old target's subtree (review-caught). A kept
  // node left unwired is visibly flagged by validateQuiz instead.
  if (!working.edges.some((e) => e.target === kept.id)) {
    const { head, run } = straightThroughRun(working);
    const anchor = run.at(-1) ?? head;
    const anchorFree =
      anchor && !working.edges.some((e) => e.source === anchor && !e.source_handle);
    if (anchor && anchor !== kept.id && anchorFree) {
      working = {
        ...working,
        edges: [...working.edges, { id: uid("e"), source: anchor, target: kept.id }],
      };
    }
  }

  // (10) reconcile dangling refs + re-parse (the same gate every mutation
  // path ends on — a parse failure here is a bug, surfaced loudly).
  return Quiz.parse(reconcileDeciderTargets(working, liveIds));
}
