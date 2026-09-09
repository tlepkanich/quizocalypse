ALTER TABLE "EmailCapture"
  ADD COLUMN "consentEvidence" JSONB,
  ADD COLUMN "consentRecordedAt" TIMESTAMP(3);
