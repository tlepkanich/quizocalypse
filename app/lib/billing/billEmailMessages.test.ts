import { describe, expect, it } from "vitest";
import { nearAlertEmail, outAlertEmail, receiptEmail, type AlertFacts, type ReceiptFacts } from "./billEmailMessages";

const LINKS = {
  account: "https://app.example/studio/account",
  changePlan: "https://app.example/studio/account/plan",
};
const NO_LINKS = { account: null, changePlan: null };

const ALERT: AlertFacts = {
  shopDomain: "store.myshopify.com",
  used: 2000,
  available: 2380,
  left: 380,
  share: 2000 / 2380,
  extraCreditCents: 10,
  lastDay: "Oct 18",
  links: LINKS,
};

const RECEIPT: ReceiptFacts = {
  shopDomain: "store.myshopify.com",
  billDate: "Oct 19, 2026",
  planName: "Growth",
  lines: [
    { label: "Growth", cents: 20000 },
    { label: "180 credits added every cycle", cents: 1800 },
    { label: "131 extra credits", cents: 1310 },
  ],
  totalCents: 23110,
  creditsAvailable: 2380,
  creditsUsed: 2511,
  creditsOver: 131,
  shopifyBillingUrl: "https://admin.shopify.com/store/store/settings/billing",
  links: LINKS,
};

describe("nearAlertEmail", () => {
  it("says credits used and left, the price of an extra credit, and links to Change plan", () => {
    const email = nearAlertEmail(ALERT);
    expect(email.subject).toBe("84% of this cycle’s credits are used");
    expect(email.text).toContain("Used: 2,000 of 2,380 credits");
    expect(email.text).toContain("Left: 380 credits");
    expect(email.text).toContain("each extra credit is $0.10");
    expect(email.text).toContain("Get more credits: https://app.example/studio/account/plan");
    expect(email.text).toContain("Store: store.myshopify.com");
    expect(email.html).toContain('<a href="https://app.example/studio/account/plan">');
  });

  it("names the page in words when the app has no public URL configured", () => {
    const email = nearAlertEmail({ ...ALERT, links: NO_LINKS });
    expect(email.text).toContain("open Account in Wiskr and select Change plan");
    expect(email.text).not.toContain("http");
    expect(email.html).not.toContain("<a ");
  });
});

describe("outAlertEmail", () => {
  it("says quizzes keep running, the price of an extra credit, and links to Change plan", () => {
    const email = outAlertEmail({ ...ALERT, used: 2380, left: 0, share: 1 });
    expect(email.subject).toBe("This cycle’s credits are used up");
    expect(email.text).toContain("All 2,380 of this cycle’s credits are used. Your quizzes are still running.");
    expect(email.text).toContain("Each extra credit is $0.10.");
    expect(email.text).toContain("Get more credits: https://app.example/studio/account/plan");
  });
});

describe("receiptEmail", () => {
  it("lists the plan, added credits, extra credits as their own line, and the total before tax", () => {
    const email = receiptEmail(RECEIPT);
    expect(email.subject).toBe("Your Wiskr receipt for Oct 19, 2026");
    expect(email.text).toContain("Growth: $200.00");
    expect(email.text).toContain("180 credits added every cycle: $18.00");
    expect(email.text).toContain("131 extra credits: $13.10");
    expect(email.text).toContain("Total before tax: $231.10");
    expect(email.text).toContain("Credits available: 2,380");
    expect(email.text).toContain("Credits used: 2,511");
    expect(email.text).toContain("Extra credits: 131");
    expect(email.text).toContain("Your tax invoice is in Shopify: https://admin.shopify.com/store/store/settings/billing");
  });

  it("leaves out the extra-credits count when the shop was not over, and the link Shopify can't give", () => {
    const email = receiptEmail({ ...RECEIPT, creditsOver: 0, shopifyBillingUrl: null });
    expect(email.text).not.toContain("Extra credits:");
    expect(email.text).toContain("Your tax invoice is in your Shopify admin");
  });
});

describe("html", () => {
  it("escapes stored text, so a bill line or a domain can't inject markup", () => {
    const email = receiptEmail({
      ...RECEIPT,
      shopDomain: '<img src=x onerror="alert(1)">',
      lines: [{ label: "<script>alert(1)</script>", cents: 100 }],
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;");
  });
});
