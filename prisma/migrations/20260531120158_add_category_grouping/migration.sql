-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "manualProductIds" TEXT[],
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ai',
ADD COLUMN     "sourceRef" TEXT;
