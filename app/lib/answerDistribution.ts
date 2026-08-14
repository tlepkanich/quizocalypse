// ANALYTICS P0 — per-question answer distributions (spec section 03). Distinct
// sessions per option, a first-class Skipped bucket (answer_ids: []), and
// last-write-wins per (session, question) so back-nav re-answers replace
// rather than double-count. Labels come from the published doc, joined by id;
// an answer id the doc no longer knows renders as "(removed option)" instead
// of being silently dropped. Freeform types report a count, not a bar.
//
// Pure: no DB, no React.

import type { Quiz as QuizDoc } from "./quizSchema";
import { FREEFORM_QUESTION_TYPES } from "./quizSchema";

export interface AnswerOptionRow {
  answerId: string;
  label: string;
  /** Distinct sessions whose LAST answer to this question included the option. */
  sessions: number;
  /** sessions ÷ answered (0 when nothing answered). */
  share: number;
}

export interface QuestionDistribution {
  questionId: string;
  text: string;
  questionType: string;
  /** True ⇒ shoppers could pick more than one; shares don't total 100%. */
  multi: boolean;
  /** True ⇒ freeform (text/email); render a response count, not bars. */
  freeform: boolean;
  /** Distinct sessions that answered OR skipped (the question's own pool). */
  reached: number;
  /** Distinct sessions whose last write picked ≥1 option. */
  answered: number;
  /** Distinct sessions whose last write was a skip ([]). */
  skipped: number;
  /** Mean options per answering session (multi-select only, else 1). */
  avgPicks: number;
  options: AnswerOptionRow[];
}

interface DistEvent {
  sessionId: string;
  eventType: string;
  payload: unknown;
  ts: number;
}

/**
 * Build one distribution per question node, in doc order. `events` are the
 * cohort's raw rows; anything that isn't question_answered is ignored.
 */
export function answerDistributions(doc: QuizDoc, events: DistEvent[]): QuestionDistribution[] {
  // Last write per (question, session).
  const last = new Map<string, Map<string, { ids: string[]; ts: number }>>();
  for (const e of events) {
    if (e.eventType !== "question_answered") continue;
    const p = e.payload as { question_id?: unknown; answer_ids?: unknown } | null;
    const qid = typeof p?.question_id === "string" ? p.question_id : null;
    if (!qid) continue;
    const ids = Array.isArray(p?.answer_ids)
      ? p.answer_ids.filter((v): v is string => typeof v === "string")
      : [];
    let perSession = last.get(qid);
    if (!perSession) {
      perSession = new Map();
      last.set(qid, perSession);
    }
    const prev = perSession.get(e.sessionId);
    if (!prev || e.ts >= prev.ts) perSession.set(e.sessionId, { ids, ts: e.ts });
  }

  const out: QuestionDistribution[] = [];
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    const perSession = last.get(n.id) ?? new Map<string, { ids: string[]; ts: number }>();
    const freeform = (FREEFORM_QUESTION_TYPES as readonly string[]).includes(n.data.question_type);

    let answered = 0;
    let skipped = 0;
    let totalPicks = 0;
    const byOption = new Map<string, number>();
    for (const { ids } of perSession.values()) {
      if (ids.length === 0) {
        skipped += 1;
        continue;
      }
      answered += 1;
      totalPicks += ids.length;
      for (const id of ids) byOption.set(id, (byOption.get(id) ?? 0) + 1);
    }

    const labelById = new Map(n.data.answers.map((a) => [a.id, a.text]));
    const options: AnswerOptionRow[] = [];
    // Doc order first, then any historical ids the doc no longer carries.
    for (const a of n.data.answers) {
      const sessions = byOption.get(a.id) ?? 0;
      options.push({
        answerId: a.id,
        label: a.text,
        sessions,
        share: answered > 0 ? sessions / answered : 0,
      });
      byOption.delete(a.id);
    }
    for (const [id, sessions] of byOption) {
      options.push({
        answerId: id,
        label: labelById.get(id) ?? "(removed option)",
        sessions,
        share: answered > 0 ? sessions / answered : 0,
      });
    }
    options.sort((a, b) => b.sessions - a.sessions || a.label.localeCompare(b.label));

    out.push({
      questionId: n.id,
      text: n.data.text,
      questionType: n.data.question_type,
      multi: n.data.question_type === "multi_select" || (n.data.max_selections ?? 1) > 1,
      freeform,
      reached: perSession.size,
      answered,
      skipped,
      avgPicks: answered > 0 ? totalPicks / answered : 0,
      options: freeform ? [] : options,
    });
  }
  return out;
}
