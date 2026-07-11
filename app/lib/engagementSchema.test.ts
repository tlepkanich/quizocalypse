import { describe, it, expect } from "vitest";
import { EngagementSettings, ENGAGEMENT_DEFAULTS, resolveEngagement } from "./engagementSchema";

describe("§L engagement settings", () => {
  it("defaults: tasteful mechanics ON, loud ones OFF", () => {
    const r = resolveEngagement();
    expect(r.interstitial.enabled).toBe(true);
    expect(r.feedback.enabled).toBe(true);
    expect(r.share.enabled).toBe(true);
    expect(r.reward.enabled).toBe(false); // loud
    expect(r.urgency.lowStock).toBe(false); // real-only, off by default
    expect(r.interstitial.style).toBe("stepped");
  });

  it("precedence: quiz override > account default > read-time default", () => {
    const account = { interstitial: { delayMs: 3000 }, reward: { enabled: true } };
    const quiz = { interstitial: { delayMs: 1500 } };
    const r = resolveEngagement(quiz, account);
    expect(r.interstitial.delayMs).toBe(1500); // quiz wins
    expect(r.reward.enabled).toBe(true); // account default applied
    expect(r.interstitial.headline).toBe(ENGAGEMENT_DEFAULTS.interstitial.headline); // inherited
  });

  it("an absent override key never shadows a lower layer", () => {
    const r = resolveEngagement({ interstitial: { enabled: false } }, { interstitial: { delayMs: 3200 } });
    expect(r.interstitial.enabled).toBe(false); // quiz
    expect(r.interstitial.delayMs).toBe(3200); // account (quiz didn't set it)
  });

  it("schema is all-optional (a legacy/empty doc parses to {})", () => {
    expect(EngagementSettings.parse({})).toEqual({});
    expect(EngagementSettings.safeParse({ reward: { type: "nope" } }).success).toBe(false);
  });
});
