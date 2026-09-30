import { describe, expect, it } from "vitest";
import {
  TERMS_LINE,
  checkPolicyLink,
  resolvePolicyLinks,
  smsSmallPrint,
  unsubscribeLine,
  wordingText,
} from "./consentWording";

describe("consentWording (results handoff §9)", () => {
  it("fills the store name, and falls back to 'us' wording without one", () => {
    expect(unsubscribeLine("Acme")).toBe("You can unsubscribe from Acme emails at any time.");
    expect(unsubscribeLine(undefined)).toBe("You can unsubscribe from our emails at any time.");
    expect(smsSmallPrint("Acme")).toContain("marketing texts from Acme at the number provided");
    expect(smsSmallPrint("Acme")).toContain("Reply HELP for help, STOP to cancel.");
  });

  it("renders a sentence's links as the merchant's labels", () => {
    expect(wordingText(TERMS_LINE, { terms: "Terms", privacy: "Privacy" })).toBe(
      "By continuing, you agree to our Terms and acknowledge our Privacy.",
    );
  });

  it("checks links: store paths resolve on the store, https only, everything else refused", () => {
    expect(checkPolicyLink("/policies/refund-policy", "acme.myshopify.com")).toEqual({
      ok: true,
      href: "https://acme.myshopify.com/policies/refund-policy",
      onStore: true,
    });
    expect(checkPolicyLink("https://acme.com/terms", "acme.myshopify.com")).toMatchObject({
      ok: true,
      onStore: false,
    });
    // eslint-disable-next-line no-script-url
    for (const bad of ["javascript:alert(1)", "http://acme.com/t", "acme.com/terms", "//acme.com/t"]) {
      expect(checkPolicyLink(bad, "acme.myshopify.com").ok).toBe(false);
    }
    expect(checkPolicyLink("  ", "acme.myshopify.com")).toMatchObject({ ok: false, empty: true });
  });

  it("falls back to the store's default policy pages when a link key is absent", () => {
    expect(resolvePolicyLinks({}, "acme.myshopify.com")).toEqual({
      terms: "https://acme.myshopify.com/policies/terms-of-service",
      privacy: "https://acme.myshopify.com/policies/privacy-policy",
    });
  });
});
