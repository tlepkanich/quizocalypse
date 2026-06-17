-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "shopifyConnectDomain" TEXT,
ADD COLUMN     "shopifyConnectToken" TEXT,
ADD COLUMN     "shopifyConnectedAt" TIMESTAMP(3);
