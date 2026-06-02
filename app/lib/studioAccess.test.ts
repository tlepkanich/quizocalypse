import { describe, it, expect } from "vitest";
import { safeEqual } from "./studioAccess.server";

// The constant-time compare backs the standalone /studio access gate's ?key=
// check. We can't unit-test the cookie/redirect flow without a live Request,
// but this guards the comparison logic (the security-sensitive part).
describe("safeEqual", () => {
  it("returns true for identical strings", () => {
    expect(safeEqual("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(safeEqual("abcdef", "abcxyz")).toBe(false);
  });

  it("returns false for different lengths (no throw)", () => {
    expect(safeEqual("short", "a-much-longer-token")).toBe(false);
  });

  it("returns false when one side is empty", () => {
    expect(safeEqual("", "token")).toBe(false);
  });

  it("handles unicode without throwing", () => {
    expect(safeEqual("kéy-✓", "kéy-✓")).toBe(true);
    expect(safeEqual("kéy-✓", "key-x")).toBe(false);
  });
});
