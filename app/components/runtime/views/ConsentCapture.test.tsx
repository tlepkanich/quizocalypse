// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { DeciderCaptureView } from "./DeciderViews";
import { InlineDeciderCapture } from "./InlineDeciderCapture";
import { ConsentNotice, policyHref } from "./ConsentNotice";
import { resolveRecPageGlobal } from "../../../lib/recommendDecider";
import { resolveDesignTokens } from "../../../lib/designTokens";
import type { RecPageGlobal } from "../../../lib/quizSchema";
import { stylesFor } from "../runtimeStyles";
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  vi.unstubAllGlobals();
});
const styles = stylesFor(resolveDesignTokens());
const config = (global: RecPageGlobal) =>
  resolveRecPageGlobal({ global, overrides: {} });
function mount(global: RecPageGlobal, inline = false) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const props = {
    config: config(global),
    styles,
    quizId: "capture",
    sessionId: "session",
    shopDomain: "shop.example",
    onDone: vi.fn(),
  };
  act(() =>
    root!.render(
      inline
        ? createElement(InlineDeciderCapture, props)
        : createElement(DeciderCaptureView, props),
    ),
  );
  return props.onDone;
}
function input(type: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function submit() {
  const button = document.querySelector<HTMLButtonElement>("button")!;
  return act(async () => {
    button.click();
    await Promise.resolve();
  });
}
describe("consent evidence and inline capture", () => {
  it("checkbox consent gates the submit and records the exact displayed text", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    mount({ captureTermsOn: true, captureTermsText: "I accept these terms." });
    input("email", "shopper@example.com");
    expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    act(() =>
      document
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await submit();
    const body = JSON.parse(fetcher.mock.calls[0]![1].body as string);
    expect(body.consent.terms).toEqual({
      mode: "checkbox",
      checked: true,
      text: "I accept these terms.",
    });
    expect(body.marketing_consent).toBeUndefined();
  });
  it("notice mode has no required checkbox and never records an affirmative tick", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    mount({
      captureTermsOn: true,
      captureTermsMode: "notice",
      captureTermsText: "Please read our policy.",
    });
    input("email", "shopper@example.com");
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    await submit();
    expect(
      JSON.parse(fetcher.mock.calls[0]![1].body as string).consent.terms
        .checked,
    ).toBe(false);
  });
  it("SMS opt-in is independent and only required when a phone number is supplied", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    mount({
      capturePhone: true,
      smsConsentMode: "checkbox",
      smsConsentText: "Text me offers.",
    });
    input("email", "shopper@example.com");
    input("tel", "12345");
    expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      true,
    );
    act(() =>
      document
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await submit();
    expect(
      JSON.parse(fetcher.mock.calls[0]![1].body as string).consent.sms,
    ).toEqual({ mode: "checkbox", checked: true, text: "Text me offers." });
  });
  it("inline capture reports a failed save and remains retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 500 })),
    );
    mount({}, true);
    input("email", "shopper@example.com");
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "couldn’t save",
    );
    expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(
      false,
    );
    expect(document.body.textContent).not.toContain(
      "Your details have been saved.",
    );
  });
  it("notice links resolve against the shop and reject executable URLs", () => {
    expect(policyHref("/policies/terms", "shop.example")).toBe(
      "https://shop.example/policies/terms",
    );
    // An executable policy URL must never become a link.
    // eslint-disable-next-line no-script-url
    expect(policyHref("javascript:alert(1)", "shop.example")).toBeUndefined();
    const html = renderToStaticMarkup(
      <ConsentNotice
        config={config({
          captureTermsText: "Read {terms} and {privacy}.",
          termsUrl: "/terms",
          termsLabel: "Our terms",
        })}
        shopDomain="shop.example"
      />,
    );
    expect(html).toContain('href="https://shop.example/terms"');
    expect(html).toContain("Our terms");
    expect(html).not.toContain("{privacy}");
  });
});

