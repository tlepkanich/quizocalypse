-- Results handoff §14 / §17.3 (owner ruling 2026-09-30): phone numbers stored
-- by /captures have no recorded SMS consent, so they can never be used
-- lawfully, and phone is Level 2 protected customer data. Delete them.
-- The column itself is dropped in a LATER release: CI auto-rolls back to the
-- previous image on a failed smoke test, and that image still selects it.
UPDATE "EmailCapture" SET "phone" = NULL WHERE "phone" IS NOT NULL;
