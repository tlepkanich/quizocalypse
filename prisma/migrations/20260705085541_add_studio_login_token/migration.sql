-- CreateTable
CREATE TABLE "StudioLoginToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioLoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudioLoginToken_tokenHash_key" ON "StudioLoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "StudioLoginToken_email_createdAt_idx" ON "StudioLoginToken"("email", "createdAt");
