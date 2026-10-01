-- Results handoff §12 — the per-shopper offer pipeline (keyed discounts,
-- pooled redeem codes, one grant per quiz session). Additive only.
CREATE TABLE "QuizOfferDiscount" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "shopifyDiscountId" TEXT,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    CONSTRAINT "QuizOfferDiscount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuizOfferDiscount_quizId_keyHash_key" ON "QuizOfferDiscount"("quizId", "keyHash");
CREATE INDEX "QuizOfferDiscount_quizId_endsAt_idx" ON "QuizOfferDiscount"("quizId", "endsAt");
ALTER TABLE "QuizOfferDiscount" ADD CONSTRAINT "QuizOfferDiscount_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuizOfferCode" (
    "id" TEXT NOT NULL,
    "discountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "redeemCodeId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizOfferCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuizOfferCode_discountId_code_key" ON "QuizOfferCode"("discountId", "code");
CREATE INDEX "QuizOfferCode_discountId_status_idx" ON "QuizOfferCode"("discountId", "status");
ALTER TABLE "QuizOfferCode" ADD CONSTRAINT "QuizOfferCode_discountId_fkey" FOREIGN KEY ("discountId") REFERENCES "QuizOfferDiscount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "QuizOfferGrant" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "email" TEXT,
    "codeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuizOfferGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QuizOfferGrant_codeId_key" ON "QuizOfferGrant"("codeId");
CREATE UNIQUE INDEX "QuizOfferGrant_quizId_sessionId_key" ON "QuizOfferGrant"("quizId", "sessionId");
CREATE INDEX "QuizOfferGrant_quizId_email_idx" ON "QuizOfferGrant"("quizId", "email");
ALTER TABLE "QuizOfferGrant" ADD CONSTRAINT "QuizOfferGrant_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuizOfferGrant" ADD CONSTRAINT "QuizOfferGrant_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "QuizOfferCode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
