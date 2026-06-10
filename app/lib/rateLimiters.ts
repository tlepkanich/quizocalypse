// In-memory sliding-window rate limiting for the public storefront endpoints
// (best-in-class P1). The app runs on a single always-on Fly machine, so a
// process-local Map is sufficient — no Redis. Limits are per-IP per-route and
// deliberately NAT-generous (a conference booth on shared wifi must not trip
// them; see the route mounts for the numbers). The core is pure (clock
// injected) so the window math is unit-testable.

export interface AllowResult {
  ok: boolean;
  /** Seconds until the oldest in-window stamp expires (≥1 when blocked). */
  retryAfterS: number;
}

export function createRateLimiter() {
  const windows = new Map<string, number[]>();
  let lastSweep = 0;
  // Sweep horizon: anything older than this is dead for every configured
  // window. Keeps the Map from growing unbounded across IP churn.
  const SWEEP_EVERY_MS = 5 * 60_000;
  const SWEEP_HORIZON_MS = 10 * 60_000;

  return {
    allow(key: string, limit: number, windowMs: number, now: number): AllowResult {
      if (now - lastSweep > SWEEP_EVERY_MS) {
        for (const [k, stamps] of windows) {
          const live = stamps.filter((t) => now - t < SWEEP_HORIZON_MS);
          if (live.length === 0) windows.delete(k);
          else windows.set(k, live);
        }
        lastSweep = now;
      }
      const stamps = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
      if (stamps.length >= limit) {
        const oldest = stamps[0] ?? now;
        windows.set(key, stamps);
        return {
          ok: false,
          retryAfterS: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
        };
      }
      stamps.push(now);
      windows.set(key, stamps);
      return { ok: true, retryAfterS: 0 };
    },
    /** Number of live keys (test/diagnostic). */
    size(): number {
      return windows.size;
    },
  };
}

const globalLimiter = createRateLimiter();

/** Client IP behind Fly's proxy: Fly-Client-IP, else first X-Forwarded-For hop. */
export function clientIp(request: Request): string {
  return (
    request.headers.get("fly-client-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

/**
 * Per-IP per-route check against the process-global limiter. Counts REQUESTS
 * (the events route already caps 50 events per request via zod).
 */
export function rateLimit(
  request: Request,
  route: string,
  limit: number,
  windowMs = 60_000,
): AllowResult {
  return globalLimiter.allow(`${route}:${clientIp(request)}`, limit, windowMs, Date.now());
}
