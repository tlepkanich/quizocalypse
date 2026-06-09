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
  /** Sessions with a completedAt (finished the quiz). */
  completed: number;
  /** Sessions attributed to an order (QuizSession.converted). */
  converted: number;
  /** converted / completed (0 when none completed). */
  rate: number;
}

/** Conversion rate from server-side QuizSession rows. */
export function conversionSummary(
  sessions: Array<{ completedAt: Date | null; converted: boolean }>,
): ConversionSummary {
  let completed = 0;
  let converted = 0;
  for (const s of sessions) {
    if (s.completedAt != null) completed += 1;
    if (s.converted) converted += 1;
  }
  return { completed, converted, rate: completed > 0 ? converted / completed : 0 };
}
