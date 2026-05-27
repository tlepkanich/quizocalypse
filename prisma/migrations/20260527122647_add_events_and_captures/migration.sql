-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCapture" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_quizId_ts_idx" ON "Event"("quizId", "ts");

-- CreateIndex
CREATE INDEX "Event_quizId_eventType_ts_idx" ON "Event"("quizId", "eventType", "ts");

-- CreateIndex
CREATE INDEX "EmailCapture_quizId_capturedAt_idx" ON "EmailCapture"("quizId", "capturedAt");

-- CreateIndex
CREATE INDEX "EmailCapture_email_idx" ON "EmailCapture"("email");
