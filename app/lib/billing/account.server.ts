import type { Shop, ShopBilling } from "@prisma/client";
import { z } from "zod";
import prisma from "../../db.server";
import { formatMonthDay, formatMonthDayYear } from "../formatDate";
import { checkNewBillEmail, parseBillEmails } from "./billEmails";
import {
  AI_FEATURES,
  DEFAULT_PLAN,
  TRIAL_DAYS,
  selfServePlan,
  type AiFeatureKey,
  type SelfServePlanKey,
} from "./catalog";
import {
  creditFigures,
  cycleAfter,
  daysLeftIn,
  lastDayOf,
  rolloverAtCycleEnd,
  type CycleCredits,
  type CycleUsage,
  type CycleWindow,
  type QuizUsage,
} from "./creditMath";

// Account & Billing — the server seam for /studio/account and
// /studio/account/plan (BILLING-HANDOFF.md). Loads one shop's plan state,
// credits and usage for the current cycle; runs the bill-email intents.
//
// SHOPIFY BILLING IS NOT CONNECTED YET. No function here calls Shopify and
// nothing here charges anyone: a plan change, a credit purchase and a cancel
// all need the merchant's approval on Shopify's screen (handoff, "Shopify
// billing"), and that build has open owner decisions (4, 16). Until then the
// plan state only moves by date: a trial becomes the active plan on its end
// date, and cycles follow each other every 30 days. The Change plan page
// confirms each action in its dialog and then changes nothing.

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_BILLS_SHOWN = 24;
const DELETED_QUIZ_NAME = "Deleted quiz";

export interface AccountBill {
  id: string;
  billDate: string;
  planName: string;
  creditsAvailable: number;
  creditsUsed: number;
  totalCents: number;
}

export interface AccountData {
  shopDomain: string;
  planKey: SelfServePlanKey;
  inTrial: boolean;
  /** A downgrade booked for the next bill date. */
  pendingPlanKey: SelfServePlanKey | null;
  /** The plan is cancelled and stays on until the cycle's last day. */
  ending: boolean;
  credits: CycleCredits;
  usage: CycleUsage;
  /** Quizzes with usage in the cycle, most credits first. */
  quizzes: QuizUsage[];
  /** Formatted on the server from UTC parts, so SSR and the browser agree. */
  dates: {
    /** "Sep 19 – Oct 18" */
    range: string;
    /** "Oct 18" — the cycle's last day. */
    lastDay: string;
    /** "Oct 19" — the next bill date (in a trial, the day it ends). */
    billDate: string;
    /** "Oct 19, 2026" */
    billDateLong: string;
    daysLeft: number;
  };
  emails: string[];
  switches: { receipt: boolean; near: boolean; out: boolean };
  bills: AccountBill[];
  /** The Shopify admin's billing page; null for a shop Shopify can't bill. */
  shopifyBillingUrl: string | null;
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isAiFeatureKey(key: string): key is AiFeatureKey {
  return AI_FEATURES.some((feature) => feature.key === key);
}

/** Usage inside one cycle: the shop's totals and the split per quiz.
    Engagements are distinct (quiz, session) `quiz_engaged` events — the same
    rows Home and Analytics count. AI uses come from the CreditUse ledger. */
async function loadCycleUsage(
  shopId: string,
  cycle: CycleWindow,
): Promise<{ totals: CycleUsage; quizzes: QuizUsage[] }> {
  const window = { gte: cycle.start, lt: cycle.end };
  const shopQuizzes = await prisma.quiz.findMany({ where: { shopId }, select: { id: true, name: true } });
  const [engagedRows, useRows] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: { in: shopQuizzes.map((quiz) => quiz.id) }, eventType: "quiz_engaged", ts: window },
      select: { quizId: true, sessionId: true },
      distinct: ["quizId", "sessionId"],
    }),
    prisma.creditUse.groupBy({
      by: ["quizId", "feature"],
      where: { shopId, ts: window },
      _count: { _all: true },
      _sum: { milliCredits: true },
    }),
  ]);

  const nameOf = new Map(shopQuizzes.map((quiz) => [quiz.id, quiz.name]));
  const byQuiz = new Map<string, QuizUsage>();
  const quizUsage = (quizId: string): QuizUsage => {
    const existing = byQuiz.get(quizId);
    if (existing) return existing;
    const fresh: QuizUsage = { quizId, name: nameOf.get(quizId) ?? DELETED_QUIZ_NAME, engagements: 0, ai: {} };
    byQuiz.set(quizId, fresh);
    return fresh;
  };

  for (const row of engagedRows) quizUsage(row.quizId).engagements += 1;

  const totals: CycleUsage = {
    engagements: engagedRows.length,
    ai: AI_FEATURES.map((feature) => ({ key: feature.key, uses: 0, milliCredits: 0 })),
  };
  for (const row of useRows) {
    if (!isAiFeatureKey(row.feature)) continue;
    const milliCredits = row._sum.milliCredits ?? 0;
    const total = totals.ai.find((use) => use.key === row.feature);
    if (total) {
      total.uses += row._count._all;
      total.milliCredits += milliCredits;
    }
    const quiz = quizUsage(row.quizId);
    quiz.ai[row.feature] = (quiz.ai[row.feature] ?? 0) + milliCredits;
  }

  const milliOf = (quiz: QuizUsage) =>
    quiz.engagements * 1000 + Object.values(quiz.ai).reduce((sum, milli) => sum + (milli ?? 0), 0);
  const quizzes = [...byQuiz.values()].sort((a, b) => milliOf(b) - milliOf(a));
  return { totals, quizzes };
}

