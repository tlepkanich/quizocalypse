-- rg-wiring (2026-08-18) — the guided Results flow's marketing-consent
-- checkbox lands on the capture row. Nullable: null = the quiz never asked.
ALTER TABLE "EmailCapture" ADD COLUMN "marketingConsent" BOOLEAN;
