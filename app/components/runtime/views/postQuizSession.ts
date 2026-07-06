// Persist a server-side QuizSession on completion (Dev Spec §7.2). Fire-and-
// forget; a failure never affects the shopper. The caller preview-gates this.
export function postQuizSession(args: {
  quizId?: string;
  sessionId?: string;
  outcomeId: string;
  answerIds: string[];
  productIds: string[];
}) {
  if (!args.quizId || !args.sessionId) return;
  void fetch("/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quiz_id: args.quizId,
      session_id: args.sessionId,
      outcome_id: args.outcomeId,
      answer_ids: args.answerIds,
      matched_product_ids: args.productIds,
    }),
    keepalive: true,
  }).catch(() => {});
}
