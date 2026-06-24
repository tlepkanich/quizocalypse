import { describe, it, expect } from "vitest";
import { formatMoney } from "./formatMoney";

describe("formatMoney", () => {
  it("formats USD with two decimals and grouping", () => {
    expect(formatMoney("886", "USD", "en")).toBe("$886.00");
    expect(formatMoney(1234.5, "USD", "en")).toBe("$1,234.50");
  });

  it("formats a zero-decimal currency (JPY) with no fraction digits", () => {
    // The whole point of the fix: ¥886 must NOT render as "$886" or "¥886.00".
    expect(formatMoney(886, "JPY", "en")).toBe("¥886");
    expect(formatMoney("886", "JPY", "en")).toBe("¥886");
  });

  it("falls back to USD when no currency is given (pre-existing quizzes)", () => {
    expect(formatMoney("886", undefined, "en")).toBe("$886.00");
    expect(formatMoney("886", null, "en")).toBe("$886.00");
    expect(formatMoney("886", "", "en")).toBe(formatMoney("886", "USD", "en"));
  });

  it("falls back to USD on a malformed currency code instead of throwing", () => {
    // A code that isn't three ASCII letters makes Intl throw a RangeError; the
    // formatter must swallow it and render dollars rather than crash the page.
    expect(formatMoney(5, "BADCODE", "en")).toBe(formatMoney(5, "USD", "en"));
  });

  it("returns empty string for missing or non-numeric amounts", () => {
    expect(formatMoney(null, "JPY", "en")).toBe("");
    expect(formatMoney(undefined, "JPY", "en")).toBe("");
    expect(formatMoney("", "JPY", "en")).toBe("");
    expect(formatMoney("not-a-number", "JPY", "en")).toBe("");
  });
});
