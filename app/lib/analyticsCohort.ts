// One session cohort, counted (ANALYTICS-HANDOFF.md, Data work 3, 4 and 5).
//
// The loader picks a cohort (the sessions that pressed Start in a range),
// fetches ALL of their events, captures and session rows, and hands them here.
// Everything a screen prints about that cohort comes out of this one function,
// so the current period and the previous period are counted the same way by
// construction — Compare can never set two different methods side by side.
//
// Pure: no DB, no React.

import type { Quiz as QuizDoc } from "./quizSchema";
import { totalRevenue, type RevenueSummary } from "./funnelAggregation";
import { buildStepLedger, type StepLedger } from "./stepLedger";
import { answerDistributions, type QuestionDistribution } from "./answerDistribution";
import {
  resolveSessionResult,
  revenueByResult,
  type ResultContext,
  type SessionResult,
} from "./sessionResult";

export interface CohortEvent {
  sessionId: string;
  eventType: string;
  payload: unknown;
  /** ms epoch. */
  ts: number;
}

export interface CohortCapture {
  id: string;
  sessionId: string;
  email: string;
  capturedAt: Date;
  /** null = the quiz never asked. */
  marketingConsent: boolean | null;
}

export interface CohortSessionRow {
  sessionId: string;
  outcomeId: string | null;
  answerIds: string[];
  matchedProductIds: string[];
  converted: boolean;
  completedAt: Date | null;
}

export interface CohortInputs {
  doc: QuizDoc | null;
  resultCtx: ResultContext | null;
  /** Sessions that pressed Start in the range. */
  cohortIds: ReadonlySet<string>;
  events: CohortEvent[];
  captures: CohortCapture[];
  sessions: CohortSessionRow[];
}

export type ContactStatus = "bought" | "added" | "no-purchase";

/** One contact = one session that left an email (its latest capture). */
export interface CohortContact {
  captureId: string;
  sessionId: string;
  email: string;
  capturedAt: Date;
  consent: boolean | null;
  status: ContactStatus;
  /** null = left before a result. */
  result: SessionResult | null;
  matchedProductIds: string[];
  /** The session's attributed order value(s), "" when none. */
  orderValue: string | null;
  finished: boolean;
}

/** Contacts who left an email but never reached a result group here. */
export const NOT_FINISHED_RESULT_ID = "__not_finished__";
export const NOT_FINISHED_NAME = "Left before a result";

export interface ResultRow {
  resultId: string;
  name: string;
  noMatch: boolean;
  /** Finished sessions that got this result. */
  finished: number;
  contacts: number;
  /** Contacts by status — they add up to `contacts`. */
  contactsBought: number;
  contactsAdded: number;
  contactsNoPurchase: number;
  /** Bought shoppers (converted sessions) with this result. */
  bought: number;
  orders: number;
  totalsByCurrency: Record<string, number>;
}

