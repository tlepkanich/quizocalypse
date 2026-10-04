-- Account & Billing (BILLING-HANDOFF.md, "What must be recorded"): plan state
-- and bill-email settings per shop, per-cycle credit grants, the per-use AI
-- usage ledger, and our own record of each bill. Additive only.
CREATE TABLE "ShopBilling" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "cycleEnd" TIMESTAMP(3) NOT NULL,
    "everyCycleCredits" INTEGER NOT NULL DEFAULT 0,
    "pendingPlan" TEXT,
    "cancelAt" TIMESTAMP(3),
    "shopifySubscriptionId" TEXT,
    "billEmails" JSONB,
    "emailReceipt" BOOLEAN NOT NULL DEFAULT true,
    "emailAlertNear" BOOLEAN NOT NULL DEFAULT true,
    "emailAlertOut" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopBilling_shopId_key" ON "ShopBilling"("shopId");
ALTER TABLE "ShopBilling" ADD CONSTRAINT "ShopBilling_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CreditGrant" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditGrant_shopId_cycleStart_idx" ON "CreditGrant"("shopId", "cycleStart");
ALTER TABLE "CreditGrant" ADD CONSTRAINT "CreditGrant_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CreditUse" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "sessionId" TEXT,
    "milliCredits" INTEGER NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditUse_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditUse_shopId_ts_idx" ON "CreditUse"("shopId", "ts");

CREATE TABLE "ShopBill" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "billDate" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL,
    "creditsAvailable" INTEGER NOT NULL,
    "creditsUsed" INTEGER NOT NULL,
    "creditsOver" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopBill_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ShopBill_shopId_billDate_idx" ON "ShopBill"("shopId", "billDate");
