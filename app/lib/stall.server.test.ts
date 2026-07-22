import { describe, expect, it } from "vitest";
import {
  DETACHED_JOB_STALL_MS,
  isDetachedJobStalled,
  resolveIdentityBuildState,
} from "./stall.server";

describe("detached-job stall rule (ai-fallbacks Gap 6)", () => {
  const now = new Date("2026-07-22T12:00:00Z").getTime();

  it("a fresh write is not stalled", () => {
    expect(isDetachedJobStalled(new Date(now - 5_000), now)).toBe(false);
  });

  it("a write just inside the threshold is not stalled; just past it is", () => {
    expect(isDetachedJobStalled(new Date(now - DETACHED_JOB_STALL_MS + 1_000), now)).toBe(false);
    expect(isDetachedJobStalled(new Date(now - DETACHED_JOB_STALL_MS - 1_000), now)).toBe(true);
  });

  it("accepts ISO strings and never stalls on an unparseable timestamp", () => {
    expect(isDetachedJobStalled(new Date(now - 300_000).toISOString(), now)).toBe(true);
    expect(isDetachedJobStalled("not-a-date", now)).toBe(false);
  });
});

describe("brand-identity build state resolver", () => {
  const now = new Date("2026-07-22T12:00:00Z").getTime();

  it("passes through null and error states untouched", () => {
    expect(resolveIdentityBuildState(null, now)).toEqual({ state: null, stalled: false });
    expect(resolveIdentityBuildState("error:boom", now)).toEqual({
      state: "error:boom",
      stalled: false,
    });
  });

  it("normalizes a stamped fresh build to a non-stalled building", () => {
    const raw = `building:${new Date(now - 10_000).toISOString()}`;
    expect(resolveIdentityBuildState(raw, now)).toEqual({ state: "building", stalled: false });
  });

  it("stalls a stamped build past the shared threshold", () => {
    const raw = `building:${new Date(now - 300_000).toISOString()}`;
    expect(resolveIdentityBuildState(raw, now)).toEqual({ state: "building", stalled: true });
  });

  it("treats a bare legacy building (and garbage stamps) as stalled — pre-deploy jobs are dead", () => {
    expect(resolveIdentityBuildState("building", now)).toEqual({ state: "building", stalled: true });
    expect(resolveIdentityBuildState("building:garbage", now)).toEqual({
      state: "building",
      stalled: true,
    });
  });
});
