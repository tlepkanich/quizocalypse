-- PORT-10 — global "starter" quiz templates. Additive + backward-compatible:
-- shopId becomes NULLABLE (NULL = a global/builtin row visible to every shop;
-- existing per-shop rows are untouched — zero rewrites), and slug is the seed
-- script's stable upsert key (scripts/seed-templates.mjs), unique so re-runs
-- are no-ops. The existing shopId FK (ON DELETE CASCADE) is unchanged — a
-- nullable FK simply doesn't enforce on NULL rows.
ALTER TABLE "SavedTemplate" ALTER COLUMN "shopId" DROP NOT NULL;
ALTER TABLE "SavedTemplate" ADD COLUMN "slug" TEXT;
CREATE UNIQUE INDEX "SavedTemplate_slug_key" ON "SavedTemplate"("slug");