/** Credits a shop holds in the cycle beyond the plan's own. */
async function loadCycleCredits(billing: ShopBilling): Promise<CycleCredits> {
  const grants = await prisma.creditGrant.groupBy({
    by: ["source"],
    where: { shopId: billing.shopId, cycleStart: billing.cycleStart },
    _sum: { credits: true },
  });
  const sumOf = (source: string) => grants.find((grant) => grant.source === source)?._sum.credits ?? 0;
  return {
    everyCycle: billing.everyCycleCredits,
    oneTime: sumOf("one_time"),
    rolledOver: sumOf("rollover"),
  };
}

/** Close the cycle that has ended and open the next one: a trial becomes the
    active plan, a booked downgrade starts, and what is left rolls over once.
    Trial credits never roll over (assumed — the handoff does not say). The
    `cycleEnd` guard makes two concurrent loads close a cycle only once.
    A booked cancel (`cancelAt`) is not acted on here: taking quizzes off the
    store is its own task. No ShopBill is written while billing is not
    connected — nothing was charged. */
async function closeCycle(billing: ShopBilling): Promise<ShopBilling> {
  const cycle: CycleWindow = { start: billing.cycleStart, end: billing.cycleEnd };
  const plan = selfServePlan(billing.plan);
  const [usage, credits] = await Promise.all([loadCycleUsage(billing.shopId, cycle), loadCycleCredits(billing)]);
  const figures = creditFigures(plan, credits, usage.totals);
  const rollover =
    billing.status === "trial"
      ? 0
      : rolloverAtCycleEnd({
          fresh: plan.credits + credits.everyCycle + credits.oneTime,
          rolledIn: credits.rolledOver,
          used: figures.used,
        });
  const next = cycleAfter(cycle);

  return prisma.$transaction(async (tx) => {
    const closed = await tx.shopBilling.updateMany({
      where: { id: billing.id, cycleEnd: billing.cycleEnd },
      data: {
        status: "active",
        plan: billing.pendingPlan ?? billing.plan,
        pendingPlan: null,
        cycleStart: next.start,
        cycleEnd: next.end,
      },
    });
    if (closed.count === 1 && rollover > 0) {
      await tx.creditGrant.create({
        data: { shopId: billing.shopId, source: "rollover", credits: rollover, cycleStart: next.start },
      });
    }
    return tx.shopBilling.findUniqueOrThrow({ where: { id: billing.id } });
  });
}

/** The shop's plan state, brought up to `now`. A shop with no record starts a
    free trial on the default plan (owner, 2026-10-04). */
async function ensureBillingForShop(shopId: string, now: Date): Promise<ShopBilling> {
  const trialStart = startOfUtcDay(now);
  let billing = await prisma.shopBilling.upsert({
    where: { shopId },
    update: {},
    create: {
      shopId,
      plan: DEFAULT_PLAN,
      status: "trial",
      cycleStart: trialStart,
      cycleEnd: new Date(trialStart.getTime() + TRIAL_DAYS * DAY_MS),
    },
  });
  while (now.getTime() >= billing.cycleEnd.getTime()) billing = await closeCycle(billing);
  return billing;
}

