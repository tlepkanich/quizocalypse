-- BIC-2 A3 (additive): per-shop daily AI token usage for spend ceilings.
-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsage_shopId_day_key" ON "AiUsage"("shopId", "day");
