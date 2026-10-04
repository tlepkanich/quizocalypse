import prisma from "../../db.server";
import { sendEmail } from "../email.server";
import { formatMonthDay } from "../formatDate";
import { logFor, reportError } from "../log.server";
import { billEmailLinks, loadCycleFiguresIfStarted } from "./account.server";
import { nearAlertEmail, outAlertEmail } from "./billEmailMessages";
import { parseBillEmails } from "./billEmails";
import { selfServePlan } from "./catalog";
import { creditAlertToSend, creditsCents, lastDayOf } from "./creditMath";

// Account & Billing — the two credit alerts (BILLING-HANDOFF.md, "Emails"):
// one at 80% of the cycle's credits, one when they run out. Each goes to
// every saved bill email, once per cycle.
//
// The app has no server timer, so the check runs after each usage write: a
// stored `quiz_engaged` event (routes/events.tsx) and a recorded AI use
// (creditUse.server.ts). Those are shopper endpoints, so the check is
// fire-and-forget, never rejects, and runs at most once a minute per shop.
// Two server processes can both run it; the claim below lets one send.

const CHECK_EVERY_MS = 60_000;
/** After an alert that could not be sent, wait this long before the next try,
    so a broken email transport is not tried once a minute. */
const RETRY_UNSENT_AFTER_MS = 15 * 60_000;
/** Per shop: the time before which no check runs. */
const nextCheckAt = new Map<string, number>();

/** Check one shop's credits and send the alert that is due. NEVER throws and
    never rejects: the shopper's request must not depend on it. */
export async function checkCreditAlerts(shopId: string, now: Date = new Date()): Promise<void> {
  if (now.getTime() < (nextCheckAt.get(shopId) ?? 0)) return;
  nextCheckAt.set(shopId, now.getTime() + CHECK_EVERY_MS);
  try {
    const outcome = await sendDueAlert(shopId, now);
    if (outcome === "unsent") nextCheckAt.set(shopId, now.getTime() + RETRY_UNSENT_AFTER_MS);
  } catch (err) {
    reportError(err, { scope: "billing", msg: "credit alert check failed", shopId });
  }
}

/** "unsent": an alert was due and no address got it. */
async function sendDueAlert(shopId: string, now: Date): Promise<"none" | "sent" | "unsent"> {
  const state = await loadCycleFiguresIfStarted(shopId, now);
  if (!state) return "none";
  const { billing, figures } = state;
  const emails = parseBillEmails(billing.billEmails);
  if (emails.length === 0) return "none";

  const sentInThisCycle = (sentFor: Date | null) => sentFor?.getTime() === billing.cycleStart.getTime();
  const alert = creditAlertToSend(figures, billing.status === "trial", {
    nearOn: billing.emailAlertNear,
    outOn: billing.emailAlertOut,
    nearSent: sentInThisCycle(billing.alertNearSentFor),
    outSent: sentInThisCycle(billing.alertOutSentFor),
  });
  if (!alert) return "none";

  // Claim the send first. The "not sent in this cycle" test is in the WHERE,
  // so of two checks that cross the line together only one sends.
  const marker = alert === "out" ? "alertOutSentFor" : "alertNearSentFor";
  const thisCycle = { id: billing.id, cycleStart: billing.cycleStart };
  const claimed = await prisma.shopBilling.updateMany({
    where: { ...thisCycle, OR: [{ [marker]: null }, { [marker]: { not: billing.cycleStart } }] },
    data: { [marker]: billing.cycleStart },
  });
  if (claimed.count !== 1) return "none";

  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { shopDomain: true } });
  const cycle = { start: billing.cycleStart, end: billing.cycleEnd };
  const facts = {
    shopDomain: shop?.shopDomain ?? "",
    used: figures.used,
    available: figures.available,
    left: figures.left,
    share: figures.share,
    extraCreditCents: creditsCents(1, selfServePlan(billing.plan).rate),
    lastDay: formatMonthDay(lastDayOf(cycle)),
    links: billEmailLinks(),
  };
  const content = alert === "out" ? outAlertEmail(facts) : nearAlertEmail(facts);
  const results = await Promise.allSettled(emails.map((to) => sendEmail({ to, ...content }, "billing")));
  const sent = results.filter((result) => result.status === "fulfilled" && result.value.sent).length;
  if (sent > 0) {
    logFor("billing").info({ shopId, alert, sent, saved: emails.length }, "credit alert sent");
    return "sent";
  }

  // Nothing went out (no transport, or every send failed): give the claim
  // back, so a later check tries again.
  await prisma.shopBilling.updateMany({ where: thisCycle, data: { [marker]: billing[marker] } });
  logFor("billing").warn({ shopId, alert, saved: emails.length }, "credit alert not sent — will retry");
  return "unsent";
}
