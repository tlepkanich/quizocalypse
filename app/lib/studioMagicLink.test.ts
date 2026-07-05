import { describe, it, expect, afterEach } from "vitest";
import {
  parseAllowlist,
  normalizeEmail,
  isEmailAllowed,
  canRequestLink,
} from "./studioMagicLink.server";

// Pure-function coverage for the magic-link allowlist. Token issue/consume
// touch the DB and are exercised by the live e2e probe instead.

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Tyler.Lepkanich@Gmail.com ")).toBe("tyler.lepkanich@gmail.com");
  });
});

describe("parseAllowlist", () => {
  it("returns [] for unset", () => {
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it("splits, trims, lowercases, and drops non-emails", () => {
    expect(parseAllowlist(" A@x.com, b@Y.com ,, not-an-email ")).toEqual(["a@x.com", "b@y.com"]);
  });
});

describe("isEmailAllowed", () => {
  afterEach(() => {
    delete process.env.STUDIO_ALLOWED_EMAILS;
  });

  it("matches case-insensitively against the env allowlist", () => {
    process.env.STUDIO_ALLOWED_EMAILS = "owner@example.com,bro@example.com";
    expect(isEmailAllowed("Owner@Example.COM")).toBe(true);
    expect(isEmailAllowed("bro@example.com")).toBe(true);
    expect(isEmailAllowed("stranger@example.com")).toBe(false);
  });

  it("denies everything when the allowlist is unset", () => {
    expect(isEmailAllowed("owner@example.com")).toBe(false);
  });
});

// Policy: 60s cooldown between links + max 5 per rolling hour, both silent.
describe("canRequestLink", () => {
  const now = new Date("2026-07-05T12:00:00Z");
  const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

  it("allows the first request", () => {
    expect(canRequestLink([], now)).toBe(true);
  });

  it("blocks a request within the 60s cooldown", () => {
    expect(canRequestLink([secondsAgo(10)], now)).toBe(false);
    expect(canRequestLink([secondsAgo(59)], now)).toBe(false);
  });

  it("allows a request once the cooldown has passed", () => {
    expect(canRequestLink([secondsAgo(61)], now)).toBe(true);
  });

  it("blocks the 6th request in an hour even outside the cooldown", () => {
    const five = [120, 300, 600, 1200, 2400].map(secondsAgo);
    expect(canRequestLink(five, now)).toBe(false);
  });

  it("allows a 5th request outside the cooldown", () => {
    const four = [120, 300, 600, 1200].map(secondsAgo);
    expect(canRequestLink(four, now)).toBe(true);
  });
});
