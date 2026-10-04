import { fmtNum, fmtUsd } from "./creditMath";

// Account & Billing — what the three bill emails say (BILLING-HANDOFF.md,
// "Emails"). Pure: the server modules gather the facts and send. The
// templates are not designed yet (handoff, site-wide work), so these are
// plain paragraphs, like the app's other emails.

export interface BillEmailContent {
  subject: string;
  text: string;
  html: string;
}

/** Links into the app. Null when the server has no public URL configured —
    the email then names the page in words. */
export interface BillEmailLinks {
  account: string | null;
  changePlan: string | null;
}

export interface AlertFacts {
  shopDomain: string;
  used: number;
  available: number;
  left: number;
  /** used ÷ available. */
  share: number;
  /** USD cents for one extra credit on the shop's plan. */
  extraCreditCents: number;
  /** "Oct 18" — the cycle's last day. */
  lastDay: string;
  links: BillEmailLinks;
}

export interface ReceiptFacts {
  shopDomain: string;
  /** "Oct 19, 2026" */
  billDate: string;
  planName: string;
  /** The plan, added credits and extra credits, each with its price. */
  lines: { label: string; cents: number }[];
  totalCents: number;
  creditsAvailable: number;
  creditsUsed: number;
  creditsOver: number;
  /** The Shopify admin's billing page; null for a shop Shopify can't bill. */
  shopifyBillingUrl: string | null;
  links: BillEmailLinks;
}

/** One paragraph: its words, and an optional link shown after them. */
interface Paragraph {
  words: string;
  link?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphText({ words, link }: Paragraph): string {
  return link ? `${words} ${link}` : words;
}

function paragraphHtml({ words, link }: Paragraph): string {
  const safeWords = escapeHtml(words).replace(/\n/g, "<br>");
  if (!link) return `<p>${safeWords}</p>`;
  return `<p>${safeWords} <a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`;
}

function compose(subject: string, paragraphs: Paragraph[]): BillEmailContent {
  return {
    subject,
    text: paragraphs.map(paragraphText).join("\n\n"),
    html: paragraphs.map(paragraphHtml).join(""),
  };
}

function getMoreCredits(links: BillEmailLinks): Paragraph {
  return links.changePlan
    ? { words: "Get more credits:", link: links.changePlan }
    : { words: "To get more credits, open Account in Wiskr and select Change plan." };
}

function whyYouGetThis(links: BillEmailLinks): Paragraph {
  const why = "You get this email because this address is saved under Bill emails in Wiskr.";
  return links.account
    ? { words: `${why} To change that, open Account:`, link: links.account }
    : { words: `${why} To change that, open Account in Wiskr.` };
}

/** The 80% alert: credits used and left, the price of an extra credit, and
    the way to Change plan. */
export function nearAlertEmail(facts: AlertFacts): BillEmailContent {
  const percent = Math.round(facts.share * 100);
  return compose(`${percent}% of this cycle’s credits are used`, [
    { words: `${percent}% of this cycle’s credits are used.` },
    {
      words: [
        `Store: ${facts.shopDomain}`,
        `Used: ${fmtNum(facts.used)} of ${fmtNum(facts.available)} credits`,
        `Left: ${fmtNum(facts.left)} credits`,
        `This cycle ends on ${facts.lastDay}.`,
      ].join("\n"),
    },
    {
      words: `When they run out your quizzes keep running, and each extra credit is ${fmtUsd(facts.extraCreditCents)}.`,
    },
    getMoreCredits(facts.links),
    whyYouGetThis(facts.links),
  ]);
}

/** The run-out alert: quizzes keep running, the price of an extra credit, and
    the way to Change plan. */
export function outAlertEmail(facts: AlertFacts): BillEmailContent {
  return compose("This cycle’s credits are used up", [
    { words: `All ${fmtNum(facts.available)} of this cycle’s credits are used. Your quizzes are still running.` },
    { words: [`Store: ${facts.shopDomain}`, `This cycle ends on ${facts.lastDay}.`].join("\n") },
    { words: `Each extra credit is ${fmtUsd(facts.extraCreditCents)}.` },
    getMoreCredits(facts.links),
    whyYouGetThis(facts.links),
  ]);
}

/** The receipt for one bill: the plan and its price, added credits, credits
    available and used, extra credits as their own line, the total before tax,
    and where the tax invoice is. */
export function receiptEmail(facts: ReceiptFacts): BillEmailContent {
  const credits = [
    `Credits available: ${fmtNum(facts.creditsAvailable)}`,
    `Credits used: ${fmtNum(facts.creditsUsed)}`,
  ];
  if (facts.creditsOver > 0) credits.push(`Extra credits: ${fmtNum(facts.creditsOver)}`);
  return compose(`Your Wiskr receipt for ${facts.billDate}`, [
    { words: `Your Wiskr receipt for ${facts.billDate}.` },
    { words: [`Store: ${facts.shopDomain}`, `Plan: ${facts.planName}`].join("\n") },
    {
      words: [
        ...facts.lines.map((line) => `${line.label}: ${fmtUsd(line.cents)}`),
        `Total before tax: ${fmtUsd(facts.totalCents)}`,
      ].join("\n"),
    },
    { words: credits.join("\n") },
    facts.shopifyBillingUrl
      ? { words: "Your tax invoice is in Shopify:", link: facts.shopifyBillingUrl }
      : { words: "Your tax invoice is in your Shopify admin, under Settings, then Billing." },
    whyYouGetThis(facts.links),
  ]);
}
