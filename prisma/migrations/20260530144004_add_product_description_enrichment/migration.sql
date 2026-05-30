-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "descriptionHtml" TEXT,
ADD COLUMN     "descriptionText" TEXT,
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3);
