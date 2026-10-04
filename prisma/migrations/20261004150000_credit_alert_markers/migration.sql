-- Bill emails (BILLING-HANDOFF.md, "Emails"): the 80% alert and the run-out
-- alert each go out once per cycle. These hold the `cycleStart` of the cycle
-- the alert was last sent in. Additive only.
ALTER TABLE "ShopBilling"
  ADD COLUMN "alertNearSentFor" TIMESTAMP(3),
  ADD COLUMN "alertOutSentFor" TIMESTAMP(3);
