import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it } from "vitest";
import { action as logoutAction, loader as logoutLoader } from "../routes/studio_.logout";
import { clearStudioCookies, grantStudioSession } from "./studioAccess.server";
import { logger } from "./log.server";

// BIC-2 A2(b) — studio session hardening: POST /studio/logout clears BOTH
// cookies (magic-link session + legacy break-glass token) and the session
// cookies are minted with a 7-day maxAge (was 30). Lives in app/lib per the
// publicWriteGuards precedent (route-dir test files break the Remix plugin).

function postArgs(): ActionFunctionArgs {
  const request = new Request("https://studio.example/studio/logout", { method: "POST" });
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

beforeEach(() => {
  logger.level = "silent"; // the sign-out audit line is intentional; keep test output clean
  process.env.STUDIO_SESSION_SECRET = "test-session-secret";
  process.env.STUDIO_ACCESS_TOKEN = "test-access-token";
});

describe("POST /studio/logout", () => {
  it("302s to /studio/login and expires BOTH studio cookies", async () => {
    const res = (await logoutAction(postArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/studio/login");
    const setCookies = res.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    const session = setCookies.find((c) => c.startsWith("qz_studio_session="));
    const legacy = setCookies.find((c) => c.startsWith("qz_studio="));
    expect(session).toBeTruthy();
    expect(legacy).toBeTruthy();
    expect(session).toContain("Max-Age=0");
    expect(legacy).toContain("Max-Age=0");
  });

  it("clears cookies even when the env secrets are missing (sign-out never 500s)", async () => {
    delete process.env.STUDIO_SESSION_SECRET;
    delete process.env.STUDIO_ACCESS_TOKEN;
    const res = (await logoutAction(postArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.getSetCookie()).toHaveLength(2);
  });

  it("rejects non-POST with 405", async () => {
    const request = new Request("https://studio.example/studio/logout", { method: "DELETE" });
    await expect(
      logoutAction({ request, params: {}, context: {} } as unknown as ActionFunctionArgs),
    ).rejects.toMatchObject({ status: 405 });
  });

  it("GET loader just bounces to login (no cookie mutation)", async () => {
    const res = (await logoutLoader()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/studio/login");
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });
});

describe("cookie lifetimes + clear helper", () => {
  it("magic-link session cookie is minted with a 7-day maxAge", async () => {
    const request = new Request("https://studio.example/studio/verify");
    const setCookie = await grantStudioSession("owner@example.com", request);
    expect(setCookie).toContain(`Max-Age=${60 * 60 * 24 * 7}`);
  });

  it("clearStudioCookies targets both cookie names with Max-Age=0", async () => {
    const request = new Request("https://studio.example/studio");
    const [session, legacy] = await clearStudioCookies(request);
    expect(session).toMatch(/^qz_studio_session=.*Max-Age=0/);
    expect(legacy).toMatch(/^qz_studio=.*Max-Age=0/);
  });
});
