// ════════════════════════════════════════════════════════════════════════════
// Cross-quiz benchmarks (closes v3 Phase 6's last gap). Per-quiz completion
// rate — distinct sessions that finished ÷ distinct sessions that STARTED
// (quiz_engaged, the post-BIC-P2 honest "clicked Start" stage) — plus the
// account-wide POOLED average (total completions ÷ total starts, so a tiny
// quiz can't skew the bar the way a mean-of-rates would).
//
// Pure + deterministic: the loader feeds distinct (quizId, eventType,
// sessionId) rows; comparisons only render above a small sample floor so
// "100% of 1 session" never masquerades as a benchmark.
// ════════════════════════════════════════════════════════════════════════════

export interface BenchmarkEventRow {
  quizId: string;
  eventType: string;
  sessionId: string;
}

export interface QuizBenchmark {
  started: number;
  completed: number;
  /** completed/started as a 0–100 integer, or null when started === 0. */
  rate: number | null;
}

export interface Benchmarks {
  byQuiz: Record<string, QuizBenchmark>;
  /** Pooled account average (0–100), or null when no quiz has starts. */
  averageRate: number | null;
}

export const MIN_SESSIONS_FOR_COMPARE = 5;

export function computeBenchmarks(rows: BenchmarkEventRow[]): Benchmarks {
  const sets = new Map<string, { started: Set<string>; completed: Set<string> }>();
  for (const r of rows) {
    if (r.eventType !== "quiz_engaged" && r.eventType !== "quiz_completed") continue;
    const e = sets.get(r.quizId) ?? { started: new Set(), completed: new Set() };
    (r.eventType === "quiz_engaged" ? e.started : e.completed).add(r.sessionId);
    sets.set(r.quizId, e);
  }

  const byQuiz: Record<string, QuizBenchmark> = {};
  let totalStarted = 0;
  let totalCompleted = 0;
  for (const [quizId, e] of sets) {
    const started = e.started.size;
    // A completion only counts against a start (resume edge cases can complete
    // a session whose engage predates the event's introduction).
    const completed = Math.min(e.completed.size, started);
    byQuiz[quizId] = {
      started,
      completed,
      rate: started > 0 ? Math.round((completed / started) * 100) : null,
    };
    totalStarted += started;
    totalCompleted += completed;
  }

  return {
    byQuiz,
    averageRate: totalStarted > 0 ? Math.round((totalCompleted / totalStarted) * 100) : null,
  };
}