export interface CohortFigures {
  started: number;
  finished: number;
  /** Sessions that left an email. */
  contacts: number;
  /** Contacts whose marketing consent is yes. */
  canEmail: number;
  /** Converted sessions: shoppers with at least one attributed order. */
  bought: number;
  revenue: RevenueSummary;
  completedSet: Set<string>;
  boughtSet: Set<string>;
  /** Sessions that added to cart with the quiz's own button (preview excluded). */
  addedSet: Set<string>;
  orderEvents: CohortEvent[];
  ledger: StepLedger | null;
  answers: QuestionDistribution[];
  resultBySession: Map<string, SessionResult>;
  /** Real results first by size, then No match / Unknown, then Left before a result. */
  results: ResultRow[];
  contactList: CohortContact[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function computeCohort(input: CohortInputs): CohortFigures {
  const { doc, resultCtx, cohortIds } = input;
  const events = input.events.filter((e) => cohortIds.has(e.sessionId));

  const completedSet = new Set<string>();
  const addedSet = new Set<string>();
  const viewsBySession = new Map<string, Array<{ ts: number; payload: unknown }>>();
  const answersBySession = new Map<string, Map<string, { ts: number; ids: string[] }>>();
  for (const e of events) {
    if (e.eventType === "quiz_completed") completedSet.add(e.sessionId);
    else if (e.eventType === "add_to_cart") {
      if (asRecord(e.payload)?.stage !== "preview") addedSet.add(e.sessionId);
    } else if (e.eventType === "recommendation_viewed") {
      const list = viewsBySession.get(e.sessionId) ?? [];
      list.push({ ts: e.ts, payload: e.payload });
      viewsBySession.set(e.sessionId, list);
    } else if (e.eventType === "question_answered") {
      const p = asRecord(e.payload);
      const qid = typeof p?.question_id === "string" ? p.question_id : null;
      if (!qid) continue;
      const per = answersBySession.get(e.sessionId) ?? new Map<string, { ts: number; ids: string[] }>();
      const prev = per.get(qid);
      if (!prev || e.ts >= prev.ts) per.set(qid, { ts: e.ts, ids: stringList(p?.answer_ids) });
      answersBySession.set(e.sessionId, per);
    }
  }
  const started = cohortIds.size;
  const finished = completedSet.size;

  const rowBySession = new Map<string, CohortSessionRow>();
  for (const s of input.sessions) if (cohortIds.has(s.sessionId)) rowBySession.set(s.sessionId, s);
  const boughtSet = new Set<string>();
  for (const s of rowBySession.values()) if (s.converted) boughtSet.add(s.sessionId);

  const orderEvents = events.filter((e) => e.eventType === "order_attributed");
  const revenue = totalRevenue(orderEvents);

  // The session's order value — first event per order_id keeps it.
  const orderValueBySession = new Map<string, string>();
  {
    const seen = new Set<string>();
    for (const e of [...orderEvents].sort((a, b) => a.ts - b.ts)) {
      const p = asRecord(e.payload);
      const orderId = typeof p?.order_id === "string" ? p.order_id : null;
      if (!orderId || seen.has(orderId)) continue;
      seen.add(orderId);
      const total = typeof p?.total_price === "string" ? p.total_price : null;
      const currency = typeof p?.currency === "string" ? p.currency : "";
      if (total) {
        const prev = orderValueBySession.get(e.sessionId);
        const v = `${total}${currency ? ` ${currency}` : ""}`;
        orderValueBySession.set(e.sessionId, prev ? `${prev} + ${v}` : v);
      }
    }
  }

  // Results — one per finished session (and per session with a finished row).
  const resultBySession = new Map<string, SessionResult>();
  if (resultCtx) {
    const sids = new Set<string>([...completedSet, ...rowBySession.keys()]);
    for (const sid of sids) {
      const per = answersBySession.get(sid);
      const r = resolveSessionResult(resultCtx, {
        finished: completedSet.has(sid),
        views: viewsBySession.get(sid) ?? [],
        row: rowBySession.get(sid) ?? null,
        eventAnswerIds: per ? [...per.values()].flatMap((a) => a.ids) : [],
      });
      if (r) resultBySession.set(sid, r);
    }
  }

  // Contacts — one per session, its LATEST capture (rows arrive in any order).
  const latestCapture = new Map<string, CohortCapture>();
  for (const c of input.captures) {
    if (!cohortIds.has(c.sessionId)) continue;
    const prev = latestCapture.get(c.sessionId);
    if (!prev || c.capturedAt > prev.capturedAt) latestCapture.set(c.sessionId, c);
  }
  // Consent: the session's LATEST explicit answer. A later form that never
  // asked writes null, which is not a withdrawal, so it is skipped.
  const consentBySession = new Map<string, { at: Date; value: boolean }>();
  for (const c of input.captures) {
    if (!cohortIds.has(c.sessionId) || c.marketingConsent == null) continue;
    const prev = consentBySession.get(c.sessionId);
    if (!prev || c.capturedAt >= prev.at) consentBySession.set(c.sessionId, { at: c.capturedAt, value: c.marketingConsent });
  }

  const contactList: CohortContact[] = [...latestCapture.values()]
    .sort((a, b) => +b.capturedAt - +a.capturedAt || a.sessionId.localeCompare(b.sessionId))
    .map((c) => {
      const status: ContactStatus = boughtSet.has(c.sessionId)
        ? "bought"
        : addedSet.has(c.sessionId)
          ? "added"
          : "no-purchase";
      return {
        captureId: c.id,
        sessionId: c.sessionId,
        email: c.email,
        capturedAt: c.capturedAt,
        consent: consentBySession.get(c.sessionId)?.value ?? null,
        status,
        result: resultBySession.get(c.sessionId) ?? null,
        matchedProductIds: rowBySession.get(c.sessionId)?.matchedProductIds ?? [],
        orderValue: orderValueBySession.get(c.sessionId) ?? null,
        finished: completedSet.has(c.sessionId),
      };
    });

  // Per-result rows.
  const rows = new Map<string, ResultRow>();
  const rowOf = (id: string, name: string, noMatch: boolean): ResultRow => {
    let r = rows.get(id);
    if (!r) {
      r = {
        resultId: id,
        name,
        noMatch,
        finished: 0,
        contacts: 0,
        contactsBought: 0,
        contactsAdded: 0,
        contactsNoPurchase: 0,
        bought: 0,
        orders: 0,
        totalsByCurrency: {},
      };
      rows.set(id, r);
    }
    return r;
  };
  for (const sid of completedSet) {
    const res = resultBySession.get(sid);
    if (!res) continue;
    const row = rowOf(res.resultId, res.name, res.noMatch);
    row.finished += 1;
    if (boughtSet.has(sid)) row.bought += 1;
  }
  for (const c of contactList) {
    const row = c.result
      ? rowOf(c.result.resultId, c.result.name, c.result.noMatch)
      : rowOf(NOT_FINISHED_RESULT_ID, NOT_FINISHED_NAME, false);
    row.contacts += 1;
    if (c.status === "bought") row.contactsBought += 1;
    else if (c.status === "added") row.contactsAdded += 1;
    else row.contactsNoPurchase += 1;
  }
  for (const rr of revenueByResult(orderEvents, resultBySession)) {
    const row = rowOf(rr.resultId, rr.name, rr.noMatch);
    row.orders = rr.orders;
    row.totalsByCurrency = rr.totalsByCurrency;
  }
  const rank = (r: ResultRow) =>
    r.resultId === NOT_FINISHED_RESULT_ID ? 3 : r.resultId.startsWith("__unknown") ? 2 : r.resultId.startsWith("__no_match") ? 1 : 0;
  const results = [...rows.values()].sort(
    (a, b) => rank(a) - rank(b) || b.finished - a.finished || b.contacts - a.contacts || a.name.localeCompare(b.name),
  );

  const ledger = doc ? buildStepLedger(doc, events, started, finished) : null;
  const answers = doc ? answerDistributions(doc, events) : [];

  let canEmail = 0;
  for (const c of contactList) if (c.consent === true) canEmail += 1;

  return {
    started,
    finished,
    contacts: contactList.length,
    canEmail,
    bought: boughtSet.size,
    revenue,
    completedSet,
    boughtSet,
    addedSet,
    orderEvents,
    ledger,
    answers,
    resultBySession,
    results,
    contactList,
  };
}

/** Sum of a currency map — meaningful when there is one currency. */
export function revenueNumber(totals: Record<string, number>): number {
  return Object.values(totals).reduce((a, b) => a + b, 0);
}
