// The ONE answer to "which result did this shopper get?" (ANALYTICS-HANDOFF.md,
// Data work 3). Every figure grouped by result — Where shoppers ended up, the
// journey's result boxes, Revenue by result, Contacts by result, the Result
// filter and column, individual responses — reads this module, so the same
// shopper is never under two results on two screens.
//
// What a "result" is depends on the doc model (CLAUDE.md, the dual-model split):
//   - LEGACY docs: the result NODE the shopper landed on. Its name is the
//     node's headline. `QuizSession.outcomeId` holds that node id.
//   - DECIDER docs: the resolved TARGET (a Step-1 recommendation). Everyone
//     lands on the same result node, so the node says nothing; the identity is
//     the anchor target the runtime resolved, recorded on the result page's
//     `recommendation_viewed` event as `resolved_target_id`.
//
// "No match" (owner ruling, 7 Oct 2026) counts what the shopper SAW: a shopper
// with no resolved target, and a shopper whose target resolved but had no
// products to show, both saw the fallback page — both are No match. The target
// that resolved is kept as `intendedTargetId`.
//
// Pure: no DB, no React. The seam feeds it the session's events and row.

import type { Quiz as QuizDoc } from "./quizSchema";
import { resolveTarget } from "./recommendDecider";
import { RULE_COPY } from "../components/studio/logicTab/logicCopy";

export const NO_MATCH_RESULT_ID = "__no_match__";
export const UNKNOWN_RESULT_ID = "__unknown__";
export const NO_MATCH_NAME = "No match";
export const UNKNOWN_RESULT_NAME = "Result not recorded";
const UNNAMED_RESULT = "Your recommendations";

export interface ResultContext {
  doc: QuizDoc;
  decider: boolean;
  /** `publishedJson.target_index` — the names baked at publish. */
  targetIndex: Record<string, { name?: string }>;
  /** Live Category names, for a target that was added since the last publish. */
  categoryNames: ReadonlyMap<string, string>;
}

/** What the seam knows about one session. */
export interface SessionResultFacts {
  /** The session has a `quiz_completed` event in the cohort. */
  finished: boolean;
  /** The session's `recommendation_viewed` events (any order). */
  views: Array<{ ts: number; payload: unknown }>;
  /** Its QuizSession row, when one exists. */
  row?: {
    outcomeId: string | null;
    answerIds: string[];
    matchedProductIds: string[];
    completedAt: Date | null;
  } | null;
  /** The answers the session's events hold, for a session with no row. */
  eventAnswerIds?: string[];
}

