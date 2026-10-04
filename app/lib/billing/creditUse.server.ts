import prisma from "../../db.server";
import { reportError } from "../log.server";
import { featureMilliCredits, type AiFeatureKey } from "./catalog";
import { checkCreditAlerts } from "./creditAlerts.server";

// Account & Billing — the per-use AI usage ledger (CreditUse). One row per
// use of a feature in catalog.ts AI_FEATURES, written by the two shopper
// endpoints that serve them (q.$id.rec-copy, q.$id.ai-chat).
//
// Separate from AiUsage on purpose: AiUsage counts TOKENS a shop cost us
// (a cache hit costs nothing); this counts USES a shop is charged for (a
// reused answer costs the same as a fresh one — a decided billing rule).

/** Record one use, then check whether a credit alert is due. NEVER throws
    and never rejects: the shopper already has their answer, and a ledger
    outage must not break the quiz. */
export async function recordCreditUse(use: {
  shopId: string;
  quizId: string;
  feature: AiFeatureKey;
  sessionId?: string;
}): Promise<void> {
  try {
    await prisma.creditUse.create({
      data: {
        shopId: use.shopId,
        quizId: use.quizId,
        feature: use.feature,
        sessionId: use.sessionId ?? null,
        milliCredits: featureMilliCredits(use.feature),
      },
    });
    await checkCreditAlerts(use.shopId);
  } catch (err) {
    reportError(err, {
      scope: "billing",
      msg: "credit use record failed",
      shopId: use.shopId,
      quizId: use.quizId,
      feature: use.feature,
    });
  }
}
