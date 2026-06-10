import { describe, expect, it } from "vitest";
import { createRateLimiter, clientIp } from "./rateLimiters";

const MIN = 60_000;

describe("createRateLimiter", () => {
  it("allows up to the limit, blocks the next, and recovers after the window", () => {
    const rl = createRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rl.allow("k", 3, MIN, t0 + i * 100).ok).toBe(true);
    }
    const blocked = rl.allow("k", 3, MIN, t0 + 500);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterS).toBeGreaterThanOrEqual(59);
    // Past the window the oldest stamps expire and requests flow again.
    expect(rl.allow("k", 3, MIN, t0 + MIN + 200).ok).toBe(true);
  });

  it("keys are independent", () => {
    const rl = createRateLimiter();
    expect(rl.allow("a", 1, MIN, 0).ok).toBe(true);
    expect(rl.allow("a", 1, MIN, 1).ok).toBe(false);
    expect(rl.allow("b", 1, MIN, 1).ok).toBe(true);
  });

  it("sweeps dead keys so the map doesn't grow unbounded", () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 50; i++) rl.allow(`ip-${i}`, 10, MIN, 1_000);
    expect(rl.size()).toBe(50);
    // > sweep interval AND > horizon later, a single call triggers eviction.
    rl.allow("fresh", 10, MIN, 1_000 + 11 * 60_000);
    expect(rl.size()).toBeLessThanOrEqual(2); // fresh (+ at most the touched key)
  });
});

describe("clientIp", () => {
  it("prefers Fly-Client-IP, falls back to first XFF hop, then unknown", () => {
    expect(
      clientIp(new Request("https://x/", { headers: { "fly-client-ip": "1.2.3.4" } })),
    ).toBe("1.2.3.4");
    expect(
      clientIp(
        new Request("https://x/", { headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" } }),
      ),
    ).toBe("5.6.7.8");
    expect(clientIp(new Request("https://x/"))).toBe("unknown");
  });
});
