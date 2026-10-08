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
import type { QuestionDistribution } from "./answerDistribution";
import { buildQuizInsights, distinctOutcomes, INSIGHT_SNOOZE_DAYS, type InsightsResult } from "./quizInsights";
import { gateRate, type GatedRate } from "./analyticsConfidence";
import { ATTRIBUTION_WINDOW_DAYS } from "./conversionAttribution";
import {
  computeCohort,
  revenueNumber,
  type CohortCapture,
  type CohortEvent,
  type CohortFigures,
  type CohortSessionRow,
  type ContactStatus,
} from "./analyticsCohort";
import { buildResultContext } from "./sessionResult";
import { lineRevenueByProduct } from "./orderLines";
import { returnsByProduct } from "./orderRefunds";
import { logicReachability } from "./logicReachability";
import type { ReachWay } from "./productReach";
import { buildStepLedger, questionPath, type QuestionPath, type StepLedger } from "./stepLedger";

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
  all: "All time",
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

/** The attribution window, printed beside every revenue figure (§6.5). One
 *  constant, owned by the matcher the orders webhook runs. */
export { ATTRIBUTION_WINDOW_DAYS };

interface CohortEventRow {
  sessionId: string;
  eventType: string;
  payload: unknown;
  ts: Date;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/**
 * Did this contact ask to be told when something is back in stock? Matched
 * on THIS quiz's request from the same session (handoff: "not by email across
 * the whole shop"); a request saved before sessions were recorded falls back
 * to the email, still within this quiz.
 */
export function backInStockMatcher(
  requests: Array<{ email: string; sessionId: string | null }>,
): (sessionId: string, email: string) => boolean {
  const sessions = new Set<string>();
  const legacyEmails = new Set<string>();
  for (const r of requests) {
    if (r.sessionId) sessions.add(r.sessionId);
    else legacyEmails.add(r.email.toLowerCase());
  }
  return (sessionId, email) => sessions.has(sessionId) || legacyEmails.has(email.toLowerCase());
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

/** Contacts shipped to the page per load; counts always cover every contact. */
export const CONTACT_ROWS_SHIPPED = 500;

export interface ContactRow {
  id: string;
  sessionId: string;
  emailMasked: string;
  capturedAt: string;
  /** Result id (see sessionResult.ts); null = left before a result. */
  resultId: string | null;
  result: string | null;
  recommended: string | null;
  recommendedMore: number;
  recommendedIds: string[];
  /** Bought = an attributed order; Added = added to cart through the quiz, no order. */
  status: ContactStatus;
  /** null = the quiz never asked. */
  consent: boolean | null;
  noMatch: boolean;
  backInStock: boolean;
  /** Attributed order value for this contact's session (null = none). */
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
  /** Line revenue (price × quantity after discounts); null = no order carries lines. */
  revenue: number | null;
  /** Share of all product line revenue in attributed orders. */
  revenueShare: number | null;
  /** Units across those lines. */
  units: number | null;
  /** Units refunded as returns on attributed orders (null = no order carries lines). */
  returned: number | null;
  /** Median days from order to refund; null when nothing came back. */
  daysToReturn: number | null;
  /** Mapped, but no answer path reaches it (the "No logic" flag). */
  noLogic: boolean;
  /** impressions ÷ finishers (exposure share). */
  share: number | null;
  /**
   * "How shoppers reach this product" (§04) — every way in, in the Logic
   * step's own words (starting set, narrows, rules), each with the result it
   * lands on (productReach.ts). Doc-static on published decider docs, so it is
   * right at zero traffic. Empty on legacy docs.
   */
  ways: ReachWay[];
  /** How many result groups hold this product. */
  groupCount: number;
}

export interface ResultSummaryRow {
  resultId: string;
  name: string;
  noMatch: boolean;
  /** Shoppers who finished on this result. */
  count: number;
  contacts: number;
  contactsBought: number;
  contactsAdded: number;
  contactsNoPurchase: number;
  bought: number;
  orders: number;
  revenue: number;
  revenueFormatted: string;
  aov: string | null;
}

/** The previous period, counted exactly like the current one (Data work 4). */
export interface PeriodFigures {
  from: string;
  to: string;
  started: number;
  finished: number;
  contacts: number;
  canEmail: number;
  bought: number;
  orders: number;
  revenue: number;
  revenueFormatted: string;
  /** nodeId → that step's figures. */
  steps: Record<string, { reached: number | null; left: number | null; dropoff: number | null }>;
  steepestNodeId: string | null;
  typicalDropoff: number | null;
  /** answerId → share of the question's answered shoppers. */
  answerShares: Record<string, number>;
  /** The previous window's daily revenue, for the paired bars. */
  revenueDays: RevenueDay[];
}

export interface QuizAnalyticsData {
  quiz: { id: string; name: string; status: string; publishedAt: string | null };
  range: { preset: RangePreset; from: string | null; to: string; label: string; widened: boolean };
  /** True when ?cmp=1 asked for the previous period. */
  compare: boolean;
  dataState: AnalyticsDataState;
  xtype: ReturnType<typeof experienceTypeOf>;
  /** "none" ⇒ order attribution is structurally impossible (standalone — W6). */
  attribution: "shopify" | "none";
  truncated: boolean;
  /** The single currency revenue is in; null when none or several. */
  currency: string | null;
  kpis: {
    engaged: number;
    completed: number;
    completion: GatedRate;
    captureSessions: number;
    capture: GatedRate;
    canEmail: number;
    /** Converted sessions — shoppers with at least one attributed order. */
    buyers: number;
    conversion: GatedRate;
    revenue: {
      formatted: string;
      numeric: number;
      orders: number;
      perFinisher: string | null;
      aov: string | null;
    };
    prior: PeriodFigures | null;
    /**
     * Period-over-period movement. Rates move in POINTS, counts and money in
     * percent (§7.3 rule 4: colour is goodness, not direction). Null whenever
     * the prior period is too thin to compare.
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
  /** questionId → the path that alone sees it (branching quizzes). Absent =
   *  every shopper sees the question. */
  answerPaths: Record<string, QuestionPath>;
  /** Finished shoppers per result (legacy result nodes, decider targets). */
  outcomes: Array<{ label: string; count: number }>;
  results: ResultSummaryRow[];
  products: ProductRow[];
  /** The five products with the most line revenue in attributed orders. */
  topProducts: Array<{ productId: string; title: string; revenue: number; revenueFormatted: string; orders: number }>;
  /** Earliest order carrying line items (ISO), null = none yet. */
  lineItemsSince: string | null;
  productMeta: { mapped: number; unreachable: number } | null;
  contacts: {
    rows: ContactRow[];
    counts: {
      all: number;
      canEmail: number;
      purchased: number;
      added: number;
      noPurchase: number;
      addedCanEmail: number;
      noPurchaseCanEmail: number;
      didntBuy: number;
      noMatch: number;
      backInStock: number;
      /** Finishers who never gave an email. */
      noEmail: number;
    };
    /** Distinct result names + products, for the two narrowing filters (§06). */
    filterOptions: { results: string[]; products: string[] };
  };
  /** Daily revenue buckets; the view rolls them up to week/month on demand. */
  revenueDays: RevenueDay[];
  /** The shop's Klaviyo connection exists ("Create Klaviyo segment" vs "Connect Klaviyo"). */
  klaviyoConnected: boolean;
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

/** The previous window: the same number of days immediately before `from`. */
export function previousRange(range: AnalyticsRange): AnalyticsRange | null {
  if (!range.from) return null;
  const span = +range.to - +range.from;
  return {
    preset: "custom",
    from: new Date(+range.from - span),
    to: new Date(+range.from - 1),
    label: "Previous period",
    days: range.days,
    widened: false,
  };
}

function money(totals: Record<string, number>): { numeric: number; formatted: string; single: string | null } {
  const entries = Object.entries(totals);
  return {
    numeric: revenueNumber(totals),
    formatted: formatRevenue({ orders: 0, totalsByCurrency: totals }),
    single: entries.length === 1 ? entries[0]![0] : null,
  };
}

function ratio(totals: Record<string, number>, n: number): string | null {
  const entries = Object.entries(totals);
  if (n <= 0 || entries.length !== 1) return null;
  return formatRevenue({ orders: 0, totalsByCurrency: { [entries[0]![0]]: entries[0]![1] / n } });
}

/** Sessions whose quiz_engaged fell in range (most recent first, capped). */
async function fetchCohortIds(quizId: string, r: AnalyticsRange) {
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
}

/** Every event, capture and session row of a cohort, regardless of ts. */
async function loadCohort(quizId: string, ids: Set<string>) {
  const cohortIds = [...ids];
  if (cohortIds.length === 0) {
    return { events: [] as CohortEventRow[], captures: [] as CohortCapture[], sessions: [] as CohortSessionRow[] };
  }
  const [events, captureRows, sessions] = await Promise.all([
    prisma.event.findMany({
      where: { quizId, sessionId: { in: cohortIds } },
      select: { sessionId: true, eventType: true, payload: true, ts: true },
    }),
    // Captures — fetched BY COHORT SESSION, not by capturedAt: the range
    // cohorts sessions, so a shopper who engages Monday and submits Thursday
    // still counts once.
    prisma.emailCapture.findMany({
      where: { quizId, sessionId: { in: cohortIds } },
      select: { id: true, sessionId: true, email: true, capturedAt: true, marketingConsent: true },
      orderBy: { capturedAt: "desc" },
    }),
    prisma.quizSession.findMany({
      where: { quizId, sessionId: { in: cohortIds } },
      select: {
        sessionId: true,
        outcomeId: true,
        answerIds: true,
        matchedProductIds: true,
        converted: true,
        completedAt: true,
      },
    }),
  ]);
  return {
    events: events as CohortEventRow[],
    captures: captureRows.map((c) => ({ ...c, marketingConsent: c.marketingConsent ?? null })),
    sessions,
  };
}

function toCohortEvents(rows: CohortEventRow[]): CohortEvent[] {
  return rows.map((e) => ({ sessionId: e.sessionId, eventType: e.eventType, payload: e.payload, ts: +e.ts }));
}

function periodFigures(range: AnalyticsRange, f: CohortFigures, events: CohortEventRow[]): PeriodFigures {
  const m = money(f.revenue.totalsByCurrency);
  const steps: PeriodFigures["steps"] = {};
  for (const s of f.ledger?.steps ?? []) steps[s.nodeId] = { reached: s.reached, left: s.left, dropoff: s.dropoff };
  const answerShares: Record<string, number> = {};
  for (const q of f.answers) for (const o of q.options) answerShares[o.answerId] = o.share;
  return {
    from: range.from ? range.from.toISOString() : "",
    to: range.to.toISOString(),
    started: f.started,
    finished: f.finished,
    contacts: f.contacts,
    canEmail: f.canEmail,
    bought: f.bought,
    orders: f.revenue.orders,
    revenue: m.numeric,
    revenueFormatted: formatRevenue(f.revenue),
    steps,
    steepestNodeId: f.ledger?.steepestNodeId ?? null,
    typicalDropoff: f.ledger?.typicalDropoff ?? null,
    answerShares,
    revenueDays: revenueDaysOf(f, events),
  };
}

/**
 * The quiz, its doc and the session cohort the request's range selects —
 * shared by the analytics page and the contacts panel, so the panel always
 * counts the same shoppers the page shows (auto-widen included).
 */
export async function loadQuizCohort(
  shop: { id: string },
  quizId: string,
  searchParams: URLSearchParams,
  now = new Date(),
) {
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
  const compare = searchParams.get("cmp") === "1";

  let cohort = await fetchCohortIds(quizId, range);
  // Auto-widen (§8.3): a thin DEFAULT window opens on all time, and says so.
  if (published && range.preset === DEFAULT_PRESET && !searchParams.get("r") && cohort.ids.size < 30) {
    const wide = resolveAnalyticsRange(new URLSearchParams({ r: "all" }), now);
    const wideCohort = await fetchCohortIds(quizId, wide);
    if (wideCohort.ids.size > cohort.ids.size) {
      range = { ...wide, widened: true };
      cohort = wideCohort;
    }
  }

  // Doc + the result names.
  const parsed = Quiz.safeParse(quiz.publishedJson ?? quiz.draftJson);
  const doc: QuizDoc | null = parsed.success ? parsed.data : null;
  const xtype = doc ? experienceTypeOf(doc) : "product_match";
  const [catRows, productMetaRows, bis] = await Promise.all([
    prisma.category.findMany({ where: { shopId: shop.id }, select: { id: true, name: true } }),
    prisma.product.findMany({
      where: { shopId: shop.id },
      select: { productId: true, title: true, imageUrl: true, handle: true },
    }),
    prisma.backInStockRequest.findMany({ where: { quizId }, select: { email: true, sessionId: true } }),
  ]);
  const catName = new Map(catRows.map((c) => [c.id, c.name]));
  const resultCtx = doc ? buildResultContext(doc, quiz.publishedJson ?? quiz.draftJson, catName) : null;

  const loaded = await loadCohort(quizId, cohort.ids);
  const events = loaded.events;
  const cohortEvents = toCohortEvents(events);
  const fig = computeCohort({
    doc,
    resultCtx,
    cohortIds: cohort.ids,
    events: cohortEvents,
    captures: loaded.captures,
    sessions: loaded.sessions,
  });
  return {
    quiz,
    publishedAt,
    range,
    published,
    compare,
    cohort,
    doc,
    xtype,
    catName,
    productMetaRows,
    bis,
    resultCtx,
    events,
    cohortEvents,
    fig,
  };
}


export interface RevenueDay {
  day: string;
  total: number;
  orders: number;
  finishers: number;
  currency: string;
}

/**
 * Revenue by DAY for one cohort — bucketed server-side; the view rolls days up
 * to week/month. Orders sit on the day they were PLACED (the order's own
 * created_at; receipt time for older events), each order once, so the days add
 * up to the total. Finishers land on the day the session ENGAGED, matching the
 * cohort basis.
 */
function revenueDaysOf(fig: CohortFigures, events: CohortEventRow[]): RevenueDay[] {
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const orderTime = (e: CohortEvent): Date => {
    const raw = asRecord(e.payload)?.order_created_at;
    const t = typeof raw === "string" ? Date.parse(raw) : NaN;
    return new Date(Number.isFinite(t) ? t : e.ts);
  };
  const dayBuckets = new Map<string, { orders: CohortEvent[]; finishers: Set<string> }>();
  const dayOf = (k: string) => {
    let b = dayBuckets.get(k);
    if (!b) {
      b = { orders: [], finishers: new Set() };
      dayBuckets.set(k, b);
    }
    return b;
  };
  const seen = new Set<string>();
  for (const e of [...fig.orderEvents].sort((a, b) => a.ts - b.ts)) {
    const id = asRecord(e.payload)?.order_id;
    if (typeof id === "string") {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    dayOf(dayKey(orderTime(e))).orders.push(e);
  }
  const engageTs = new Map<string, Date>();
  for (const e of events) {
    if (e.eventType !== "quiz_engaged") continue;
    const prev = engageTs.get(e.sessionId);
    if (!prev || e.ts < prev) engageTs.set(e.sessionId, e.ts);
  }
  for (const sid of fig.completedSet) {
    const ts = engageTs.get(sid);
    if (ts) dayOf(dayKey(ts)).finishers.add(sid);
  }
  return [...dayBuckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => {
      const r = totalRevenue(b.orders);
      const [cur, amt] = Object.entries(r.totalsByCurrency)[0] ?? ["", 0];
      return { day, total: amt, orders: r.orders, finishers: b.finishers.size, currency: cur };
    });
}

export async function quizAnalyticsForShop(
  shop: { id: string; source?: string },
  quizId: string,
  searchParams: URLSearchParams,
  now = new Date(),
): Promise<QuizAnalyticsData> {
  const {
    quiz,
    publishedAt,
    range,
    published,
    compare,
    cohort,
    doc,
    xtype,
    productMetaRows,
    bis,
    resultCtx,
    events,
    cohortEvents,
    fig,
  } = await loadQuizCohort(shop, quizId, searchParams, now);
  const engaged = fig.started;
  const completed = fig.finished;
  const completedSet = fig.completedSet;
  const revenue = fig.revenue;
  const rev = money(revenue.totalsByCurrency);
  const perFinisher = ratio(revenue.totalsByCurrency, completed);
  const aov = ratio(revenue.totalsByCurrency, revenue.orders);

  // Previous period (Compare) — the same cohort construction, same counting.
  let prior: PeriodFigures | null = null;
  const prevRange = compare ? previousRange(range) : null;
  if (prevRange) {
    const prevCohort = await fetchCohortIds(quizId, prevRange);
    const prevLoaded = await loadCohort(quizId, prevCohort.ids);
    const prevFig = computeCohort({
      doc,
      resultCtx,
      cohortIds: prevCohort.ids,
      events: toCohortEvents(prevLoaded.events),
      captures: prevLoaded.captures,
      sessions: prevLoaded.sessions,
    });
    prior = periodFigures(prevRange, prevFig, prevLoaded.events);
  }

  const ledger = fig.ledger;
  const answers = fig.answers;

  // Results — every doc model (Data work 3). Real results only in `outcomes`.
  const results: ResultSummaryRow[] = fig.results.map((r) => {
    const m = money(r.totalsByCurrency);
    return {
      resultId: r.resultId,
      name: r.name,
      noMatch: r.noMatch,
      count: r.finished,
      contacts: r.contacts,
      contactsBought: r.contactsBought,
      contactsAdded: r.contactsAdded,
      contactsNoPurchase: r.contactsNoPurchase,
      bought: r.bought,
      orders: r.orders,
      revenue: m.numeric,
      revenueFormatted: r.orders > 0 ? m.formatted : "—",
      aov: ratio(r.totalsByCurrency, r.orders),
    };
  });
  const outcomes = results.filter((r) => r.count > 0).map((r) => ({ label: r.name, count: r.count }));

  // Products — every product (no cap), preview events excluded (W4).
  const perfRows = productPerformance(cohortEvents, productMetaRows, { limit: Number.POSITIVE_INFINITY });
  // "No logic" and the ways in — ONE computation for the Products table and
  // the unreachable-products insight (logicReachability.ts).
  const collectionRows = published
    ? await prisma.collection.findMany({ where: { shopId: shop.id }, select: { collectionId: true, title: true } })
    : [];
  const { report: reachability, reach: productReach } = published
    ? logicReachability(doc, quiz.publishedJson, new Map(collectionRows.map((c) => [c.collectionId, c.title])))
    : { report: null, reach: null };
  const orderEvents = fig.orderEvents;

  // productId → distinct attributed ORDERS that contained it (E7), deduped by
  // order_id first. `anyLineItems` separates "no orders bought it" from
  // "these orders predate line-item capture", which must not both read 0.
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
  // Line revenue (Data work 1) — a part of each order's total, never more.
  const lines = lineRevenueByProduct(orderEvents);
  const anyLineRevenue = lines.ordersWithLines > 0;
  // Returns (Data work 2) — refunds of THIS cohort's attributed orders only.
  const cohortOrderIds = new Set<string>();
  for (const e of orderEvents) {
    const id = asRecord(e.payload)?.order_id;
    if (typeof id === "string") cohortOrderIds.add(id);
  }
  const returns = returnsByProduct(
    cohortEvents.filter((e) => e.eventType === "order_refunded"),
    cohortOrderIds,
  );
  let lineRevenueTotal = 0;
  for (const v of lines.byProduct.values()) lineRevenueTotal += v.revenue;

  // productId → how many result groups hold it (the baked target map).
  const groupsByProduct = new Map<string, number>();
  {
    const baked = asRecord(quiz.publishedJson)?.target_product_ids_map as Record<string, string[]> | undefined;
    if (doc?.logic_model === "decider" && baked) {
      for (const members of Object.values(baked)) {
        for (const pid of new Set(members)) groupsByProduct.set(pid, (groupsByProduct.get(pid) ?? 0) + 1);
      }
    }
  }

  const titleOf = new Map(productMetaRows.map((p) => [p.productId, p.title]));
  const toRow = (p: ProductPerfRow): ProductRow => {
    const lr = lines.byProduct.get(p.productId);
    return {
      ...p,
      bought: anyLineItems ? boughtByProduct.get(p.productId) ?? 0 : null,
      revenue: anyLineRevenue ? lr?.revenue ?? 0 : null,
      revenueShare: anyLineRevenue && lineRevenueTotal > 0 ? (lr?.revenue ?? 0) / lineRevenueTotal : null,
      units: anyLineRevenue ? lr?.units ?? 0 : null,
      returned: anyLineItems ? returns.get(p.productId)?.units ?? 0 : null,
      daysToReturn: returns.get(p.productId)?.medianDays ?? null,
      noLogic: reachability?.stateById.get(p.productId) === "unreachable",
      share: completed > 0 ? p.impressions / completed : null,
      ways: productReach?.products.get(p.productId)?.ways ?? [],
      groupCount: groupsByProduct.get(p.productId) ?? 0,
    };
  };
  const products: ProductRow[] = perfRows.map(toRow);
  // Every mapped product belongs in the table, traffic or not.
  if (reachability) {
    const seen = new Set(products.map((p) => p.productId));
    for (const pid of reachability.stateById.keys()) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const title =
        titleOf.get(pid) ?? reachability.unreachable.find((u) => u.productId === pid)?.title ?? pid;
      products.push(
        toRow({
          productId: pid,
          title,
          imageUrl: productMetaRows.find((m) => m.productId === pid)?.imageUrl ?? null,
          handle: productMetaRows.find((m) => m.productId === pid)?.handle ?? null,
          impressions: 0,
          clicks: 0,
          addToCart: 0,
          ctr: 0,
          atcRate: 0,
        }),
      );
    }
  }
  const topProducts = [...lines.byProduct.entries()]
    .filter(([, v]) => v.revenue > 0)
    .sort((a, b) => b[1].revenue - a[1].revenue || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([pid, v]) => ({
      productId: pid,
      title: titleOf.get(pid) ?? pid,
      revenue: v.revenue,
      revenueFormatted: formatRevenue({ orders: 0, totalsByCurrency: { [rev.single ?? ""]: v.revenue } }),
      orders: v.orders,
    }));

  // Contacts — counted over EVERY contact; the first CONTACT_ROWS_SHIPPED ship.
  const isBackInStock = backInStockMatcher(bis);
  const allContactRows: ContactRow[] = fig.contactList.map((c) => {
    const recTitles = c.matchedProductIds.map((id) => titleOf.get(id)).filter((t): t is string => !!t);
    return {
      id: c.captureId,
      sessionId: c.sessionId,
      emailMasked: maskEmail(c.email),
      capturedAt: c.capturedAt.toISOString(),
      resultId: c.result?.resultId ?? null,
      result: c.result?.name ?? null,
      recommended: recTitles[0] ?? null,
      recommendedMore: Math.max(0, c.matchedProductIds.length - 1),
      recommendedIds: c.matchedProductIds,
      status: c.status,
      consent: c.consent,
      noMatch: Boolean(c.result?.noMatch),
      backInStock: isBackInStock(c.sessionId, c.email),
      value: c.orderValue,
    };
  });
  const count = (pred: (c: ContactRow) => boolean) => allContactRows.reduce((n, c) => n + (pred(c) ? 1 : 0), 0);
  const contactCounts = {
    all: allContactRows.length,
    canEmail: count((c) => c.consent === true),
    purchased: count((c) => c.status === "bought"),
    added: count((c) => c.status === "added"),
    noPurchase: count((c) => c.status === "no-purchase"),
    addedCanEmail: count((c) => c.status === "added" && c.consent === true),
    noPurchaseCanEmail: count((c) => c.status === "no-purchase" && c.consent === true),
    didntBuy: count((c) => c.status !== "bought"),
    noMatch: count((c) => c.noMatch),
    backInStock: count((c) => c.backInStock),
    // Finishers who never gave an email.
    noEmail: Math.max(0, completed - count((c) => completedSet.has(c.sessionId))),
  };
  const contactRows = allContactRows.slice(0, CONTACT_ROWS_SHIPPED);
  const contactFilterOptions = {
    results: [...new Set(allContactRows.map((c) => c.result).filter((v): v is string => !!v))].sort(),
    products: [...new Set(allContactRows.map((c) => c.recommended).filter((v): v is string => !!v))].sort(),
  };

  const revenueDays = revenueDaysOf(fig, events);
  // The month table needs each session's engage time.
  const engageTs = new Map<string, Date>();
  for (const e of events) {
    if (e.eventType !== "quiz_engaged") continue;
    const prev = engageTs.get(e.sessionId);
    if (!prev || e.ts < prev) engageTs.set(e.sessionId, e.ts);
  }

  // Month-by-month compare — recomputed per month, never averaged (§ spec 07).
  // A session's month is its engage month; so are its contact and its orders,
  // which is what makes the months add up to the range totals.
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthAgg = new Map<
    string,
    { engaged: Set<string>; completed: Set<string>; captures: number; orders: CohortEvent[] }
  >();
  const bucketOf = (k: string) => {
    let b = monthAgg.get(k);
    if (!b) {
      b = { engaged: new Set(), completed: new Set(), captures: 0, orders: [] };
      monthAgg.set(k, b);
    }
    return b;
  };
  for (const [sid, ts] of engageTs) {
    const b = bucketOf(monthKey(ts));
    b.engaged.add(sid);
    if (completedSet.has(sid)) b.completed.add(sid);
  }
  for (const e of orderEvents) {
    const ts = engageTs.get(e.sessionId);
    if (ts) bucketOf(monthKey(ts)).orders.push(e);
  }
  for (const c of fig.contactList) {
    const ts = engageTs.get(c.sessionId);
    if (ts) bucketOf(monthKey(ts)).captures += 1;
  }
  const nowKey = monthKey(now);
  const months = [...monthAgg.keys()]
    .sort()
    .reverse()
    .slice(0, 24)
    .map((k) => {
      const b = monthAgg.get(k)!;
      const r = totalRevenue(b.orders);
      const [y, m] = k.split("-");
      const label = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      return {
        key: k,
        label,
        engaged: b.engaged.size,
        completed: b.completed.size,
        captures: b.captures,
        orders: r.orders,
        revenue: formatRevenue(r),
        revenueNumeric: revenueNumber(r.totalsByCurrency),
        perFinisher: ratio(r.totalsByCurrency, b.completed.size),
        partial: k === nowKey,
      };
    });

  // A/B variants.
  const abTests = doc
    ? findAbBranches(doc).map((br) => {
        const funnels = aggregateVariantFunnel(cohortEvents, br.id, br.data.slots);
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

  // Dismissals — a snoozed card is hidden until its 14 days lapse, and leaves
  // the list BEFORE the cap so the next finding moves up.
  const dismissalState = (await loadDismissals([quizId], now)).get(quizId) ?? {
    active: new Set<string>(),
    until: new Map<string, Date>(),
  };
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
        contactsNoMatchBought: count((c) => c.noMatch && c.status === "bought"),
        dismissed: dismissalState.active,
      })
    : { cards: [], more: 0, clean: true };
  const { hidden, ...insights } = insightsRaw;
  const dismissed = (hidden ?? []).map((c) => ({
    id: c.id,
    headline: c.headline,
    severity: c.severity,
    until: (dismissalState.until.get(c.id) ?? now).toISOString(),
  }));

  // Period-over-period deltas. Rates move in POINTS, counts in percent; a
  // delta is suppressed whenever either side is too thin to mean anything.
  const DELTA_MIN = 30;
  const priorCompletion = prior && prior.started > 0 ? prior.finished / prior.started : null;
  const deltas = {
    completionPoints:
      prior && prior.started >= DELTA_MIN && engaged >= DELTA_MIN && priorCompletion != null
        ? Math.round((completed / Math.max(1, engaged) - priorCompletion) * 1000) / 10
        : null,
    sessionsPct:
      prior && prior.started >= DELTA_MIN ? Math.round(((engaged - prior.started) / prior.started) * 100) : null,
    revenuePct:
      prior && prior.revenue > 0 && rev.single ? Math.round(((rev.numeric - prior.revenue) / prior.revenue) * 100) : null,
  };

  // Per-shopper response log (§03) — the cohort's ANSWER events, so the
  // shoppers who left before a result are in it too.
  const answerBySession = new Map<string, Map<string, string[]>>();
  const lastTs = new Map<string, Date>();
  for (const e of events) {
    if (e.eventType !== "question_answered") continue;
    const pl = asRecord(e.payload);
    const qid = typeof pl?.question_id === "string" ? pl.question_id : null;
    if (!qid) continue;
    const ids = Array.isArray(pl?.answer_ids) ? pl.answer_ids.filter((v): v is string => typeof v === "string") : [];
    let per = answerBySession.get(e.sessionId);
    if (!per) {
      per = new Map();
      answerBySession.set(e.sessionId, per);
    }
    per.set(qid, ids);
    const prevTs = lastTs.get(e.sessionId);
    if (!prevTs || e.ts > prevTs) lastTs.set(e.sessionId, e.ts);
  }
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
    (a, b) => +(lastTs.get(b) ?? 0) - +(lastTs.get(a) ?? 0),
  );
  const responseRows = orderedSessions.slice(0, RESPONSE_PAGE).map((sid) => {
    const per = answerBySession.get(sid)!;
    const finished = completedSet.has(sid);
    let lastAnswered: string | null = null;
    for (const qid of questionOrder) if (per.has(qid)) lastAnswered = qid;
    const labelOf = (qid: string) =>
      (per.get(qid) ?? []).map((id) => answerLabel.get(id) ?? "—").join(", ") || "skipped";
    return {
      sessionId: sid,
      short: `${sid.slice(0, 4)}…${sid.slice(-3)}`,
      when: (lastTs.get(sid) ?? range.to).toISOString(),
      answers: questionOrder.filter((qid) => per.has(qid)).map((qid) => ({ questionId: qid, text: labelOf(qid) })),
      result: finished ? fig.resultBySession.get(sid)?.name ?? null : null,
      bought: fig.boughtSet.has(sid),
      leftAt: finished
        ? null
        : lastAnswered
          ? `left at Q${questionOrder.indexOf(lastAnswered) + 1}`
          : "left at the start",
    };
  });

  // Effective catalogue size — exp(Shannon entropy) over impression share.
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

  const klaviyoRow = await prisma.shop.findUnique({ where: { id: shop.id }, select: { klaviyoApiKey: true } });

  // W6 — standalone workspaces have no Shopify order feed.
  const attribution: "shopify" | "none" = (shop.source ?? "shopify") === "standalone" ? "none" : "shopify";

  return {
    quiz: { id: quiz.id, name: quiz.name, status: quiz.status, publishedAt },
    range: {
      preset: range.preset,
      from: range.from ? range.from.toISOString() : null,
      to: range.to.toISOString(),
      label: range.widened ? PRESET_LABELS.all : range.label,
      widened: range.widened,
    },
    compare,
    dataState,
    xtype,
    attribution,
    truncated: cohort.truncated,
    currency: rev.single,
    kpis: {
      engaged,
      completed,
      completion: gateRate("completion_rate", completed, engaged),
      captureSessions: fig.contacts,
      capture: gateRate("capture_rate", fig.contacts, completed),
      canEmail: fig.canEmail,
      buyers: fig.bought,
      conversion: gateRate("conversion_rate", fig.bought, completed),
      revenue: { formatted: formatRevenue(revenue), numeric: rev.numeric, orders: revenue.orders, perFinisher, aov },
      prior,
      deltas,
    },
    insights,
    dismissed,
    ledger,
    answers,
    answerPaths: ledger
      ? Object.fromEntries(
          answers.flatMap((q) => {
            const path = questionPath(ledger, q.questionId);
            return path ? [[q.questionId, path] as const] : [];
          }),
        )
      : {},
    outcomes,
    results,
    products,
    topProducts,
    lineItemsSince: lines.since != null ? new Date(lines.since).toISOString() : null,
    productMeta: reachability ? { mapped: reachability.mapped, unreachable: reachability.unreachable.length } : null,
    contacts: { rows: contactRows, counts: contactCounts, filterOptions: contactFilterOptions },
    revenueDays,
    klaviyoConnected: Boolean(klaviyoRow?.klaviyoApiKey),
    attributionDays: ATTRIBUTION_WINDOW_DAYS,
    responses: { rows: responseRows, total: orderedSessions.length },
    effectiveCatalog,
    months,
    abTests,
  };
}

// ── Shop-level home (Screen 1) ─────────────────────────────────────────────

/** One period's figures for a quiz row (or the roll-up). */
export interface ShopPeriod {
  starts: number;
  finished: number;
  contacts: number;
  orders: number;
  revenueNumeric: number;
  revenue: string;
}

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
  /** The previous period (Compare on, live quizzes only). */
  prior: ShopPeriod | null;
}

export interface ShopAnalyticsData {
  range: { preset: RangePreset; from: string | null; to: string; label: string };
  compare: boolean;
  /** The one currency revenue is in; null when none or several. */
  currency: string | null;
  /** "none" ⇒ standalone workspace, no order feed (W6). */
  attribution: "shopify" | "none";
  tiles: {
    sessions: number;
    sessionsDeltaPct: number | null;
    completion: GatedRate;
    finished: number;
    contacts: number;
    captureOfFinishers: GatedRate;
    revenue: string;
    revenueNumeric: number;
    orders: number;
    perFinisher: string | null;
    /** How many live quizzes the tiles add up. */
    liveQuizzes: number;
    /** The previous period's totals (Compare on). */
    prior: ShopPeriod | null;
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
 * Every quiz is listed, drafts included (ANALYTICS-HANDOFF.md, Data work 9).
 * The cap is a safety net, far above any real shop; the doc parse and the
 * insight rules per quiz are what it bounds.
 */
export const SHOP_ANALYTICS_QUIZ_LIMIT = 200;

/** Per-quiz cohort totals for a range: the same construction as a quiz page. */
type ShopQuizPeriod = ShopPeriod & {
  totals: Record<string, number>;
  /** The cohort's answer + completion events (withSteps), for the step ledger. */
  stepEvents: CohortEvent[];
};

async function shopPeriodByQuiz(
  quizIds: string[],
  r: AnalyticsRange,
  opts: { withSteps?: boolean } = {},
): Promise<Map<string, ShopQuizPeriod>> {
  const out = new Map<string, ShopQuizPeriod>();
  if (quizIds.length === 0) return out;
  const engageRows = await prisma.event.findMany({
    where: {
      quizId: { in: quizIds },
      eventType: "quiz_engaged",
      ...(r.from ? { ts: { gte: r.from, lte: r.to } } : { ts: { lte: r.to } }),
    },
    select: { quizId: true, sessionId: true },
    distinct: ["quizId", "sessionId"],
    take: 50_000,
  });
  const key = (q: string, s: string) => `${q}\u0000${s}`;
  const cohort = new Set(engageRows.map((e) => key(e.quizId, e.sessionId)));
  const sessionIds = [...new Set(engageRows.map((e) => e.sessionId))];
  const [laterRows, captureRows] = sessionIds.length
    ? await Promise.all([
        prisma.event.findMany({
          where: {
            quizId: { in: quizIds },
            eventType: {
              in: opts.withSteps
                ? ["quiz_completed", "order_attributed", "question_answered"]
                : ["quiz_completed", "order_attributed"],
            },
            sessionId: { in: sessionIds },
          },
          select: { quizId: true, sessionId: true, eventType: true, payload: true, ts: true },
          orderBy: { ts: "asc" },
        }),
        prisma.emailCapture.findMany({
          where: { quizId: { in: quizIds }, sessionId: { in: sessionIds } },
          select: { quizId: true, sessionId: true },
        }),
      ])
    : [[], []];

  const agg = new Map<
    string,
    { started: Set<string>; finished: Set<string>; contacts: Set<string>; orders: CohortEventRow[]; steps: CohortEvent[] }
  >();
  const aggOf = (q: string) => {
    let a = agg.get(q);
    if (!a) {
      a = { started: new Set(), finished: new Set(), contacts: new Set(), orders: [], steps: [] };
      agg.set(q, a);
    }
    return a;
  };
  for (const e of engageRows) aggOf(e.quizId).started.add(e.sessionId);
  // One order credits ONE quiz on this page: dedupe globally, earliest first.
  const seenOrders = new Set<string>();
  for (const e of laterRows) {
    if (!cohort.has(key(e.quizId, e.sessionId))) continue;
    if (e.eventType === "quiz_completed" || e.eventType === "question_answered") {
      if (e.eventType === "quiz_completed") aggOf(e.quizId).finished.add(e.sessionId);
      if (opts.withSteps) aggOf(e.quizId).steps.push({ sessionId: e.sessionId, eventType: e.eventType, payload: e.payload, ts: +e.ts });
      continue;
    }
    const orderId = asRecord(e.payload)?.order_id;
    if (typeof orderId === "string") {
      if (seenOrders.has(orderId)) continue;
      seenOrders.add(orderId);
    }
    aggOf(e.quizId).orders.push(e as CohortEventRow);
  }
  for (const c of captureRows) {
    if (cohort.has(key(c.quizId, c.sessionId))) aggOf(c.quizId).contacts.add(c.sessionId);
  }
  for (const [q, a] of agg) {
    const rev = totalRevenue(a.orders);
    out.set(q, {
      starts: a.started.size,
      finished: a.finished.size,
      contacts: a.contacts.size,
      orders: rev.orders,
      revenueNumeric: revenueNumber(rev.totalsByCurrency),
      revenue: formatRevenue(rev),
      totals: rev.totalsByCurrency,
      stepEvents: a.steps,
    });
  }
  return out;
}

export async function shopAnalyticsForShop(
  shop: { id: string; source?: string },
  searchParams: URLSearchParams,
  now = new Date(),
): Promise<ShopAnalyticsData> {
  const range = resolveAnalyticsRange(searchParams, now);
  const compare = searchParams.get("cmp") === "1";
  const quizzes = await prisma.quiz.findMany({
    where: {
      shopId: shop.id,
      // A quiz still inside its creation funnel is not a quiz yet.
      OR: [{ buildState: null }, { buildState: { not: "step1" } }],
    },
    select: { id: true, name: true, status: true, draftJson: true, publishedJson: true },
    orderBy: { updatedAt: "desc" },
    take: SHOP_ANALYTICS_QUIZ_LIMIT,
  });
  const liveIds = quizzes.filter((q) => q.status === "published").map((q) => q.id);
  const prevRange = compare ? previousRange(range) : null;
  const [current, previous, dismissals] = await Promise.all([
    shopPeriodByQuiz(liveIds, range, { withSteps: true }),
    prevRange ? shopPeriodByQuiz(liveIds, prevRange) : Promise.resolve(null),
    loadDismissals(quizzes.map((q) => q.id), now),
  ]);

  const rows: ShopQuizRow[] = [];
  const findings: ShopAnalyticsData["findings"] = [];
  let dismissedCount = 0;
  const total = { starts: 0, finished: 0, contacts: 0, orders: 0, byCur: {} as Record<string, number> };
  const priorTotal = { starts: 0, finished: 0, contacts: 0, orders: 0, byCur: {} as Record<string, number> };
  const empty = { starts: 0, finished: 0, contacts: 0, orders: 0, revenueNumeric: 0, revenue: "—", totals: {} as Record<string, number> };

  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.publishedJson ?? q.draftJson);
    const doc = parsed.success ? parsed.data : null;
    const isLive = q.status === "published";

    // Findings run on EVERY quiz. Drafts get the doc-static ones (they read the
    // quiz's own logic, so they need no traffic); live quizzes also get the
    // traffic rules over their own cohort (drop-off, too few sessions), the
    // same rules and figures the quiz's own page shows.
    let flag: string | null = null;
    const curStats = isLive ? current.get(q.id) : undefined;
    if (doc) {
      const reachability = isLive ? logicReachability(doc, q.publishedJson).report : null;
      const engagedN = curStats?.starts ?? 0;
      const completedN = curStats?.finished ?? 0;
      const ledger = isLive && curStats ? buildStepLedger(doc, curStats.stepEvents, engagedN, completedN) : null;
      const r = buildQuizInsights({
        doc,
        reachability,
        ledger,
        engaged: engagedN,
        completed: completedN,
        rangeDays: range.days || 90,
        published: isLive,
        cap: Number.POSITIVE_INFINITY,
      });
      const tierA = r.cards.filter((c) => c.tier === "A");
      for (const card of r.cards) {
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
      flag = tierA.find((c) => c.chip)?.chip ?? null;
    }

    const cur = isLive ? current.get(q.id) ?? empty : null;
    const prev = isLive && previous ? previous.get(q.id) ?? empty : null;
    rows.push({
      id: q.id,
      name: q.name,
      live: isLive,
      flag,
      questions: doc ? doc.nodes.filter((n) => n.type === "question").length : 0,
      outcomes: doc ? distinctOutcomes(doc) : 0,
      starts: cur ? cur.starts : null,
      completion: cur ? gateRate("completion_rate", cur.finished, cur.starts) : null,
      contacts: cur ? cur.contacts : null,
      orders: cur ? cur.orders : null,
      revenue: cur ? cur.revenue : null,
      revenueNumeric: cur ? cur.revenueNumeric : null,
      perFinisher: cur ? ratio(cur.totals, cur.finished) : null,
      perFinisherNumeric:
        cur && cur.finished > 0 && Object.keys(cur.totals).length === 1 ? cur.revenueNumeric / cur.finished : null,
      prior: prev
        ? {
            starts: prev.starts,
            finished: prev.finished,
            contacts: prev.contacts,
            orders: prev.orders,
            revenueNumeric: prev.revenueNumeric,
            revenue: prev.revenue,
          }
        : null,
    });

    // The first card's figures are the totals of the live rows.
    if (cur) {
      total.starts += cur.starts;
      total.finished += cur.finished;
      total.contacts += cur.contacts;
      total.orders += cur.orders;
      for (const [c, a] of Object.entries(cur.totals)) total.byCur[c] = (total.byCur[c] ?? 0) + a;
    }
    if (prev) {
      priorTotal.starts += prev.starts;
      priorTotal.finished += prev.finished;
      priorTotal.contacts += prev.contacts;
      priorTotal.orders += prev.orders;
      for (const [c, a] of Object.entries(prev.totals)) priorTotal.byCur[c] = (priorTotal.byCur[c] ?? 0) + a;
    }
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

  const revenueSummary = { orders: total.orders, totalsByCurrency: total.byCur };
  return {
    range: {
      preset: range.preset,
      from: range.from ? range.from.toISOString() : null,
      to: range.to.toISOString(),
      label: range.label,
    },
    compare,
    currency: Object.keys(total.byCur).length === 1 ? Object.keys(total.byCur)[0]! || null : null,
    attribution: (shop.source ?? "shopify") === "standalone" ? "none" : "shopify",
    tiles: {
      sessions: total.starts,
      sessionsDeltaPct:
        previous && priorTotal.starts > 0
          ? Math.round(((total.starts - priorTotal.starts) / priorTotal.starts) * 100)
          : null,
      completion: gateRate("completion_rate", total.finished, total.starts),
      finished: total.finished,
      contacts: total.contacts,
      captureOfFinishers: gateRate("capture_rate", total.contacts, total.finished),
      revenue: formatRevenue(revenueSummary),
      revenueNumeric: revenueNumber(total.byCur),
      orders: total.orders,
      perFinisher: ratio(total.byCur, total.finished),
      liveQuizzes: liveIds.length,
      prior: previous
        ? {
            starts: priorTotal.starts,
            finished: priorTotal.finished,
            contacts: priorTotal.contacts,
            orders: priorTotal.orders,
            revenueNumeric: revenueNumber(priorTotal.byCur),
            revenue: formatRevenue({ orders: priorTotal.orders, totalsByCurrency: priorTotal.byCur }),
          }
        : null,
    },
    rows,
    counts: {
      all: rows.length,
      live: rows.filter((r) => r.live).length,
      draft: rows.filter((r) => !r.live).length,
    },
    findings,
    dismissedCount,
  };
}

const SEV_ORDER: Record<InsightSeverityLike, number> = { crit: 0, warn: 1, info: 2 };