export interface SessionResult {
  /** Target id (decider), result node id (legacy), NO_MATCH or UNKNOWN. */
  resultId: string;
  name: string;
  noMatch: boolean;
  /** Why it is a no-match: nothing resolved, or the result had no products. */
  noMatchKind?: "unresolved" | "empty_target";
  resultNodeId: string | null;
  /** The target that resolved, kept even when the shopper saw no match. */
  intendedTargetId?: string;
  matchedRuleId?: string | null;
  /** Where the answer came from — the event, the row, or a re-run of the logic. */
  source: "event" | "session_row" | "derived" | "none";
  /** The id is no longer in the current doc (a deleted result). */
  stale?: boolean;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** `target_index` is baked at publish and is NOT in the Zod schema, so it is
 *  read from the raw published JSON (a parsed doc has already dropped it). */
export function buildResultContext(
  doc: QuizDoc,
  publishedRaw: unknown,
  categoryNames: ReadonlyMap<string, string>,
): ResultContext {
  const index = asRecord(asRecord(publishedRaw)?.target_index);
  return {
    doc,
    decider: doc.logic_model === "decider",
    targetIndex: (index ?? {}) as Record<string, { name?: string }>,
    categoryNames,
  };
}

/** The result page's own event: the LATEST view that names a result node and
 *  is not a mid-quiz preview. A session id survives "Start over", so a session
 *  can hold several; the last run is the result the shopper left with. */
function latestResultView(views: SessionResultFacts["views"]): Record<string, unknown> | null {
  let best: { ts: number; payload: Record<string, unknown> } | null = null;
  for (const v of views) {
    const p = asRecord(v.payload);
    if (!p || p.stage === "preview" || typeof p.result_node_id !== "string") continue;
    if (!best || v.ts >= best.ts) best = { ts: v.ts, payload: p };
  }
  return best?.payload ?? null;
}

function targetName(ctx: ResultContext, id: string): string {
  return ctx.targetIndex[id]?.name || ctx.categoryNames.get(id) || RULE_COPY.missingRecommendation;
}

function targetKnown(ctx: ResultContext, id: string): boolean {
  return Boolean(ctx.targetIndex[id]?.name || ctx.categoryNames.get(id));
}

function noMatch(
  kind: "unresolved" | "empty_target",
  source: SessionResult["source"],
  resultNodeId: string | null,
  intendedTargetId?: string,
  matchedRuleId?: string | null,
): SessionResult {
  return {
    resultId: NO_MATCH_RESULT_ID,
    name: NO_MATCH_NAME,
    noMatch: true,
    noMatchKind: kind,
    resultNodeId,
    ...(intendedTargetId ? { intendedTargetId } : {}),
    ...(matchedRuleId !== undefined ? { matchedRuleId } : {}),
    source,
  };
}

function targetResult(
  ctx: ResultContext,
  targetId: string,
  source: SessionResult["source"],
  resultNodeId: string | null,
  matchedRuleId?: string | null,
): SessionResult {
  return {
    resultId: targetId,
    name: targetName(ctx, targetId),
    noMatch: false,
    resultNodeId,
    intendedTargetId: targetId,
    ...(matchedRuleId !== undefined ? { matchedRuleId } : {}),
    source,
    ...(targetKnown(ctx, targetId) ? {} : { stale: true }),
  };
}

/** A legacy result: the node, named by its headline. */
function nodeResult(
  ctx: ResultContext,
  nodeId: string,
  hasProducts: boolean,
  source: SessionResult["source"],
  stale = false,
): SessionResult {
  // A shopper who landed on a result page that showed nothing saw the
  // fallback: they are No match, like the decider shopper (owner ruling,
  // 7 Oct 2026), so the No match row never hides inside a real result.
  if (!hasProducts) return noMatch("unresolved", source, nodeId);
  const node = ctx.doc.nodes.find((n) => n.id === nodeId);
  const isResult = node?.type === "result";
  return {
    resultId: nodeId,
    name: isResult ? node.data.headline || UNNAMED_RESULT : RULE_COPY.missingRecommendation,
    noMatch: false,
    resultNodeId: nodeId,
    source,
    ...(stale || !isResult ? { stale: true } : {}),
  };
}

function unknownResult(): SessionResult {
  return {
    resultId: UNKNOWN_RESULT_ID,
    name: UNKNOWN_RESULT_NAME,
    noMatch: false,
    resultNodeId: null,
    source: "none",
  };
}

/** Re-run the decider logic on a session's answers (no event survived). */
function derivedTarget(ctx: ResultContext, answerIds: string[], resultNodeId: string | null): SessionResult {
  const resolved = resolveTarget(answerIds, ctx.doc);
  return resolved
    ? targetResult(ctx, resolved.targetId, "derived", resultNodeId, resolved.matchedRuleId)
    : noMatch("unresolved", "derived", resultNodeId);
}

/**
 * The session's result. null = the session did not finish and left no row, so
 * it has no result at all. A finished session ALWAYS gets one (Unknown in the
 * worst case), which is what lets the results add up to Finished.
 */
export function resolveSessionResult(ctx: ResultContext, f: SessionResultFacts): SessionResult | null {
  const view = latestResultView(f.views);
  const row = f.row?.completedAt ? f.row : null;

  if (ctx.decider) {
    if (view) {
      const nodeId = view.result_node_id as string;
      const products = stringList(view.product_ids);
      // The decider result view always writes `matched_rule_id` (null = the
      // answer's own mapping). Its absence means another view rendered.
      if ("matched_rule_id" in view) {
        const targetId = typeof view.resolved_target_id === "string" ? view.resolved_target_id : null;
        const ruleId = typeof view.matched_rule_id === "string" ? view.matched_rule_id : null;
        if (!targetId) return noMatch("unresolved", "event", nodeId, undefined, ruleId);
        // Resolved, but the page showed the fallback (or nothing): No match.
        if (view.fallback_source != null || products.length === 0) {
          return noMatch("empty_target", "event", nodeId, targetId, ruleId);
        }
        return targetResult(ctx, targetId, "event", nodeId, ruleId);
      }
      // A legacy-shaped view on a decider doc. With no products it is the
      // unresolved shopper whose fallback was off; with products it is a
      // session from before this quiz was upgraded to the decider model.
      if (products.length === 0) return noMatch("unresolved", "event", nodeId);
      return nodeResult(ctx, nodeId, true, "event", true);
    }
    if (row) return derivedTarget(ctx, row.answerIds, row.outcomeId);
    if (f.finished && f.eventAnswerIds && f.eventAnswerIds.length > 0) {
      return derivedTarget(ctx, f.eventAnswerIds, null);
    }
    return f.finished ? unknownResult() : null;
  }

  // Legacy: the result node the shopper landed on.
  if (view) {
    const shown = stringList(view.product_ids).length + stringList(view.secondary_product_ids).length;
    return nodeResult(ctx, view.result_node_id as string, shown > 0, "event");
  }
  if (row?.outcomeId) return nodeResult(ctx, row.outcomeId, row.matchedProductIds.length > 0, "session_row");
  if (f.finished || row) {
    // No record of the node — but a quiz with one result has only one answer.
    const resultNodes = ctx.doc.nodes.filter((n) => n.type === "result");
    if (resultNodes.length === 1) {
      const hasProducts = row ? row.matchedProductIds.length > 0 : true;
      return nodeResult(ctx, resultNodes[0]!.id, hasProducts, "derived");
    }
    return unknownResult();
  }
  return null;
}

export interface ResultTally {
  resultId: string;
  name: string;
  noMatch: boolean;
  count: number;
}

/** No match and Unknown sort after every real result, whatever their size. */
function resultRank(id: string): number {
  return id === UNKNOWN_RESULT_ID ? 2 : id === NO_MATCH_RESULT_ID ? 1 : 0;
}

/** Sessions per result. Pass one result per FINISHED session and the counts
 *  add up to Finished. */
export function tallyResults(results: Iterable<SessionResult>): ResultTally[] {
  const byId = new Map<string, ResultTally>();
  for (const r of results) {
    const row = byId.get(r.resultId) ?? { resultId: r.resultId, name: r.name, noMatch: r.noMatch, count: 0 };
    row.count += 1;
    byId.set(r.resultId, row);
  }
  return [...byId.values()].sort(
    (a, b) => resultRank(a.resultId) - resultRank(b.resultId) || b.count - a.count || a.name.localeCompare(b.name),
  );
}

export interface ResultRevenue {
  resultId: string;
  name: string;
  noMatch: boolean;
  orders: number;
  totalsByCurrency: Record<string, number>;
}

/**
 * Orders and revenue per result. Each order counts ONCE (deduped by order_id;
 * when one order won several sessions, the earliest event's session keeps it),
 * so the rows add up to Attributed orders and Revenue influenced.
 */
export function revenueByResult(
  orderEvents: Array<{ sessionId: string; ts: number; payload: unknown }>,
  bySession: ReadonlyMap<string, SessionResult>,
): ResultRevenue[] {
  const ordered = [...orderEvents].sort((a, b) => a.ts - b.ts || a.sessionId.localeCompare(b.sessionId));
  const seenOrders = new Set<string>();
  const byId = new Map<string, ResultRevenue>();
  for (const e of ordered) {
    const p = asRecord(e.payload);
    const orderId = typeof p?.order_id === "string" ? p.order_id : null;
    const total = typeof p?.total_price === "string" ? Number(p.total_price) : NaN;
    // The same acceptance rule as totalRevenue(): a string order id and a
    // numeric total, or the row is not an order we can count.
    if (!orderId || !Number.isFinite(total)) continue;
    if (seenOrders.has(orderId)) continue;
    seenOrders.add(orderId);
    const result = bySession.get(e.sessionId) ?? unknownResult();
    const row =
      byId.get(result.resultId) ??
      { resultId: result.resultId, name: result.name, noMatch: result.noMatch, orders: 0, totalsByCurrency: {} };
    const currency = typeof p?.currency === "string" ? p.currency : "";
    row.orders += 1;
    row.totalsByCurrency[currency] = (row.totalsByCurrency[currency] ?? 0) + total;
    byId.set(result.resultId, row);
  }
  const sum = (r: ResultRevenue) => Object.values(r.totalsByCurrency).reduce((a, b) => a + b, 0);
  return [...byId.values()].sort(
    (a, b) => resultRank(a.resultId) - resultRank(b.resultId) || sum(b) - sum(a) || a.name.localeCompare(b.name),
  );
}