function shopifyBillingUrl(shop: Pick<Shop, "shopDomain" | "source">): string | null {
  const suffix = ".myshopify.com";
  if (shop.source !== "shopify" || !shop.shopDomain.endsWith(suffix)) return null;
  return `https://admin.shopify.com/store/${shop.shopDomain.slice(0, -suffix.length)}/settings/billing`;
}

/** Everything the Account and Change plan pages show for one shop. */
export async function loadAccountForShop(
  shop: Pick<Shop, "id" | "shopDomain" | "source">,
  now: Date = new Date(),
): Promise<AccountData> {
  const billing = await ensureBillingForShop(shop.id, now);
  const cycle: CycleWindow = { start: billing.cycleStart, end: billing.cycleEnd };
  const [usage, credits, bills] = await Promise.all([
    loadCycleUsage(shop.id, cycle),
    loadCycleCredits(billing),
    prisma.shopBill.findMany({
      where: { shopId: shop.id },
      orderBy: { billDate: "desc" },
      take: PAST_BILLS_SHOWN,
    }),
  ]);

  return {
    shopDomain: shop.shopDomain,
    planKey: selfServePlan(billing.plan).key,
    inTrial: billing.status === "trial",
    pendingPlanKey: billing.pendingPlan ? selfServePlan(billing.pendingPlan).key : null,
    ending: billing.cancelAt !== null,
    credits,
    usage: usage.totals,
    quizzes: usage.quizzes,
    dates: {
      range: `${formatMonthDay(cycle.start)} – ${formatMonthDay(lastDayOf(cycle))}`,
      lastDay: formatMonthDay(lastDayOf(cycle)),
      billDate: formatMonthDay(cycle.end),
      billDateLong: formatMonthDayYear(cycle.end),
      daysLeft: daysLeftIn(cycle, now),
    },
    emails: parseBillEmails(billing.billEmails),
    switches: { receipt: billing.emailReceipt, near: billing.emailAlertNear, out: billing.emailAlertOut },
    bills: bills.map((bill) => ({
      id: bill.id,
      billDate: formatMonthDayYear(bill.billDate),
      planName: selfServePlan(bill.plan).name,
      creditsAvailable: bill.creditsAvailable,
      creditsUsed: bill.creditsUsed,
      totalCents: bill.totalCents,
    })),
    shopifyBillingUrl: shopifyBillingUrl(shop),
  };
}

/* ── Intents: bill emails and their three switches ───────────────────────── */

const SWITCH_COLUMN = { receipt: "emailReceipt", near: "emailAlertNear", out: "emailAlertOut" } as const;

const AccountIntent = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("add-email"), email: z.string() }),
  z.object({ intent: z.literal("remove-email"), email: z.string() }),
  z.object({
    intent: z.literal("set-switch"),
    key: z.enum(["receipt", "near", "out"]),
    on: z.enum(["true", "false"]),
  }),
]);

export type AccountIntentResult =
  | { ok: true; message: string }
  | { ok: false; status: 400 | 422; message: string };

export async function runAccountIntentForShop(
  shop: Pick<Shop, "id">,
  form: FormData,
  now: Date = new Date(),
): Promise<AccountIntentResult> {
  const parsed = AccountIntent.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, status: 400, message: "That request isn't valid." };
  const intent = parsed.data;
  const billing = await ensureBillingForShop(shop.id, now);
  const saved = parseBillEmails(billing.billEmails);

  if (intent.intent === "add-email") {
    const checked = checkNewBillEmail(saved, intent.email);
    if (!checked.ok) return { ok: false, status: 422, message: checked.message };
    await prisma.shopBilling.update({
      where: { id: billing.id },
      data: { billEmails: [...saved, checked.email] },
    });
    return { ok: true, message: `Saved. Bills and alerts also go to ${checked.email}.` };
  }

  if (intent.intent === "remove-email") {
    await prisma.shopBilling.update({
      where: { id: billing.id },
      data: { billEmails: saved.filter((email) => email !== intent.email) },
    });
    return { ok: true, message: `${intent.email} removed.` };
  }

  const on = intent.on === "true";
  await prisma.shopBilling.update({
    where: { id: billing.id },
    data: { [SWITCH_COLUMN[intent.key]]: on },
  });
  return { ok: true, message: on ? "Turned on." : "Turned off." };
}
