-- §M6 — referral give-get: the referrer's share token + friend redemptions.
CREATE TABLE "ReferralToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReferralToken_token_key" ON "ReferralToken"("token");
CREATE UNIQUE INDEX "ReferralToken_quizId_sessionId_key" ON "ReferralToken"("quizId", "sessionId");
CREATE INDEX "ReferralToken_quizId_createdAt_idx" ON "ReferralToken"("quizId", "createdAt");
ALTER TABLE "ReferralToken" ADD CONSTRAINT "ReferralToken_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "tokenValue" TEXT NOT NULL,
    "redeemerSessionId" TEXT NOT NULL,
    "redeemerEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "giveCode" TEXT,
    "getCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Referral_tokenValue_redeemerSessionId_key" ON "Referral"("tokenValue", "redeemerSessionId");
CREATE INDEX "Referral_quizId_createdAt_idx" ON "Referral"("quizId", "createdAt");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_tokenValue_fkey" FOREIGN KEY ("tokenValue") REFERENCES "ReferralToken"("token") ON DELETE CASCADE ON UPDATE CASCADE;
