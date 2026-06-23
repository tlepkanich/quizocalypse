// Pure funnel aggregation for the merchant analytics dashboard (Dev Spec §8 /
// Miro "Analytics & Reporting"). The dashboard loader does the DB reads and
// feeds these deterministic helpers — keeps the funnel math unit-testable and
// out of the route.

interface FunnelEvent {
  sessionId: string;
  eventType: string;
  payload: unknown;
}

export interface QuestionDropoff {
  questionId: string;
  text: string;
  /** Distinct sessions that answered this question. */
  answered: number;
  /** answered / started (0 when nothing started). */
  pctOfStarted: number;
}

/**
 * Per-question drop-off: for each question (in flow order), how many distinct
 * sessions answered it, as an absolute count and a fraction of starts. Branching
 * means later questions are reached by fewer sessions — that's the drop-off.
 */
export function perQuestionDropoff(
  events: FunnelEvent[],
  questions: Array<{ id: string; text: string }>,
  started: number,
): QuestionDropoff[] {
  const byQuestion = new Map<string, Set<string>>();
  for (const e of events) {
    if (e.eventType !== "question_answered") continue;
    const qid = (e.payload as { question_id?: string } | null)?.question_id;
    if (!qid) continue;
    let set = byQuestion.get(qid);
    if (!set) {
      set = new Set();
      byQuestion.set(qid, set);
    }
    set.add(e.sessionId);
  }
  return questions.map((q) => {
    const answered = byQuestion.get(q.id)?.size ?? 0;
    return {
      questionId: q.id,
      text: q.text,
      answered,
      pctOfStarted: started > 0 ? answered / started : 0,
    };
  });
}

export interface ConversionSummary {
  /** Completed sessions — the SAME event-based `quiz_completed` count the funnel
   *  uses (passed in by the caller), so this denominator agrees with the funnel. */
  completed: number;
  /** Sessions attributed to an order (QuizSession.converted). */
  converted: number;
  /** converted / completed, clamped to [0,1] (0 when none completed). */
  rate: number;
}

/**
 * Conversion rate. `converted` comes from the authoritative server-side
 * `QuizSession.converted` flag (set by the orders/create webhook); `completed` is
 * the canonical funnel completion count (distinct `quiz_completed` events) passed
 * in by the caller, so the denominator matches the funnel + completion-rate card
 * on the same page rather than diverging on `QuizSession.completedAt`. The rate is
 * clamped because a converted session can, rarely, lack a client-fired
 * quiz_completed event.
 */
export function conversionSummary(
  sessions: Array<{ converted: boolean }>,
  completed: number,
): ConversionSummary {
  let converted = 0;
  for (const s of sessions) {
    if (s.converted) converted += 1;
  }
  return { completed, converted, rate: completed > 0 ? Math.min(converted / completed, 1) : 0 };
}

export interface RevenueSummary {
  /** Distinct orders attributed to this quiz. */
  orders: number;
  /** Sum of order totals per currency code ("" when the webhook had none). */
  totalsByCurrency: Record<string, number>;
}

/**
 * Sum attributed revenue from order_attributed Event rows (written server-side
 * by the orders/create webhook). One order can win MULTIPLE sessions → one row
 * each — dedupe by payload.order_id so an order is counted once. Malformed
 * payloads are skipped.
 */
export function totalRevenue(events: FunnelEvent[]): RevenueSummary {
  const seen = new Map<string, { total: number; currency: string }>();
  for (const e of events) {
    if (e.eventType !== "order_attributed") continue;
    const p = e.payload as {
      order_id?: unknown;
      total_price?: unknown;
      currency?: unknown;
    } | null;
    const orderId = typeof p?.order_id === "string" ? p.order_id : null;
    const total = typeof p?.total_price === "string" ? Number(p.total_price) : NaN;
    if (!orderId || !Number.isFinite(total)) continue;
    if (seen.has(orderId)) continue;
    seen.set(orderId, {
      total,
      currency: typeof p?.currency === "string" ? p.currency : "",
    });
  }
  const totalsByCurrency: Record<string, number> = {};
  for (const { total, currency } of seen.values()) {
    totalsByCurrency[currency] = (totalsByCurrency[currency] ?? 0) + total;
  }
  return { orders: seen.size, totalsByCurrency };
}

/** "1,234.50 USD · 99.00 EUR" (or "—" with no orders) for the Revenue stat. */
export function formatRevenue(rev: RevenueSummary): string {
  const parts = Object.entries(rev.totalsByCurrency).map(
    ([cur, amt]) =>
      `${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`,
  );
  return parts.length > 0 ? parts.join(" · ") : "—";
}
