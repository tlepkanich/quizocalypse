-- Analytics handoff §8: one Klaviyo connection per shop. Nullable, no
-- default, no backfill: every existing row reads "not connected".
ALTER TABLE "Shop" ADD COLUMN "klaviyoApiKey" TEXT;
ALTER TABLE "Shop" ADD COLUMN "klaviyoAccountName" TEXT;
ALTER TABLE "Shop" ADD COLUMN "klaviyoConnectedAt" TIMESTAMP(3);
