-- P3 Edit 2 — Groups & Personas: mixed-source membership criteria on Category.
-- Additive + nullable: legacy single-source categories are unaffected.
ALTER TABLE "Category" ADD COLUMN "membership" JSONB;
