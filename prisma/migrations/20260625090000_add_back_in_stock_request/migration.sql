-- CreateTable
CREATE TABLE "BackInStockRequest" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "quizId" TEXT NOT NULL,
    "sessionId" TEXT,
    "productId" TEXT,
    "email" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackInStockRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackInStockRequest_quizId_requestedAt_idx" ON "BackInStockRequest"("quizId", "requestedAt");

-- CreateIndex
CREATE INDEX "BackInStockRequest_email_idx" ON "BackInStockRequest"("email");

-- AddForeignKey
ALTER TABLE "BackInStockRequest" ADD CONSTRAINT "BackInStockRequest_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
