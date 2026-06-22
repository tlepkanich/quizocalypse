import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime } from "./formatDate";

describe("formatDate", () => {
  it("formats an ISO string as M/D/YYYY in UTC", () => {
    expect(formatDate("2026-06-23T14:05:00.000Z")).toBe("6/23/2026");
  });
  it("uses UTC parts so server and client agree at a day boundary", () => {
    // 00:30Z on the 23rd is still the 22nd in the Americas; reading UTC parts
    // (not the local zone) is exactly what makes both render the same string.
    expect(formatDate("2026-06-23T00:30:00.000Z")).toBe("6/23/2026");
  });
  it("accepts a Date and an epoch number", () => {
    expect(formatDate(new Date("2026-01-05T00:00:00Z"))).toBe("1/5/2026");
    expect(formatDate(Date.UTC(2026, 11, 31))).toBe("12/31/2026");
  });
  it("returns empty string for null/undefined/invalid input", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("formats date + 12-hour time in UTC", () => {
    expect(formatDateTime("2026-06-23T14:05:00.000Z")).toBe("6/23/2026, 2:05 PM");
  });
  it("renders midnight and noon as 12 AM / 12 PM", () => {
    expect(formatDateTime("2026-06-23T00:00:00Z")).toBe("6/23/2026, 12:00 AM");
    expect(formatDateTime("2026-06-23T12:00:00Z")).toBe("6/23/2026, 12:00 PM");
  });
  it("zero-pads the minutes", () => {
    expect(formatDateTime("2026-06-23T09:07:00Z")).toBe("6/23/2026, 9:07 AM");
  });
  it("returns empty string for null input", () => {
    expect(formatDateTime(null)).toBe("");
  });
});
