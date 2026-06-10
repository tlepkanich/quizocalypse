// ════════════════════════════════════════════════════════════════════════════
// Phase J — data-weighted logic. Computes per-answer CONVERSION LIFT from the
// QuizSession history (answerIds + converted, written by the runtime and the
// orders/create webhook) so the recommendation engine can let answers that
// historically lead to purchases count more in tag scoring.
//
// Pure + deterministic: no prisma, no Date.now. The publisher queries the rows
// and bakes the resulting weights into publishedJson; the engine treats a
// missing/empty weight map as "everything neutral", so this is additive.
//
// Statistics: small per-answer samples are the norm, so each answer's
// conversion rate is shrunk toward the quiz-wide baseline with a Bayesian
// prior (weight K pseudo-sessions at the baseline rate). The weight is the
// smoothed rate / baseline (lift), clamped to [0.5, 2] so no answer can ever
// dominate or zero-out tag scoring. Below the data gates the whole feature
// reports ineligible and nothing is baked.
// ════════════════════════════════════════════════════════════════════════════

export interface SessionSample {
  answerIds: string[];
  converted: boolean;
  completedAt: Date | string | null;
}

export interface AnswerWeightsResult {
  /** answerId → multiplicative tag-score weight (only when eligible). */
  weights: Record<string, number>;
  eligible: boolean;
  completed: number;
  conversions: number;
}

export const MIN_COMPLETED_SESSIONS = 30;
export const MIN_CONVERSIONS = 5;
const PRIOR_STRENGTH = 10; // K pseudo-sessions at the baseline rate
const WEIGHT_MIN = 0.5;
const WEIGHT_MAX = 2;

export function computeAnswerWeights(sessions: SessionSample[]): AnswerWeightsResult {
  const done = sessions.filter((s) => s.completedAt != null);
  const completed = done.length;
  const conversions = done.filter((s) => s.converted).length;
  const eligible = completed >= MIN_COMPLETED_SESSIONS && conversions >= MIN_CONVERSIONS;
  if (!eligible || conversions === 0) {
    return { weights: {}, eligible: false, completed, conversions };
  }

  const baseline = conversions / completed;
  const seen = new Map<string, { n: number; c: number }>();
  for (const s of done) {
    for (const id of new Set(s.answerIds)) {
      const e = seen.get(id) ?? { n: 0, c: 0 };
      e.n += 1;
      if (s.converted) e.c += 1;
      seen.set(id, e);
    }
  }

  const weights: Record<string, number> = {};
  for (const [id, { n, c }] of seen) {
    const smoothed = (c + PRIOR_STRENGTH * baseline) / (n + PRIOR_STRENGTH);
    const lift = smoothed / baseline;
    const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, lift));
    // Only store meaningful departures from neutral — keeps the baked map tiny.
    if (Math.abs(clamped - 1) >= 0.05) weights[id] = Math.round(clamped * 1000) / 1000;
  }
  return { weights, eligible: true, completed, conversions };
}
