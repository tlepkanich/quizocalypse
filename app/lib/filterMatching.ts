import type { z } from "zod";
import type { Quiz, Answer } from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";

type QuizDoc = z.infer<typeof Quiz>;
type AnswerT = z.infer<typeof Answer>;

// ════════════════════════════════════════════════════════════════════════════
// QZY-1 (quiz-logic dev-handoff v1.2 §3/§5/§7/§8) — the "Filters results"
// stage of the decider pipeline: rules → decider → FILTERS → fallback.
//
// A question with role === "filter" narrows the resolved target's pool by the
// attribute values its SELECTED answers map to (the answer's tags, matched
// case-insensitively per [[recs-binding-is-the-match]], plus an optional
// collection membership via collection_filter). Semantics:
//   • within one question: OR across the shopper's selected answers
//   • across filter questions: AND — intersection ("map attributes, not
//     products; combinations resolve by intersection at runtime", §7)
//   • no_preference / valueless answers: first-class pass-through — they
//     NEVER narrow (§5 "No preference")
//   • path-aware by construction (§1): only selected answers participate,
//     and selection comes from the shopper's actual path — a filter question
//     the shopper never saw contributes nothing.
//
// Variant-derived attributes (size/color "automatic — no setup", §7) are a
// flagged dependency: the baked product index carries tags / collections /
// metafields but not per-variant options, so matching covers tags +
// collections + metafields (the last added by the Logic tab, HANDOFF G5).
//
// Everything here is pure. No legacy doc carries role:"filter", so no
// existing quiz's resolution changes byte-one until a merchant assigns the
// role (the dual-model invariant).
// ════════════════════════════════════════════════════════════════════════════

export interface AnswerFilterValues {
  /** Lowercased tag values this answer matches. */
  tags: string[];
  /** Collection membership constraints (any-of). Unions the legacy single
   *  collection_filter with the Logic-tab collection_filters (HANDOFF G8). */
  collectionIds: string[];
  /** Metafield constraints (any-of): the baked metafield `key` equals `value`,
   *  case-insensitively (HANDOFF G5). Values pre-lowercased. */
  metafields: Array<{ key: string; value: string }>;
}

/** The attribute values a filter answer maps to, or null when the answer is
 *  a pass-through (explicit no_preference, or nothing configured — an
 *  unmapped answer must never silently narrow to zero). */
export function answerFilterValues(a: AnswerT): AnswerFilterValues | null {
  if (a.no_preference) return null;
  const tags = a.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  const collectionIds = [
    ...(a.collection_filter ? [a.collection_filter] : []),
    ...(a.collection_filters ?? []),
  ].filter((c, i, all) => c && all.indexOf(c) === i);
  const metafields = (a.metafield_filters ?? [])
    .map((m) => ({ key: m.key.trim(), value: m.value.trim().toLowerCase() }))
    .filter((m) => m.key && m.value);
  if (tags.length === 0 && collectionIds.length === 0 && metafields.length === 0)
    return null;
  return { tags, collectionIds, metafields };
}

function productMatches(p: IndexedProduct, v: AnswerFilterValues): boolean {
  if (v.collectionIds.some((c) => p.collection_ids.includes(c))) return true;
  if (v.tags.length) {
    const ptags = p.tags.map((t) => t.toLowerCase());
    if (v.tags.some((t) => ptags.includes(t))) return true;
  }
  if (v.metafields.length && p.metafields) {
    for (const m of v.metafields) {
      const raw = p.metafields[m.key];
      if (raw !== undefined && raw.trim().toLowerCase() === m.value) return true;
    }
  }
  return false;
}

/** §5 — the live match count for a filter answer's cell, across the given
 *  (pre-filtered-to-sellable) index. Returns null for a pass-through answer
 *  ("doesn't narrow" — never render a bare 0 for those). 0 = dead end. */
export function filterAnswerMatchCount(
  a: AnswerT,
  productIndex: readonly IndexedProduct[],
): number | null {
  const v = answerFilterValues(a);
  if (!v) return null;
  let n = 0;
  for (const p of productIndex) if (productMatches(p, v)) n++;
  return n;
}

/** All questions carrying the filter role, in node order. */
export function filterQuestions(doc: Pick<QuizDoc, "nodes">) {
  return doc.nodes.filter(
    (n): n is Extract<QuizDoc["nodes"][number], { type: "question" }> =>
      n.type === "question" && n.data.role === "filter",
  );
}

export interface AppliedFilter {
  questionId: string;
  questionText: string;
  /** The selected, non-pass-through answers that formed this constraint. */
  answerIds: string[];
}

export interface FilterNarrowResult {
  /** The surviving ordered ids (order preserved — it IS collection_order). */
  ids: string[];
  /** One entry per filter question that actually constrained the pool. */
  applied: AppliedFilter[];
  /** True when constraints existed and eliminated EVERY product — the §8
   *  zero-match case the fallback stage (§9) owns. */
  zeroAfterFilters: boolean;
}

/** Narrow an ordered id pool by the path's filter answers. `byId` should
 *  already be limited to sellable products (the caller's junk filter). */
export function narrowIdsByFilters(
  orderedIds: readonly string[],
  byId: ReadonlyMap<string, IndexedProduct>,
  doc: Pick<QuizDoc, "nodes">,
  selectedAnswerIds: readonly string[],
): FilterNarrowResult {
  const selected = new Set(selectedAnswerIds);
  const applied: AppliedFilter[] = [];
  // Per question: the OR-set of its selected answers' values.
  const constraints: AnswerFilterValues[][] = [];
  for (const q of filterQuestions(doc)) {
    const values: AnswerFilterValues[] = [];
    const answerIds: string[] = [];
    for (const a of q.data.answers) {
      if (!selected.has(a.id)) continue;
      const v = answerFilterValues(a);
      if (!v) continue; // no-preference / unmapped — pass-through
      values.push(v);
      answerIds.push(a.id);
    }
    if (values.length === 0) continue; // skipped on this path, or all pass-through
    constraints.push(values);
    applied.push({ questionId: q.id, questionText: q.data.text, answerIds });
  }
  if (constraints.length === 0) {
    return { ids: [...orderedIds], applied: [], zeroAfterFilters: false };
  }
  const hadAny = orderedIds.some((id) => byId.has(id));
  const ids = orderedIds.filter((id) => {
    const p = byId.get(id);
    if (!p) return false;
    return constraints.every((vs) => vs.some((v) => productMatches(p, v)));
  });
  return { ids, applied, zeroAfterFilters: hadAny && ids.length === 0 };
}
