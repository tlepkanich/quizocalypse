-- AI-written personalization becomes opt-in (BILLING-HANDOFF.md, "Credit
-- tag": every per-use AI feature starts off). A shop made from now on starts
-- with the switch off.
--
-- Shops that exist today KEEP their value (owner, 2026-10-04): no UPDATE on
-- purpose. Only the default for new rows changes.
ALTER TABLE "Shop" ALTER COLUMN "aiRecCopyEnabled" SET DEFAULT false;
