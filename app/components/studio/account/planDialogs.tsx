import type { ReactNode } from "react";
import type { AccountData } from "../../../lib/billing/account.server";
import { isUpgrade, type SelfServePlan } from "../../../lib/billing/catalog";
import {
  creditsCents,
  fmtNum,
  fmtUsd,
  proRataCents,
  type CreditFigures,
} from "../../../lib/billing/creditMath";

// Change plan — what each confirm dialog says (BILLING-HANDOFF.md, "Dialogs
// and messages"). Strings are the mock's, used as written. Every dialog
// opens from a click; an action that goes to Shopify says "Continue in
// Shopify", and a destructive confirm is red.

export interface ConfirmSpec {
  title: string;
  lead: string;
  rows?: { label: string; value: ReactNode }[];
  list?: string[];
  /** The quiet button on the left. */
  no: string;
  /** The action on the right. Default: "Continue in Shopify". */
  yes?: string;
  destructive?: boolean;
}

/** "old → new", the old value quiet. */
function change(from: string, to: string): ReactNode {
  return (
    <>
      <s>{from}</s> → {to}
    </>
  );
}

interface DialogContext {
  data: AccountData;
  plan: SelfServePlan;
  figures: CreditFigures;
}

export function changePlanDialog({ data, plan }: DialogContext, target: SelfServePlan): ConfirmSpec {
  const { dates, inTrial } = data;
  const upgrade = isUpgrade(plan.key, target.key);
  const rows = [
    { label: "Price", value: change(`$${plan.price}`, `$${target.price} a month`) },
    { label: "Credits each cycle", value: change(fmtNum(plan.credits), fmtNum(target.credits)) },
    {
      label: "More credits",
      value: change(fmtUsd(creditsCents(1, plan.rate)), `${fmtUsd(creditsCents(1, target.rate))} each`),
    },
  ];
  if (inTrial) {
    rows.push(
      { label: "Starts", value: "Today, still in your free trial" },
      { label: "First bill", value: `${fmtUsd(target.price * 100)} on ${dates.billDate}` },
    );
  } else if (upgrade) {
    const difference = (target.price - plan.price) * 100;
    rows.push(
      { label: "Starts", value: "Today" },
      { label: "You pay today", value: `About ${fmtUsd(proRataCents(difference, dates.daysLeft))}` },
    );
  } else {
    rows.push(
      { label: "Starts", value: `${dates.billDate}, your next bill date` },
      { label: "Until then", value: `You keep ${plan.name}` },
    );
  }

  if (upgrade) {
    return {
      title: `Upgrade to ${target.name}?`,
      lead: inTrial
        ? "You get the bigger plan right away."
        : `You get the extra credits right away. Today’s charge covers the ${dates.daysLeft} days left in this cycle.`,
      rows,
      no: "Not now",
    };
  }
  return {
    title: `Downgrade to ${target.name}?`,
    lead: `From ${inTrial ? "today" : dates.billDate} this is what changes:`,
    rows,
    // What the lower plan loses is a placeholder (handoff decision 6).
    list: [
      "Only 2 quizzes can be live. You pick which ones.",
      "A/B tests stop and custom CSS is removed.",
      "Credits you already have stay yours until they expire.",
    ],
    no: `Keep ${plan.name}`,
  };
}

export function buyCreditsDialog({ plan }: DialogContext, amount: number): ConfirmSpec {
  return {
    title: `Buy ${fmtNum(amount)} credits?`,
    lead: "A one-time top-up. Your plan stays the same.",
    rows: [
      { label: "Credits", value: `+${fmtNum(amount)} today` },
      { label: "Price", value: `${fmtUsd(creditsCents(amount, plan.rate))}, charged once` },
      { label: "On your bill", value: "Its own line on your Shopify bill" },
    ],
    no: "Not now",
  };
}

export function addEveryCycleDialog({ data, plan, figures }: DialogContext, amount: number): ConfirmSpec {
  const cost = creditsCents(amount, plan.rate);
  const creditsNow = plan.credits + data.credits.everyCycle;
  return {
    title: `Add ${fmtNum(amount)} credits every cycle?`,
    lead: "They’re added today and on every bill after, until you remove them.",
    rows: [
      { label: "Credits each cycle", value: change(fmtNum(creditsNow), fmtNum(creditsNow + amount)) },
      {
        label: "Price",
        value: change(fmtUsd(figures.monthlyCents), `${fmtUsd(figures.monthlyCents + cost)} a month`),
      },
      { label: "You pay today", value: `About ${fmtUsd(proRataCents(cost, data.dates.daysLeft))}` },
    ],
    no: "Not now",
  };
}

export function removeEveryCycleDialog({ data, plan }: DialogContext): ConfirmSpec {
  return {
    title: `Remove the ${fmtNum(data.credits.everyCycle)} added credits?`,
    lead: `You keep them for this cycle. From ${data.dates.billDate} your plan goes back to ${fmtUsd(plan.price * 100)} a month.`,
    no: "Keep them",
    yes: "Remove",
    destructive: true,
  };
}

export function cancelDialog({ data, plan }: DialogContext): ConfirmSpec {
  const kept = "Your quizzes and results are kept, so you can pick a plan later.";
  if (data.inTrial) {
    return {
      title: "Cancel your free trial?",
      lead: "You won’t be billed. This is what happens:",
      list: ["Your quizzes come off your store today.", kept],
      no: "Keep trial",
      yes: "Cancel trial",
      destructive: true,
    };
  }
  return {
    title: `Cancel ${plan.name}?`,
    lead: "You won’t be billed again. This is what happens:",
    list: [
      `${plan.name} stays on until ${data.dates.lastDay}.`,
      "After that your quizzes come off your store.",
      "Extra credits used before then are on your last bill.",
      kept,
    ],
    no: `Keep ${plan.name}`,
    yes: "Cancel plan",
    destructive: true,
  };
}
