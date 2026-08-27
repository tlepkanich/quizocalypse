// ANALYTICS P0 — THE shared analytics server seam (research doc "SHARED /
// Page shell & server seam"; CLAUDE.md no-fork rule). Both admin surfaces
// (/studio and /app) and the analytics home pages call these two functions.
// Fix metric logic HERE, never per-surface — the previous hand-copied loaders
// had already drifted (W12: two surfaces, two capture counts).
//
// The correctness core (research doc §8.3): the date range COHORTS SESSIONS,
// it does not filter events. We select the sessions whose quiz_engaged fell in
// range, then aggregate ALL of those sessions' events regardless of ts. That
// is the only construction under which numerator ⊆ denominator holds by
// definition — a shopper who starts Monday and finishes Thursday can no longer
// break a ratio.

import prisma from "../db.server";
import { Quiz, experienceTypeOf } from "./quizSchema";
import type { Quiz as QuizDoc } from "./quizSchema";
import { totalRevenue, formatRevenue } from "./funnelAggregation";
import { productPerformance, type ProductPerfRow } from "./productPerformance";
import { findAbBranches, aggregateVariantFunnel } from "./abAnalytics";
import { buildStepLedger, type StepLedger } from "./stepLedger";
import { answerDistributions, type QuestionDistribution } from "./answerDistribution";
import { computeReachability } from "./quizReachability";
import { buildQuizInsights, distinctOutcomes, INSIGHT_SNOOZE_DAYS, type InsightsResult } from "./quizInsights";
import { gateRate, type GatedRate } from "./analyticsConfidence";

// ── Range ──────────────────────────────────────────────────────────────────

export type RangePreset = "7d" | "30d" | "90d" | "6m" | "12m" | "all" | "custom";

export interface AnalyticsRange {
  preset: RangePreset;
  /** null = since forever. */
  from: Date | null;
  to: Date;
  label: string;
  /** Days covered (insight per-month math); 0 when open-ended. */
  days: number;
  /** True when a thin default window auto-widened to all time (§8.3). */
  widened: boolean;
}

const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "6m": "Last 6 months",
  "12m": "Last 12 months",
  all: "Since published",
};

export const DEFAULT_PRESET: RangePreset = "90d";

/** Resolve ?r= (+ ?from/?to for custom) server-side, so a shared link can't
 *  drift by the day it is opened. Invalid input falls back to the default. */
export function resolveAnalyticsRange(searchParams: URLSearchParams, now = new Date()): AnalyticsRange {
  const r = (searchParams.get("r") ?? DEFAULT_PRESET) as RangePreset;
  const to = now;
  const dayMs = 86_400_000;
  if (r === "custom") {
    const from = new Date(searchParams.get("from") ?? "");
    const toRaw = searchParams.get("to");
    const toD = toRaw ? new Date(`${toRaw}T23:59:59.999Z`) : now;
    if (!Number.isNaN(+from) && !Number.isNaN(+toD) && +from <= +toD) {
      return {
        preset: "custom",
        from,
        to: toD,
        label: `${searchParams.get("from")} – ${toRaw ?? "today"}`,
        days: Math.max(1, Math.round((+toD - +from) / dayMs)),
        widened: false,
      };
    }
  }
  if (r === "all") return { preset: "all", from: null, to, label: PRESET_LABELS.all, days: 0, widened: false };
  const daysByPreset: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "6m": 182, "12m": 365 };
  const days = daysByPreset[r] ?? 90;
  const preset: RangePreset = daysByPreset[r] ? r : DEFAULT_PRESET;
  return {
    preset,
    from: new Date(+to - days * dayMs),
    to,
    label: PRESET_LABELS[preset as Exclude<RangePreset, "custom">],
    days,
    widened: false,
  };
}

// ── Shared internals ───────────────────────────────────────────────────────

/** Session-cohort cap. Real merchant volume sits far below it; past it we
 *  disclose truncation rather than silently sample (W15). */
export const ANALYTICS_SESSION_CAP = 5000;

/** Attribution look-back, printed beside every revenue figure (§6.5). */
export const ATTRIBUTION_WINDOW_DAYS = 7;

