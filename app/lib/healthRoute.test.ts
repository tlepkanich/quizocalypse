import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { loader as healthLoader } from "../routes/health";

// BIC-2 A1 — /health contract (the Fly http-check target). Mocked-prisma
// pattern per publicWriteGuards.test.ts; the test lives in app/lib because
// Remix's Vite plugin treats every app/routes/* file as a ROUTE.
vi.mock("../db.server", () => ({
  default: { $queryRaw: vi.fn() },
}));

const p = prisma as unknown as { $queryRaw: Mock };

beforeEach(() => {
  vi.clearAllMocks();
  // Silence the route's structured failure log in test output.
  vi.spyOn(process.stdout, "write").mockImplementation((() => true) as typeof process.stdout.write);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("/health loader", () => {
  it("200 {ok:true} + no-store when the DB ping succeeds", async () => {
    p.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    const res = await healthLoader();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("503 {ok:false} when the DB ping throws", async () => {
    p.$queryRaw.mockRejectedValue(new Error("db down"));
    const res = await healthLoader();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("503 when the DB ping hangs past the bounded timeout (never a hung check)", async () => {
    vi.useFakeTimers();
    p.$queryRaw.mockReturnValue(new Promise(() => {})); // never settles
    const pending = healthLoader();
    await vi.advanceTimersByTimeAsync(4001);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false });
  });
});
