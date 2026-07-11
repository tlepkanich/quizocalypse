-- §M3 — a reward issued to a shopper at result reveal (one per session).
CREATE TABLE "QuizReward" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "rewardType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "email" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuizReward_quizId_sessionId_key" ON "QuizReward"("quizId", "sessionId");
CREATE INDEX "QuizReward_quizId_createdAt_idx" ON "QuizReward"("quizId", "createdAt");

ALTER TABLE "QuizReward" ADD CONSTRAINT "QuizReward_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