// Results handoff §9 — the fixed-wording form, gated on consentVersion.
describe("fixed-wording consent form (consentVersion)", () => {
  const FIXED: RecPageGlobal = {
    consentVersion: "2026-09-17",
    consentOn: true,
    consentCopy: "Email me news and offers from Acme.",
    captureTermsOn: true,
    captureTermsMode: "notice",
    capturePhone: true,
    smsConsentMode: "checkbox",
    // A merchant's old custom sentence is ignored once the quiz moves over.
    captureTermsText: "OLD {terms} SENTENCE",
  };

  it("renders marketing box, then the legal lines, then the button — no phone until an SMS destination exists", () => {
    mount(FIXED);
    const text = host.textContent ?? "";
    expect(text).toContain("Email me news and offers from Acme.");
    expect(text).toContain(
      "By continuing, you agree to our Terms & Conditions and acknowledge our Privacy Policy.",
    );
    expect(text).toContain("You can unsubscribe from our emails at any time.");
    expect(text).not.toContain("OLD");
    expect(text).not.toContain("{terms}");
    expect(document.querySelector('input[type="tel"]')).toBeNull();
    expect(text).not.toContain("Text me offers");
    // Order: checkbox, legal text, then the button.
    const order = [...host.querySelectorAll("[data-qz-consent], button")].map(
      (el) => el.getAttribute("data-qz-consent") ?? "button",
    );
    expect(order.slice(0, 3)).toEqual(["marketing", "legal", "button"]);
    // Links default to the store's policy pages, resolved on the STORE's domain.
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "https://shop.example/policies/terms-of-service",
      "https://shop.example/policies/privacy-policy",
    ]);
  });

  it("marketing never blocks submit; the evidence records version, links and the box's text", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetcher);
    const onDone = mount(FIXED);
    input("email", "shopper@example.com");
    expect(document.querySelector<HTMLButtonElement>("button")?.disabled).toBe(false);
    await submit();
    const body = JSON.parse(fetcher.mock.calls[0]![1].body as string);
    expect(body.marketing_consent).toBe(false);
    expect(body).not.toHaveProperty("phone");
    expect(body.consent).toEqual({
      version: "2026-09-17",
      placement: "gate",
      links: {
        terms: "https://shop.example/policies/terms-of-service",
        privacy: "https://shop.example/policies/privacy-policy",
      },
      marketing: { checked: false, text: "Email me news and offers from Acme." },
      terms: {
        mode: "notice",
        checked: false,
        text: "By continuing, you agree to our Terms & Conditions and acknowledge our Privacy Policy.",
      },
    });
    expect(onDone).toHaveBeenCalled();
  });

  it("a terms box is the only thing that blocks submit, and it renders last", () => {
    mount({ ...FIXED, captureTermsMode: "checkbox" });
    input("email", "shopper@example.com");
    const button = document.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(true);
    const boxes = [...host.querySelectorAll("label[data-qz-consent]")].map((l) =>
      l.getAttribute("data-qz-consent"),
    );
    expect(boxes).toEqual(["marketing", "terms"]);
    expect(host.textContent).toContain("I agree to the Terms & Conditions and acknowledge the Privacy Policy.");
    act(() =>
      host.querySelector<HTMLInputElement>('label[data-qz-consent="terms"] input')!.click(),
    );
    expect(button.disabled).toBe(false);
  });

  it("refuses javascript: and http: links, and never renders them as hrefs", () => {
    // eslint-disable-next-line no-script-url
    mount({ ...FIXED, termsUrl: "javascript:alert(1)", privacyUrl: "http://plain.example/p" });
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toContain("Terms & Conditions");
  });
});

describe("policyHref (tightened)", () => {
  it("accepts https and store paths only", () => {
    expect(policyHref("https://x.example/terms", "shop.example")).toBe("https://x.example/terms");
    expect(policyHref("http://x.example/terms", "shop.example")).toBeUndefined();
    expect(policyHref("//evil.example/x", "shop.example")).toBeUndefined();
    expect(policyHref("evil.example/x", "shop.example")).toBeUndefined();
  });
});