interface CohortEventRow {
  sessionId: string;
  eventType: string;
  payload: unknown;
  ts: Date;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Distinct sessions with `eventType` among rows. */
function distinct(rows: CohortEventRow[], eventType: string): Set<string> {
  const s = new Set<string>();
  for (const r of rows) if (r.eventType === eventType) s.add(r.sessionId);
  return s;
}

/** W4 — mid-quiz preview impressions must not count as recommendation views. */
function isPreviewImpression(r: CohortEventRow): boolean {
  return r.eventType === "recommendation_viewed" && asRecord(r.payload)?.stage === "preview";
}

export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  const head = user.slice(0, 1);
  return `${head}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

// ── Insight dismissal (14-day snooze) ──────────────────────────────────────

export interface DismissalState {
  /** cardIds currently snoozed — hidden from the list. */
  active: Set<string>;
  /** cardId → when the snooze lapses, for the "Show dismissed" list. */
  until: Map<string, Date>;
}

/** Load a quiz's dismissals, splitting live snoozes from lapsed ones. */
export async function loadDismissals(quizIds: string[], now = new Date()): Promise<Map<string, DismissalState>> {
  const byQuiz = new Map<string, DismissalState>();
  if (quizIds.length === 0) return byQuiz;
  const rows = await prisma.insightDismissal.findMany({
    where: { quizId: { in: quizIds } },
    select: { quizId: true, cardId: true, snoozedUntil: true },
  });
  for (const r of rows) {
    let st = byQuiz.get(r.quizId);
    if (!st) {
      st = { active: new Set(), until: new Map() };
      byQuiz.set(r.quizId, st);
    }
    // A LAPSED row is deliberately not "active": the finding comes back on its
    // own if it was never actually fixed.
    if (r.snoozedUntil > now) st.active.add(r.cardId);
    st.until.set(r.cardId, r.snoozedUntil);
  }
  return byQuiz;
}

/**
 * Snooze or restore a card. Shared by both admin surfaces so the two can't
 * drift; the caller has already authenticated and resolved the shop, and the
 * quizId is re-checked against that shop here so a foreign id writes nothing.
 */
export async function setInsightDismissal(
  shopId: string,
  quizId: string,
  cardId: string,
  action: "dismiss" | "restore",
  now = new Date(),
): Promise<{ ok: boolean }> {
  const owned = await prisma.quiz.findFirst({ where: { id: quizId, shopId }, select: { id: true } });
  if (!owned) return { ok: false };
  if (action === "restore") {
    await prisma.insightDismissal.deleteMany({ where: { quizId, cardId } });
    return { ok: true };
  }
  const snoozedUntil = new Date(+now + INSIGHT_SNOOZE_DAYS * 86_400_000);
  // The unique key makes a re-dismissal an UPDATE — one row per (quiz, card),
  // however many times it is dismissed.
  await prisma.insightDismissal.upsert({
    where: { quizId_cardId: { quizId, cardId } },
    create: { quizId, cardId, snoozedUntil },
    update: { snoozedUntil },
  });
  return { ok: true };
}

/** Parse + apply a dismissal POST. Returns null when the form isn't one. */
export async function handleInsightDismissForm(
  shopId: string,
  form: FormData,
  now = new Date(),
): Promise<{ ok: boolean } | null> {
  const intent = form.get("intent");
  if (intent !== "dismiss-insight" && intent !== "restore-insight") return null;
  const quizId = form.get("quizId");
  const cardId = form.get("cardId");
  if (typeof quizId !== "string" || typeof cardId !== "string" || !quizId || !cardId) {
    return { ok: false };
  }
  return setInsightDismissal(shopId, quizId, cardId, intent === "dismiss-insight" ? "dismiss" : "restore", now);
}

// ── Per-quiz analytics ─────────────────────────────────────────────────────

export type AnalyticsDataState = "draft" | "no-data" | "low" | "healthy";

export interface ContactRow {
  id: string;
  emailMasked: string;
  capturedAt: string;
  result: string | null;
  recommended: string | null;
  recommendedMore: number;
  status: "bought" | "no-purchase" | "abandoned" | "unknown";
  noMatch: boolean;
  backInStock: boolean;
  /** Attributed order value for this contact's session ("" = none). */
  value: string | null;
}

export interface ProductRow extends ProductPerfRow {
  /**
   * Distinct ATTRIBUTED ORDERS whose line items contained this product (E7).
   * null on a doc whose orders predate line-item capture — an honest "we
   * can't know", not a zero. Counted per ORDER, deduped by order_id: one
   * order can win several sessions (W2), and each win writes its own event.
   */
  bought: number | null;
  state: "over-shown" | "healthy" | "never-clicked" | "unreachable" | "no-data";
  /** impressions ÷ finishers (exposure share). */
  share: number | null;
  /**
   * "How shoppers reach this product" (§04) — the answer that routes to each
   * result group holding it. Doc-static on decider docs: it is the quiz's own
   * logic, so it is right at zero traffic. Empty on legacy docs.
   */
  paths: Array<{ answer: string; question: string; target: string }>;
  /** How many result groups hold this product — the over-shown explanation. */
  groupCount: number;
}

export interface QuizAnalyticsData {
  quiz: { id: string; name: string; status: string; publishedAt: string | null };
  range: { preset: RangePreset; from: string | null; to: string; label: string; widened: boolean };
  dataState: AnalyticsDataState;
  xtype: ReturnType<typeof experienceTypeOf>;
  /** "none" ⇒ order attribution is structurally impossible (standalone — W6). */
  attribution: "shopify" | "none";
  truncated: boolean;
  kpis: {
    engaged: number;
    completed: number;
    completion: GatedRate;
    captureSessions: number;
    capture: GatedRate;
    buyers: number;
    conversion: GatedRate;
    revenue: { formatted: string; orders: number; perFinisher: string | null };
    prior: { engaged: number; completed: number } | null;
    /**
     * Period-over-period movement. Rates move in POINTS, counts and money in
     * percent (§7.3 rule 4: colour is goodness, not direction). Null whenever
     * the prior period is too thin to compare — we never print a delta whose
     * interval includes zero.
     */
    deltas: {
      completionPoints: number | null;
      sessionsPct: number | null;
      revenuePct: number | null;
    };
  };
  insights: InsightsResult;
  /** Snoozed findings, so "Show dismissed" can list them with their return date. */
  dismissed: Array<{ id: string; headline: string; severity: "info" | "warn" | "crit"; until: string }>;
  ledger: StepLedger | null;
  answers: QuestionDistribution[];
  outcomes: Array<{ label: string; count: number }>;
  products: ProductRow[];
  productMeta: { mapped: number; unreachable: number } | null;
  contacts: {
    rows: ContactRow[];
    counts: {
      all: number;
      purchased: number;
      didntBuy: number;
      noMatch: number;
      backInStock: number;
      /** Finishers who never gave an email — measurable without the P2 gate event. */
      noEmail: number;
    };
    /** Distinct result names + products, for the two narrowing filters (§06). */
    filterOptions: { results: string[]; products: string[] };
  };
  /** Daily revenue buckets; the view rolls them up to week/month on demand. */
  revenueDays: Array<{ day: string; total: number; orders: number; finishers: number; currency: string }>;
  /** Attribution window in days, printed beside the chart. */
  attributionDays: number;
  /** Per-shopper response log (spec §03 "Individual responses"). */
  responses: {
    rows: Array<{
      sessionId: string;
      short: string;
      when: string;
      answers: Array<{ questionId: string; text: string }>;
      result: string | null;
      bought: boolean;
      leftAt: string | null;
    }>;
    total: number;
  };
  /** Effective catalogue size — exp(entropy) over impression share (§04). */
  effectiveCatalog: { effective: number; mapped: number } | null;
  months: Array<{
    key: string;
    label: string;
    engaged: number;
    completed: number;
    captures: number;
    orders: number;
    revenue: string;
    revenueNumeric: number;
    perFinisher: string | null;
    partial: boolean;
  }>;
  abTests: Array<{
    id: string;
    label: string;
    slots: Array<{
      id: string;
      label: string;
      share: number;
      funnel: { entered: number; started: number; answered: number; completed: number; viewed: number; clicked: number };
    }>;
  }>;
}

export async function quizAnalyticsForShop(
  shop: { id: string; source?: string },
  quizId: string,
  searchParams: URLSearchParams,
  now = new Date(),
): Promise<QuizAnalyticsData> {
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId: shop.id },
    select: { id: true, name: true, status: true, publishedJson: true, draftJson: true },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  // The publish timestamp lives in the baked doc, not on the Quiz row.
  const publishedAtRaw = asRecord(quiz.publishedJson)?.published_at;
  const publishedAt = typeof publishedAtRaw === "string" ? publishedAtRaw : null;

  let range = resolveAnalyticsRange(searchParams, now);
  const published = quiz.status === "published";

  // Cohort: sessions whose ENGAGE fell in range (most recent first, capped).
  const fetchCohort = async (r: AnalyticsRange) => {
    const rows = await prisma.event.findMany({
      where: {
        quizId,
        eventType: "quiz_engaged",
        ...(r.from ? { ts: { gte: r.from, lte: r.to } } : { ts: { lte: r.to } }),
      },
      select: { sessionId: true },
      orderBy: { ts: "desc" },
      take: ANALYTICS_SESSION_CAP + 1,
    });
    const ids = new Set(rows.map((x) => x.sessionId));
    return { ids, truncated: rows.length > ANALYTICS_SESSION_CAP };
  };

  let cohort = await fetchCohort(range);
  // Auto-widen (§8.3): a thin DEFAULT window opens on all time, and says so.
  if (published && range.preset === DEFAULT_PRESET && !searchParams.get("r") && cohort.ids.size < 30) {
    const wide = resolveAnalyticsRange(new URLSearchParams({ r: "all" }), now);
    const wideCohort = await fetchCohort(wide);
    if (wideCohort.ids.size > cohort.ids.size) {
      range = { ...wide, widened: true };
      cohort = wideCohort;
    }
  }

  const cohortIds = [...cohort.ids];
  // All events for the cohort, regardless of ts (the cohorting correction).
  const events: CohortEventRow[] = cohortIds.length
    ? await prisma.event.findMany({
        where: { quizId, sessionId: { in: cohortIds } },
        select: { sessionId: true, eventType: true, payload: true, ts: true },
      })
    : [];

  const engagedSet = cohort.ids;
  const completedSet = distinct(events, "quiz_completed");
  // A completion outside its own engage-cohort can't happen by construction;
  // intersect defensively anyway so the invariant completed ≤ engaged HOLDS.
  for (const sid of completedSet) if (!engagedSet.has(sid)) completedSet.delete(sid);
  const engaged = engagedSet.size;
  const completed = completedSet.size;

  // Captures — DISTINCT capture SESSIONS (W10: rows are not shoppers; the gate,
  // the result form and a back-nav resubmit all write a row for one shopper).
  // Fetched BY COHORT SESSION, not by capturedAt: the range cohorts sessions,
  // so a shopper who engages Monday and submits Thursday still counts once, and
  // the query is bounded by the cohort rather than by an arbitrary row cap.
  const captureRows = cohortIds.length
    ? await prisma.emailCapture.findMany({
        where: { quizId, sessionId: { in: cohortIds } },
        select: { id: true, sessionId: true, email: true, capturedAt: true },
        orderBy: { capturedAt: "desc" },
      })
    : [];
  const captureSessions = new Set<string>();
  for (const c of captureRows) captureSessions.add(c.sessionId);

  // Revenue — order_attributed within the cohort, deduped by order_id.
  const orderEvents = events.filter((e) => e.eventType === "order_attributed");
  const revenue = totalRevenue(orderEvents);
  // "Buyers" — one order can be attributed to several sessions of the same
  // shopper (W2). Dedupe by order_id FIRST, then count the crediting sessions,
  // so buyers can never exceed orders for a single shared order.
  const buyersSet = new Set<string>();
  {
    const seenOrderIds = new Set<string>();
    for (const e of orderEvents) {
      const pl = asRecord(e.payload);
      const orderId = typeof pl?.order_id === "string" ? pl.order_id : null;
      if (orderId) {
        if (seenOrderIds.has(orderId)) continue;
        seenOrderIds.add(orderId);
      }
      buyersSet.add(e.sessionId);
    }
  }
  const buyers = buyersSet.size;
  const currencies = Object.entries(revenue.totalsByCurrency);
  const perFinisher =
    completed > 0 && currencies.length === 1
      ? formatRevenue({ orders: revenue.orders, totalsByCurrency: { [currencies[0]![0]]: currencies[0]![1] / completed } })
      : null;

  // Prior period (deltas) — same length immediately before `from`.
  let prior: { engaged: number; completed: number } | null = null;
  if (range.from) {
    const priorFrom = new Date(+range.from - (+range.to - +range.from));
    const priorRows = await prisma.event.findMany({
      where: { quizId, eventType: { in: ["quiz_engaged", "quiz_completed"] }, ts: { gte: priorFrom, lt: range.from } },
      select: { sessionId: true, eventType: true },
      distinct: ["eventType", "sessionId"],
      take: ANALYTICS_SESSION_CAP,
    });
    const pEng = new Set<string>();
    const pCom = new Set<string>();
    for (const r of priorRows) (r.eventType === "quiz_engaged" ? pEng : pCom).add(r.sessionId);
    prior = { engaged: pEng.size, completed: Math.min(pCom.size, pEng.size) };
  }

  // Doc + pure aggregations.
  const parsed = Quiz.safeParse(quiz.publishedJson ?? quiz.draftJson);
  const doc: QuizDoc | null = parsed.success ? parsed.data : null;
  const xtype = doc ? experienceTypeOf(doc) : "product_match";

  const ledgerEvents = events.map((e) => ({
    sessionId: e.sessionId,
    eventType: e.eventType,
    payload: e.payload,
    ts: +e.ts,
  }));
  const ledger = doc ? buildStepLedger(doc, ledgerEvents, engaged, completed) : null;
  const answers = doc ? answerDistributions(doc, ledgerEvents) : [];

  // Outcome distribution — legacy multi-result docs only (W9: a one-terminus
  // decider doc has one outcomeId for everyone; rendering it is noise).
  let outcomes: Array<{ label: string; count: number }> = [];
  const resultNodes = doc?.nodes.filter((n) => n.type === "result") ?? [];
  if (doc && doc.logic_model !== "decider" && resultNodes.length > 1) {
    const grouped = await prisma.quizSession.groupBy({
      by: ["outcomeId"],
      where: {
        quizId,
        completedAt: { not: null },
        ...(range.from ? { startedAt: { gte: range.from, lte: range.to } } : {}),
      },
      _count: { _all: true },
    });
    const headlineOf = (nid: string | null): string => {
      const n = nid ? doc.nodes.find((x) => x.id === nid) : undefined;
      return n && n.type === "result" ? n.data.headline || nid! : (nid ?? "unknown");
    };
    outcomes = grouped
      .map((g) => ({ label: headlineOf(g.outcomeId), count: g._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  // Products — preview impressions filtered OUT (W4), reachability joined in.
  const productMetaRows = await prisma.product.findMany({
    where: { shopId: shop.id },
    select: { productId: true, title: true, imageUrl: true, handle: true },
  });
  const perfRows = productPerformance(
    events.filter((e) => !isPreviewImpression(e)),
    productMetaRows,
    { limit: 50 },
  );
  const reachability = published ? computeReachability(quiz.publishedJson) : null;

  // productId → how many distinct attributed ORDERS contained it (E7).
  // Deduped by order_id first: one order can win several sessions and each win
  // writes its own event, so counting rows would multiply every purchase.
  // `anyLineItems` distinguishes "no orders bought it" from "these orders
  // predate line-item capture", which must not both render as 0.
  const boughtByProduct = new Map<string, number>();
  let anyLineItems = false;
  {
    const seenOrders = new Set<string>();
    for (const e of orderEvents) {
      const pl = asRecord(e.payload);
      const orderId = typeof pl?.order_id === "string" ? pl.order_id : null;
      if (orderId) {
        if (seenOrders.has(orderId)) continue;
        seenOrders.add(orderId);
      }
      const ids = Array.isArray(pl?.line_item_product_ids)
        ? pl.line_item_product_ids.filter((v): v is string => typeof v === "string")
        : null;
      if (ids === null) continue;
      anyLineItems = true;
      for (const pid of new Set(ids)) boughtByProduct.set(pid, (boughtByProduct.get(pid) ?? 0) + 1);
    }
  }

  // productId → the (question, answer) pairs whose target group holds it.
  // Decider-only: it reads the deciding question's answer→target mapping
  // against the baked membership, so it needs no traffic at all.
  const pathsByProduct = new Map<string, Array<{ answer: string; question: string; target: string }>>();
  const groupsByProduct = new Map<string, Set<string>>();
  {
    const baked = asRecord(quiz.publishedJson)?.target_product_ids_map as
      | Record<string, string[]>
      | undefined;
    const targetIndex = asRecord(quiz.publishedJson)?.target_index as
      | Record<string, { name?: string }>
      | undefined;
    if (doc?.logic_model === "decider" && baked) {
      for (const n of doc.nodes) {
        if (n.type !== "question" || n.data.role !== "decides") continue;
        for (const a of n.data.answers) {
          if (!a.target_id) continue;
          const members = baked[a.target_id] ?? [];
          const targetName = targetIndex?.[a.target_id]?.name ?? a.target_id;
          for (const pid of members) {
            const arr = pathsByProduct.get(pid) ?? [];
            if (arr.length < 4) arr.push({ answer: a.text, question: n.data.text, target: targetName });
            pathsByProduct.set(pid, arr);
            const g = groupsByProduct.get(pid) ?? new Set<string>();
            g.add(a.target_id);
            groupsByProduct.set(pid, g);
          }
        }
      }
    }
  }

  const products: ProductRow[] = perfRows.map((p) => {
    const unreachable = reachability?.stateById.get(p.productId) === "unreachable";
    const share = completed > 0 ? p.impressions / completed : null;
    let state: ProductRow["state"] = "no-data";
    if (unreachable) state = "unreachable";
    else if (p.impressions >= 100 && p.clicks === 0) state = "never-clicked";
    else if (share != null && share >= 0.4 && p.impressions >= 30) state = "over-shown";
    else if (p.impressions > 0) state = "healthy";
    return {
      ...p,
      bought: anyLineItems ? boughtByProduct.get(p.productId) ?? 0 : null,
      state,
      share,
      paths: pathsByProduct.get(p.productId) ?? [],
      groupCount: groupsByProduct.get(p.productId)?.size ?? 0,
    };
  });
  // Unreachable products with zero events still belong in the table.
  if (reachability) {
    const seen = new Set(products.map((p) => p.productId));
    for (const u of reachability.unreachable) {
      if (seen.has(u.productId)) continue;
      products.push({
        productId: u.productId,
        title: u.title,
        imageUrl: null,
        handle: null,
        impressions: 0,
        clicks: 0,
        addToCart: 0,
        ctr: 0,
        atcRate: 0,
        bought: anyLineItems ? 0 : null,
        state: "unreachable",
        share: null,
        paths: [],
        groupCount: 0,
      });
    }
  }

  // Contacts (Customer Engagement, rolled in — per-quiz, cohort-scoped rows).
  // One row per SHOPPER, not per capture row: the same W10 duplication that
  // inflated the rate would otherwise list one shopper twice in the table and
  // twice in the export. Rows arrive capturedAt-desc, so first-seen is latest.
  const seenContactSessions = new Set<string>();
  const rangedCaptures = captureRows.filter((c) => {
    if (seenContactSessions.has(c.sessionId)) return false;
    seenContactSessions.add(c.sessionId);
    return true;
  });
  const sessionRows = rangedCaptures.length
    ? await prisma.quizSession.findMany({
        where: { quizId, sessionId: { in: [...new Set(rangedCaptures.map((c) => c.sessionId))] } },
        select: { sessionId: true, outcomeId: true, matchedProductIds: true, converted: true, completedAt: true },
      })
    : [];
  const sessBySid = new Map(sessionRows.map((s) => [s.sessionId, s]));
  const bis = await prisma.backInStockRequest.findMany({ where: { quizId }, select: { email: true } });
  const bisEmails = new Set(bis.map((b) => b.email.toLowerCase()));
  const prodTitle = new Map(productMetaRows.map((p) => [p.productId, p.title]));
  const catRows = await prisma.category.findMany({ where: { shopId: shop.id }, select: { id: true, name: true } });
  const catName = new Map(catRows.map((c) => [c.id, c.name]));
  const orderValueBySession = new Map<string, string>();
  {
    const seenOrders = new Set<string>();
    for (const e of orderEvents) {
      const p = asRecord(e.payload);
      const orderId = typeof p?.order_id === "string" ? p.order_id : null;
      if (!orderId || seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);
      const total = typeof p?.total_price === "string" ? p.total_price : null;
      const currency = typeof p?.currency === "string" ? p.currency : "";
      if (total) orderValueBySession.set(e.sessionId, `${total}${currency ? ` ${currency}` : ""}`);
    }
  }
  const contactRows: ContactRow[] = rangedCaptures.slice(0, 500).map((c) => {
    const s = sessBySid.get(c.sessionId);
    const noMatch = Boolean(s && s.completedAt && s.matchedProductIds.length === 0);
    const recTitles = (s?.matchedProductIds ?? []).map((id) => prodTitle.get(id)).filter((t): t is string => !!t);
    return {
      id: c.id,
      emailMasked: maskEmail(c.email),
      capturedAt: c.capturedAt.toISOString(),
      result: s?.outcomeId ? catName.get(s.outcomeId) ?? null : null,
      recommended: recTitles[0] ?? null,
      recommendedMore: Math.max(0, (s?.matchedProductIds.length ?? 0) - 1),
      status: s ? (s.converted ? "bought" : s.completedAt ? "no-purchase" : "abandoned") : "unknown",
      noMatch,
      backInStock: bisEmails.has(c.email.toLowerCase()),
      value: orderValueBySession.get(c.sessionId) ?? null,
    };
  });
  const contactCounts = {
    all: contactRows.length,
    purchased: contactRows.filter((c) => c.status === "bought").length,
    didntBuy: contactRows.filter((c) => c.status !== "bought").length,
    noMatch: contactRows.filter((c) => c.noMatch).length,
    backInStock: contactRows.filter((c) => c.backInStock).length,
    // The spec's "skipped the gate" needs an email_gate_skipped event that
    // doesn't exist yet (P2). What IS measurable today: finishers who never
    // gave an email. Labelled for what it is, not for what we wish it were.
    noEmail: Math.max(0, completed - captureSessions.size),
  };
  const contactFilterOptions = {
    results: [...new Set(contactRows.map((c) => c.result).filter((v): v is string => !!v))].sort(),
    products: [...new Set(contactRows.map((c) => c.recommended).filter((v): v is string => !!v))].sort(),
  };

  // Revenue by DAY — bucketed server-side (never ship 5,000 rows to draw 13
  // bars). The view rolls days up to week/month for the grain toggle, so
  // switching grain costs no round-trip and every grain sums the same total.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dayBuckets = new Map<string, { orders: CohortEventRow[]; finishers: Set<string> }>();
  const dayOf = (k: string) => {
    let b = dayBuckets.get(k);
    if (!b) {
      b = { orders: [], finishers: new Set() };
      dayBuckets.set(k, b);
    }
    return b;
  };
  for (const e of orderEvents) dayOf(dayKey(e.ts)).orders.push(e);
  // Finishers land on the day the session ENGAGED, matching the cohort basis —
  // otherwise per-finisher revenue divides two different populations.
  const engageDay = new Map<string, string>();
  for (const e of events) {
    if (e.eventType !== "quiz_engaged") continue;
    const prev = engageDay.get(e.sessionId);
    const k = dayKey(e.ts);
    if (!prev || k < prev) engageDay.set(e.sessionId, k);
  }
  for (const sid of completedSet) {
    const k = engageDay.get(sid);
    if (k) dayOf(k).finishers.add(sid);
  }
  const revenueDays = [...dayBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => {
      const rev = totalRevenue(b.orders);
      const [cur, amt] = Object.entries(rev.totalsByCurrency)[0] ?? ["", 0];
      return { day, total: amt, orders: rev.orders, finishers: b.finishers.size, currency: cur };
    });

  // Month-by-month compare — recomputed per month, never averaged (§ spec 07).
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthAgg = new Map<
    string,
    { engaged: Set<string>; completed: Set<string>; orders: CohortEventRow[] }
  >();
  const engageTs = new Map<string, Date>();
  for (const e of events) {
    if (e.eventType !== "quiz_engaged") continue;
    const prev = engageTs.get(e.sessionId);
    if (!prev || e.ts < prev) engageTs.set(e.sessionId, e.ts);
  }
  const bucketOf = (k: string) => {
    let b = monthAgg.get(k);
    if (!b) {
      b = { engaged: new Set(), completed: new Set(), orders: [] };
      monthAgg.set(k, b);
    }
    return b;
  };
  for (const [sid, ts] of engageTs) {
    const b = bucketOf(monthKey(ts));
    b.engaged.add(sid);
    if (completedSet.has(sid)) b.completed.add(sid); // a session's month = its engage month
  }
  for (const e of orderEvents) bucketOf(monthKey(e.ts)).orders.push(e);
  const captureMonth = new Map<string, number>();
  for (const c of rangedCaptures) {
    const k = monthKey(c.capturedAt);
    captureMonth.set(k, (captureMonth.get(k) ?? 0) + 1);
  }
  const nowKey = monthKey(now);
  const months = [...monthAgg.keys()]
    .sort()
    .reverse()
    .slice(0, 24)
    .map((k) => {
      const b = monthAgg.get(k)!;
      const rev = totalRevenue(b.orders);
      const [y, m] = k.split("-");
      const label = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      const entries = Object.entries(rev.totalsByCurrency);
      const revTotal = entries.reduce((sum, [, amt]) => sum + amt, 0);
      const finishers = b.completed.size;
      return {
        key: k,
        label,
        engaged: b.engaged.size,
        completed: finishers,
        captures: captureMonth.get(k) ?? 0,
        orders: rev.orders,
        revenue: formatRevenue(rev),
        revenueNumeric: revTotal,
        perFinisher:
          finishers > 0 && entries.length === 1
            ? formatRevenue({ orders: 0, totalsByCurrency: { [entries[0]![0]]: revTotal / finishers } })
            : null,
        partial: k === nowKey,
      };
    });

  // A/B variants (previously embedded-only — W14; now both surfaces).
  const abTests = doc
    ? findAbBranches(doc).map((br) => {
        const funnels = aggregateVariantFunnel(ledgerEvents, br.id, br.data.slots);
        const totalWeight = br.data.slots.reduce((s, sl) => s + sl.weight, 0);
        return {
          id: br.id,
          label: br.data.label || "A/B test",
          slots: br.data.slots.map((sl) => ({
            id: sl.id,
            label: sl.label,
            share: totalWeight > 0 ? Math.round((sl.weight / totalWeight) * 100) : 0,
            funnel:
              funnels[sl.id] ?? { entered: 0, started: 0, answered: 0, completed: 0, viewed: 0, clicked: 0 },
          })),
        };
      })
    : [];

  // Data-state ladder (§8.4).
  let dataState: AnalyticsDataState;
  if (!published) dataState = "draft";
  else if (engaged === 0) {
    const any = await prisma.event.findFirst({ where: { quizId, eventType: "quiz_engaged" }, select: { id: true } });
    dataState = any ? "low" : "no-data";
  } else dataState = engaged < 30 ? "low" : "healthy";

  // Dismissals — a snoozed card is hidden until its 14 days lapse.
  const dismissalState = (await loadDismissals([quizId], now)).get(quizId) ?? {
    active: new Set<string>(),
    until: new Map<string, Date>(),
  };

  // Insights — doc-static rules always run; traffic rules gate themselves.
  const insightsRaw: InsightsResult = doc
    ? buildQuizInsights({
        doc,
        reachability,
        ledger,
        engaged,
        completed,
        rangeDays:
          range.days ||
          Math.max(1, Math.round((+range.to - +(publishedAt ? new Date(publishedAt) : range.to)) / 86_400_000)),
        published,
        contactsNoMatch: contactCounts.noMatch,
        contactsTotal: contactCounts.all,
        contactsNoMatchBought: contactRows.filter((c) => c.noMatch && c.status === "bought").length,
      })
    : { cards: [], more: 0, clean: true };

  // Filter AFTER ranking so the 3-card cap fills with the next real finding
  // rather than leaving a hole where a dismissed one sat.
  const visibleCards = insightsRaw.cards.filter((c) => !dismissalState.active.has(c.id));
  const insights: InsightsResult = {
    cards: visibleCards,
    more: insightsRaw.more,
    clean: visibleCards.length === 0,
  };
  const dismissed = insightsRaw.cards
    .filter((c) => dismissalState.active.has(c.id))
    .map((c) => ({
      id: c.id,
      headline: c.headline,
      severity: c.severity,
      until: (dismissalState.until.get(c.id) ?? now).toISOString(),
    }));

  // Period-over-period deltas. Rates move in POINTS, counts in percent. We
  // suppress a delta whenever either side is too thin to mean anything —
  // a "+40%" off 5 sessions is noise dressed as a result (§7.3 rule 1).
  const DELTA_MIN = 30;
  const priorCompletion =
    prior && prior.engaged > 0 ? prior.completed / prior.engaged : null;
  const deltas = {
    completionPoints:
      prior && prior.engaged >= DELTA_MIN && engaged >= DELTA_MIN && priorCompletion != null
        ? Math.round((completed / Math.max(1, engaged) - priorCompletion) * 1000) / 10
        : null,
    sessionsPct:
      prior && prior.engaged >= DELTA_MIN
        ? Math.round(((engaged - prior.engaged) / prior.engaged) * 100)
        : null,
    revenuePct: null as number | null,
  };

  // Per-shopper response log (§03). Sessions rows only exist for shoppers who
  // reached a result, so reading QuizSession alone drops the ~30% who left —
  // the log unions the cohort's ANSWER events with the session facts.
  const answerBySession = new Map<string, Map<string, string[]>>();
  const lastTs = new Map<string, Date>();
  for (const e of events) {
    if (e.eventType !== "question_answered") continue;
    const pl = asRecord(e.payload);
    const qid = typeof pl?.question_id === "string" ? pl.question_id : null;
    if (!qid) continue;
    const ids = Array.isArray(pl?.answer_ids)
      ? pl.answer_ids.filter((v): v is string => typeof v === "string")
      : [];
    let per = answerBySession.get(e.sessionId);
    if (!per) {
      per = new Map();
      answerBySession.set(e.sessionId, per);
    }
    per.set(qid, ids);
    const prevTs = lastTs.get(e.sessionId);
    if (!prevTs || e.ts > prevTs) lastTs.set(e.sessionId, e.ts);
  }
  // Answer id → label, and question order, straight from the doc.
  const answerLabel = new Map<string, string>();
  const questionOrder: string[] = [];
  if (doc) {
    for (const n of doc.nodes) {
      if (n.type !== "question") continue;
      questionOrder.push(n.id);
      for (const a of n.data.answers) answerLabel.set(a.id, a.text);
    }
  }
  const RESPONSE_PAGE = 100;
  const orderedSessions = [...answerBySession.keys()].sort(
    (a, b) => (+(lastTs.get(b) ?? 0)) - (+(lastTs.get(a) ?? 0)),
  );
  const buyerSessions = buyersSet;
  const sessionFacts = cohortIds.length
    ? await prisma.quizSession.findMany({
        where: { quizId, sessionId: { in: orderedSessions.slice(0, RESPONSE_PAGE) } },
        select: { sessionId: true, outcomeId: true },
      })
    : [];
  const outcomeBySession = new Map(sessionFacts.map((f) => [f.sessionId, f.outcomeId]));
  const responseRows = orderedSessions.slice(0, RESPONSE_PAGE).map((sid) => {
    const per = answerBySession.get(sid)!;
    const finished = completedSet.has(sid);
    // Where an unfinished shopper stopped — the last question they answered.
    let lastAnswered: string | null = null;
    for (const qid of questionOrder) if (per.has(qid)) lastAnswered = qid;
    const labelOf = (qid: string) =>
      (per.get(qid) ?? []).map((id) => answerLabel.get(id) ?? "—").join(", ") || "skipped";
    const outcomeId = outcomeBySession.get(sid) ?? null;
    return {
      sessionId: sid,
      // Sessions ids are opaque already; show a short form so the column stays
      // scannable and no full identifier is pasted around.
      short: `${sid.slice(0, 4)}…${sid.slice(-3)}`,
      when: (lastTs.get(sid) ?? range.to).toISOString(),
      answers: questionOrder.filter((qid) => per.has(qid)).map((qid) => ({ questionId: qid, text: labelOf(qid) })),
      result: finished ? (outcomeId ? catName.get(outcomeId) ?? null : null) : null,
      bought: buyerSessions.has(sid),
      leftAt: finished
        ? null
        : lastAnswered
          ? `left at ${questionOrder.indexOf(lastAnswered) + 1 <= questionOrder.length ? `Q${questionOrder.indexOf(lastAnswered) + 1}` : "the end"}`
          : "left at the start",
    };
  });

  // Effective catalogue size — exp(Shannon entropy) over impression share.
  // "You map 84 products but effectively recommend 4.2 of them" is the honest
  // read of concentration; a raw count of shown products is not.
  let effectiveCatalog: { effective: number; mapped: number } | null = null;
  {
    const totalImp = products.reduce((sum, p) => sum + p.impressions, 0);
    if (totalImp > 0 && reachability) {
      let h = 0;
      for (const p of products) {
        if (p.impressions <= 0) continue;
        const share = p.impressions / totalImp;
        h -= share * Math.log(share);
      }
      effectiveCatalog = { effective: Math.round(Math.exp(h) * 10) / 10, mapped: reachability.mapped };
    }
  }

  // W6 — standalone workspaces have no Shopify order feed; a confident "0.0%"
  // conversion rate there is a category error, not a measurement.
  const attribution: "shopify" | "none" = (shop.source ?? "shopify") === "standalone" ? "none" : "shopify";

  return {
    quiz: {
      id: quiz.id,
      name: quiz.name,
      status: quiz.status,
      publishedAt,
    },
    range: {
      preset: range.preset,
      from: range.from ? range.from.toISOString() : null,
      to: range.to.toISOString(),
      label: range.widened ? "Since published" : range.label,
      widened: range.widened,
    },
    dataState,
    xtype,
    attribution,
    truncated: cohort.truncated,
    kpis: {
      engaged,
      completed,
      completion: gateRate("completion_rate", completed, engaged),
      captureSessions: captureSessions.size,
      capture: gateRate("capture_rate", captureSessions.size, completed),
      buyers,
      conversion: gateRate("conversion_rate", buyers, completed),
      revenue: { formatted: formatRevenue(revenue), orders: revenue.orders, perFinisher },
      prior,
      deltas,
    },
    insights,
    dismissed,
    ledger,
    answers,
    outcomes,
    products,
    productMeta: reachability ? { mapped: reachability.mapped, unreachable: reachability.unreachable.length } : null,
    contacts: { rows: contactRows, counts: contactCounts, filterOptions: contactFilterOptions },
    revenueDays,
    attributionDays: ATTRIBUTION_WINDOW_DAYS,
    responses: { rows: responseRows, total: orderedSessions.length },
    effectiveCatalog,
    months,
    abTests,
  };
}

// ── Shop-level home (Screen 1) ─────────────────────────────────────────────

/**
 * One row per quiz — live AND draft in the SAME table (spec Screen 1). A
 * draft's metrics are `null`, never 0: it has no data, which is not the same
 * as having none, and the table renders an em-dash for the difference.
 */
export interface ShopQuizRow {
  id: string;
  name: string;
  live: boolean;
  /** Short structural warning for the Status cell ("1 result only"). */
  flag: string | null;
  starts: number | null;
  completion: GatedRate | null;
  contacts: number | null;
  orders: number | null;
  revenue: string | null;
  /** Sort keys — the formatted strings above aren't orderable. */
  revenueNumeric: number | null;
  perFinisher: string | null;
  perFinisherNumeric: number | null;
  questions: number;
  outcomes: number;
}

export interface ShopAnalyticsData {
  range: { preset: RangePreset; from: string | null; to: string; label: string };
  tiles: {
    sessions: number;
    sessionsDeltaPct: number | null;
    completion: GatedRate;
    finished: number;
    contacts: number;
    captureOfFinishers: GatedRate;
    revenue: string;
    orders: number;
    perFinisher: string | null;
  };
  rows: ShopQuizRow[];
  counts: { all: number; live: number; draft: number };
  findings: Array<{
    quizId: string;
    quizName: string;
    /** Stable card id — the dismissal key. */
    cardId: string;
    severity: InsightSeverityLike;
    headline: string;
    body: string;
    evidence: Array<{ label: string; value: string }>;
    basis: string;
  }>;
  /** How many findings are currently snoozed across the shop. */
  dismissedCount: number;
}

type InsightSeverityLike = "info" | "warn" | "crit";

/**
 * The page shows only the most recently updated quizzes. Every cost on this
 * page scales with quiz count × doc size (full draft+published JSON fetched,
 * Zod-parsed, and run through the insights engine per quiz), so the cap is
 * what keeps the loader flat as a shop accumulates drafts.
 */
const SHOP_ANALYTICS_QUIZ_LIMIT = 10;

export async function shopAnalyticsForShop(
  shop: { id: string; source?: string },
  searchParams: URLSearchParams,
  now = new Date(),
): Promise<ShopAnalyticsData> {
  const range = resolveAnalyticsRange(searchParams, now);
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true, draftJson: true, publishedJson: true },
    orderBy: { updatedAt: "desc" },
    take: SHOP_ANALYTICS_QUIZ_LIMIT,
  });
  const quizIds = quizzes.map((q) => q.id);
  const tsFilter = range.from ? { ts: { gte: range.from, lte: range.to } } : { ts: { lte: range.to } };

  const [funnelRows, orderRows, captureRows, priorFunnelRows] = await Promise.all([
    quizIds.length
      ? prisma.event.findMany({
          where: { quizId: { in: quizIds }, eventType: { in: ["quiz_engaged", "quiz_completed"] }, ...tsFilter },
          select: { quizId: true, eventType: true, sessionId: true },
          distinct: ["quizId", "eventType", "sessionId"],
          take: 50_000,
        })
      : Promise.resolve([]),
    quizIds.length
      ? prisma.event.findMany({
          where: { quizId: { in: quizIds }, eventType: "order_attributed", ...tsFilter },
          select: { quizId: true, sessionId: true, eventType: true, payload: true, ts: true },
          orderBy: { ts: "asc" },
          take: 20_000,
        })
      : Promise.resolve([]),
    quizIds.length
      ? prisma.emailCapture.findMany({
          where: {
            quizId: { in: quizIds },
            ...(range.from ? { capturedAt: { gte: range.from, lte: range.to } } : { capturedAt: { lte: range.to } }),
          },
          select: { quizId: true, sessionId: true },
          take: 50_000,
        })
      : Promise.resolve([]),
    quizIds.length && range.from
      ? prisma.event.findMany({
          where: {
            quizId: { in: quizIds },
            eventType: "quiz_engaged",
            ts: { gte: new Date(+range.from - (+range.to - +range.from)), lt: range.from },
          },
          select: { quizId: true, eventType: true, sessionId: true },
          distinct: ["quizId", "eventType", "sessionId"],
          take: 50_000,
        })
      : Promise.resolve([]),
  ]);

  // Per-quiz distinct engage/complete.
  const agg = new Map<string, { engaged: Set<string>; completed: Set<string> }>();
  const aggOf = (id: string) => {
    let a = agg.get(id);
    if (!a) {
      a = { engaged: new Set(), completed: new Set() };
      agg.set(id, a);
    }
    return a;
  };
  for (const r of funnelRows) {
    (r.eventType === "quiz_engaged" ? aggOf(r.quizId).engaged : aggOf(r.quizId).completed).add(r.sessionId);
  }

  // W2 (display-side) — dedupe orders GLOBALLY by order_id first, keeping the
  // earliest row, THEN shard to quizzes. One order can no longer credit
  // several quizzes at once on this page.
  const seenOrders = new Set<string>();
  const ordersByQuiz = new Map<string, Array<{ sessionId: string; eventType: string; payload: unknown }>>();
  for (const r of orderRows) {
    const p = asRecord(r.payload);
    const orderId = typeof p?.order_id === "string" ? p.order_id : null;
    if (orderId) {
      if (seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);
    }
    const arr = ordersByQuiz.get(r.quizId) ?? [];
    arr.push({ sessionId: r.sessionId, eventType: r.eventType, payload: r.payload });
    ordersByQuiz.set(r.quizId, arr);
  }

  // Distinct capture SESSIONS per quiz (W10).
  const capturesByQuiz = new Map<string, Set<string>>();
  for (const c of captureRows) {
    const s = capturesByQuiz.get(c.quizId) ?? new Set();
    s.add(c.sessionId);
    capturesByQuiz.set(c.quizId, s);
  }

  const rows: ShopQuizRow[] = [];
  const findings: ShopAnalyticsData["findings"] = [];
  const dismissals = await loadDismissals(quizIds, now);
  let dismissedCount = 0;

  let totalEngaged = 0;
  let totalCompleted = 0;
  let totalContacts = 0;
  let totalOrders = 0;
  const totalRevenueByCur: Record<string, number> = {};

  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.publishedJson ?? q.draftJson);
    const doc = parsed.success ? parsed.data : null;
    const isLive = q.status === "published";

    // Doc-static findings run on EVERY quiz, drafts included — they read the
    // quiz's own logic, so they need no traffic (spec Screen 1/3).
    let flag: string | null = null;
    if (doc) {
      const reachability = isLive ? computeReachability(q.publishedJson) : null;
      const r = buildQuizInsights({
        doc,
        reachability,
        ledger: null,
        engaged: 0,
        completed: 0,
        rangeDays: range.days,
        published: isLive,
      });
      const tierA = r.cards.filter((c) => c.tier === "A");
      for (const card of tierA) {
        if (dismissals.get(q.id)?.active.has(card.id)) {
          dismissedCount += 1;
          continue;
        }
        findings.push({
          quizId: q.id,
          quizName: q.name,
          cardId: card.id,
          severity: card.severity,
          headline: card.headline,
          body: card.body,
          evidence: card.evidence,
          basis: card.basis,
        });
      }
      // The Status cell carries the worst structural finding as a short chip,
      // so a broken quiz is visible in the list without opening it.
      flag = tierA.find((c) => c.chip)?.chip ?? null;
    }

    const a = aggOf(q.id);
    // W11 — clamp the numerator to the denominator and NEVER fall back to the
    // raw completed count when the clamp lands on 0. A quiz whose engages fell
    // outside the window would otherwise report 100% completion and poison the
    // pooled shop average.
    const completedN = Math.min(a.completed.size, a.engaged.size);
    const rev = totalRevenue(ordersByQuiz.get(q.id) ?? []);
    const revEntries = Object.entries(rev.totalsByCurrency);
    const revTotal = revEntries.reduce((s, [, amt]) => s + amt, 0);
    const perFinisherNumeric = completedN > 0 && revEntries.length === 1 ? revTotal / completedN : null;
    const contacts = capturesByQuiz.get(q.id)?.size ?? 0;

    rows.push({
      id: q.id,
      name: q.name,
      live: isLive,
      flag,
      questions: doc ? doc.nodes.filter((n) => n.type === "question").length : 0,
      outcomes: doc ? distinctOutcomes(doc) : 0,
      // A draft's metrics are null, never 0 — it has no data, which is not the
      // same as having none. The table renders an em-dash for the difference.
      starts: isLive ? a.engaged.size : null,
      completion: isLive ? gateRate("completion_rate", completedN, a.engaged.size) : null,
      contacts: isLive ? contacts : null,
      orders: isLive ? rev.orders : null,
      revenue: isLive ? formatRevenue(rev) : null,
      revenueNumeric: isLive ? revTotal : null,
      perFinisher:
        isLive && perFinisherNumeric != null && revEntries.length === 1
          ? formatRevenue({ orders: 0, totalsByCurrency: { [revEntries[0]![0]]: perFinisherNumeric } })
          : null,
      perFinisherNumeric: isLive ? perFinisherNumeric : null,
    });

    if (!isLive) continue;
    totalEngaged += a.engaged.size;
    totalCompleted += completedN;
    totalContacts += contacts;
    totalOrders += rev.orders;
    for (const [cur, amt] of revEntries) totalRevenueByCur[cur] = (totalRevenueByCur[cur] ?? 0) + amt;
  }

  // Default order: revenue desc (the mock's default sort). Drafts have no
  // number to rank, so they keep together at the bottom, alphabetically.
  rows.sort(
    (a, b) =>
      (b.revenueNumeric ?? -1) - (a.revenueNumeric ?? -1) ||
      (b.starts ?? -1) - (a.starts ?? -1) ||
      a.name.localeCompare(b.name),
  );
  findings.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const priorEngaged = new Set(priorFunnelRows.map((r) => `${r.quizId}:${r.sessionId}`)).size;
  const totalCurEntries = Object.entries(totalRevenueByCur);
  const perFinisher =
    totalCompleted > 0 && totalCurEntries.length === 1
      ? formatRevenue({
          orders: 0,
          totalsByCurrency: { [totalCurEntries[0]![0]]: totalCurEntries[0]![1] / totalCompleted },
        })
      : null;

  return {
    range: {
      preset: range.preset,
      from: range.from ? range.from.toISOString() : null,
      to: range.to.toISOString(),
      label: range.label,
    },
    tiles: {
      sessions: totalEngaged,
      sessionsDeltaPct:
        range.from && priorEngaged > 0 ? Math.round(((totalEngaged - priorEngaged) / priorEngaged) * 100) : null,
      completion: gateRate("completion_rate", totalCompleted, totalEngaged),
      finished: totalCompleted,
      contacts: totalContacts,
      captureOfFinishers: gateRate("capture_rate", totalContacts, totalCompleted),
      revenue: formatRevenue({ orders: totalOrders, totalsByCurrency: totalRevenueByCur }),
      orders: totalOrders,
      perFinisher,
    },
    rows,
    counts: {
      all: rows.length,
      live: rows.filter((r) => r.live).length,
      draft: rows.filter((r) => !r.live).length,
    },
    findings: findings.slice(0, 3),
    dismissedCount,
  };
}

const SEV_ORDER: Record<InsightSeverityLike, number> = { crit: 0, warn: 1, info: 2 };
