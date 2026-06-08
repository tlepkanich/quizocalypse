-- Server-side quiz sessions (Dev Spec §7.2). Additive: a new table, no changes
-- to existing rows. Applied on deploy via `prisma migrate deploy`.
-- CreateTable
CREATE TABLE "QuizSession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "outcomeId" TEXT,
    "answerIds" TEXT[],
    "matchedProductIds" TEXT[],
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "QuizSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuizSession_quizId_sessionId_key" ON "QuizSession"("quizId", "sessionId");

-- CreateIndex
CREATE INDEX "QuizSession_quizId_completedAt_idx" ON "QuizSession"("quizId", "completedAt");

-- AddForeignKey
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
