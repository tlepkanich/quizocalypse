-- HOME-3 (first-run handoff §10.3 / §10.5) — per-shop Home state: when the
-- first-open goal dialog was shown (once per shop, forever) and the one
-- reminder item the merchant last dismissed. Nullable; no backfill.
ALTER TABLE "Shop" ADD COLUMN "homeState" JSONB;
