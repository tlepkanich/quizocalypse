-- CreateTable
CREATE TABLE "SavedTemplate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedTemplate_shopId_idx" ON "SavedTemplate"("shopId");

-- AddForeignKey
ALTER TABLE "SavedTemplate" ADD CONSTRAINT "SavedTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
