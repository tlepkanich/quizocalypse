-- ANALYTICS — dismissible "What to fix" cards with a 14-day snooze.
--
-- Keyed on (quizId, cardId) where cardId is quizInsights' STABLE PER-OBJECT id
-- ("leak:<nodeId>", "unreachable-products", …) — not the headline text, so
-- re-wording a card can't resurrect a dismissal, and a finding about a
-- different object is never swept up by one.
--
-- snoozedUntil rather than a boolean: a dismissal lapses and the finding comes
-- back on its own if it was never actually fixed. Lapsed rows are KEPT (the
-- unique key makes a re-dismissal an UPDATE, not a second row), so the count
-- behind "Show dismissed" stays truthful and the table can't grow per click.
--
-- Purely additive: no existing table is touched, so every published doc and
-- the byte-pinned fixture are unaffected.
CREATE TABLE "InsightDismissal" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InsightDismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InsightDismissal_quizId_cardId_key" ON "InsightDismissal"("quizId", "cardId");
CREATE INDEX "InsightDismissal_quizId_snoozedUntil_idx" ON "InsightDismissal"("quizId", "snoozedUntil");

ALTER TABLE "InsightDismissal" ADD CONSTRAINT "InsightDismissal_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
