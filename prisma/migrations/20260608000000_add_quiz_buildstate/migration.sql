-- Async AI-onboarding build marker. Nullable + additive: existing quizzes
-- become buildState = NULL (treated as "done/normal"), so this is back-compat.
-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN "buildState" TEXT;
