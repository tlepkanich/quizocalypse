-- §L — account-level engagement defaults on Shop (EngagementSettings shape).
ALTER TABLE "Shop" ADD COLUMN "engagementDefaults" JSONB;

-- §L L2 — post-result feedback (one submission per session).
CREATE TABLE "QuizFeedback" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "outcomeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuizFeedback_quizId_sessionId_key" ON "QuizFeedback"("quizId", "sessionId");
CREATE INDEX "QuizFeedback_quizId_createdAt_idx" ON "QuizFeedback"("quizId", "createdAt");

ALTER TABLE "QuizFeedback" ADD CONSTRAINT "QuizFeedback_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
