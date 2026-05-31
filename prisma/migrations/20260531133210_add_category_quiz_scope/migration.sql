-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "quizId" TEXT;

-- CreateIndex
CREATE INDEX "Category_shopId_quizId_idx" ON "Category"("shopId", "quizId");
