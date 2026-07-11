// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, createElement } from "react";
import { SocialProofLine, ShareRow, ScarcityBadge } from "./ResultExtras";
import { FeedbackWidget } from "./FeedbackWidget";
import { RewardReveal } from "./RewardReveal";
import { ReferralShare } from "./ReferralShare";
import { ENGAGEMENT_DEFAULTS, resolveEngagement } from "../../../lib/engagementSchema";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(el: React.ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.replaceChildren();
});

const r = resolveEngagement();

describe("§L runtime widgets hide gracefully (ethics — never fabricate)", () => {
  it("SocialProofLine hides below the threshold, shows above", () => {
    expect(mount(createElement(SocialProofLine, { config: r.socialProof, matchedCount: 10 })).textContent).toBe("");
    const el = mount(createElement(SocialProofLine, { config: r.socialProof, matchedCount: 2340 }));
    expect(el.textContent).toContain("2,340");
  });

  it("ScarcityBadge hides when stock is high or unknown, shows when low + real", () => {
    const on = { ...r.urgency, lowStock: true, lowStockThreshold: 5 };
    expect(mount(createElement(ScarcityBadge, { config: on, remaining: 20 })).textContent).toBe("");
    expect(mount(createElement(ScarcityBadge, { config: on, remaining: null })).textContent).toBe("");
    expect(mount(createElement(ScarcityBadge, { config: on, remaining: 3 })).textContent).toContain("Only 3 left");
    // off by default → hidden even when low
    expect(mount(createElement(ScarcityBadge, { config: r.urgency, remaining: 3 })).textContent).toBe("");
  });

  it("ShareRow hides when disabled", () => {
    expect(mount(createElement(ShareRow, { config: { ...r.share, enabled: false }, shareUrl: "x" })).textContent).toBe("");
    expect(mount(createElement(ShareRow, { config: r.share, shareUrl: "x" })).querySelectorAll("button").length).toBeGreaterThan(0);
  });

  it("FeedbackWidget renders the prompt + thumbs, then a thank-you after submit", () => {
    const el = mount(createElement(FeedbackWidget, { config: r.feedback, quizId: "q", sessionId: "s" }));
    expect(el.textContent).toContain(ENGAGEMENT_DEFAULTS.feedback.prompt);
    const btn = el.querySelector("button")!;
    act(() => btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(el.textContent).toContain("Thanks");
  });

  it("RewardReveal shows the email gate + a disabled reveal button until a valid email (emailGated default)", () => {
    const el = mount(createElement(RewardReveal, { config: r.reward, quizId: "q", sessionId: "s" }));
    expect(el.querySelector('input[type="email"]')).toBeTruthy();
    const btn = el.querySelector("button.qz-reward-btn") as HTMLButtonElement;
    expect(btn.textContent).toContain("Reveal");
    expect(btn.disabled).toBe(true); // no email yet
  });

  it("RewardReveal without email gating shows no email input", () => {
    const el = mount(createElement(RewardReveal, { config: { ...r.reward, emailGated: false }, quizId: "q", sessionId: "s" }));
    expect(el.querySelector('input[type="email"]')).toBeNull();
    expect((el.querySelector("button.qz-reward-btn") as HTMLButtonElement).disabled).toBe(false);
  });

  it("RewardReveal shows the fallback message (not a blank block) when the reward is exhausted (§10/F5)", async () => {
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () =>
      new Response(JSON.stringify({ reward: null, reason: "exhausted" }), {
        headers: { "content-type": "application/json" },
      });
    try {
      const el = mount(
        createElement(RewardReveal, {
          config: { ...r.reward, emailGated: false, fallbackText: "All prizes claimed — thanks!" },
          quizId: "q",
          sessionId: "s",
        }),
      );
      const btn = el.querySelector("button.qz-reward-btn") as HTMLButtonElement;
      await act(async () => {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(el.textContent).toContain("All prizes claimed");
      // the reveal button is gone — the shopper isn't left with a dead button
      expect(el.querySelector("button.qz-reward-btn")).toBeNull();
    } finally {
      (globalThis as Record<string, unknown>).fetch = orig;
    }
  });

  it("RewardReveal exhausted state uses a sensible default when no fallbackText is set", async () => {
    const orig = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async () =>
      new Response(JSON.stringify({ reward: null, reason: "exhausted" }), {
        headers: { "content-type": "application/json" },
      });
    try {
      const el = mount(
        createElement(RewardReveal, { config: { ...r.reward, emailGated: false }, quizId: "q", sessionId: "s" }),
      );
      const btn = el.querySelector("button.qz-reward-btn") as HTMLButtonElement;
      await act(async () => {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(el.textContent).toContain("fully claimed");
    } finally {
      (globalThis as Record<string, unknown>).fetch = orig;
    }
  });

  it("ReferralShare (preview) renders the give-get offer + example link, no fetch", () => {
    const cfg = { ...r.referral, getType: "percentage", getValue: 15 } as typeof r.referral;
    const el = mount(createElement(ReferralShare, { config: cfg, quizId: "q123", sessionId: "s", preview: true }));
    expect(el.textContent).toContain("15% off");
    const link = el.querySelector(".qz-referral-link") as HTMLInputElement;
    expect(link.value).toContain("/q/q123?ref=EXAMPLE");
  });
});
