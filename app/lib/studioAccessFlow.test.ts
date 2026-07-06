import { createHash } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireStudioAccess, studioSessionEmail } from "./studioAccess.server";
import { action as loginAction } from "../routes/studio_.login";
import { loader as verifyLoader } from "../routes/studio_.verify";

// BIC-2 D2 — the /studio auth seam end-to-end at unit level: login action →
// magic-link issue → verify loader consumes the token → signed session cookie
// → requireStudioAccess accepts it. Plus the OWNER-DECIDED (2026-07-07) legacy
// ?key= break-glass path: it must KEEP WORKING while magic-link auth is being
// confirmed, and every use must leave an audit log line. EXTENDS (not
// duplicates) studioAccess.test.ts (cookie signing matrix), studioMagicLink
// .test.ts (allowlist/cooldown pure functions) and studioLogout.test.ts
// (logout clears both cookies). All secrets/tokens below are synthetic.
// Lives in app/lib per the publicWriteGuards precedent.

interface TokenRow {
  email: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}
interface LogCall {
  scope: string;
  level: "info" | "warn" | "error";
  obj: Record<string, unknown>;
  msg: string;
}

const h = vi.hoisted(() => ({
  tokens: [] as TokenRow[],
  logCalls: [] as LogCall[],
}));

// In-memory StudioLoginToken table — genuine issue/consume flow, no DB.
vi.mock("../db.server", () => ({
  default: {
    studioLoginToken: {
      findMany: vi.fn(
        async (q: { where: { email: string; createdAt: { gte: Date } } }): Promise<Array<{ createdAt: Date }>> =>
          h.tokens
            .filter((t) => t.email === q.where.email && t.createdAt >= q.where.createdAt.gte)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((t) => ({ createdAt: t.createdAt })),
      ),
      create: vi.fn(
        async ({ data }: { data: { email: string; tokenHash: string; expiresAt: Date } }): Promise<TokenRow> => {
          const row: TokenRow = { ...data, createdAt: new Date(), usedAt: null };
          h.tokens.push(row);
          return row;
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash: string } }): Promise<TokenRow | null> =>
          h.tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { tokenHash: string; usedAt: null }; data: { usedAt: Date } }) => {
          const row = h.tokens.find((t) => t.tokenHash === where.tokenHash && t.usedAt === null);
          if (!row) return { count: 0 };
          row.usedAt = data.usedAt;
          return { count: 1 };
        },
      ),
    },
  },
}));

// Capture every log line: the audit-trail assertions read these, and with no
// email transport configured the magic link is delivered via the info line.
vi.mock("./log.server", () => ({
  logger: { level: "silent" },
  reportError: vi.fn(),
  logFor: (scope: string) => ({
    info: (obj: Record<string, unknown>, msg: string) =>
      h.logCalls.push({ scope, level: "info", obj, msg }),
    warn: (obj: Record<string, unknown>, msg: string) =>
      h.logCalls.push({ scope, level: "warn", obj, msg }),
    error: (obj: Record<string, unknown>, msg: string) =>
      h.logCalls.push({ scope, level: "error", obj, msg }),
    debug: () => undefined,
  }),
}));

const SESSION_SECRET = "synthetic-session-secret-for-tests";
const BREAK_GLASS = "synthetic-break-glass-token";
const OWNER = "owner@example.com";

function loginArgs(email: string): ActionFunctionArgs {
  const form = new FormData();
  form.set("email", email);
  const request = new Request("https://studio.example/studio/login", {
    method: "POST",
    body: form,
  });
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

function verifyArgs(token: string): LoaderFunctionArgs {
  const request = new Request(
    `https://studio.example/studio/verify?token=${encodeURIComponent(token)}`,
  );
  return { request, params: {}, context: {} } as unknown as LoaderFunctionArgs;
}

function studioRequest(opts: { cookie?: string; query?: string } = {}): Request {
  return new Request(`https://studio.example/studio/quizzes${opts.query ?? ""}`, {
    headers: opts.cookie ? { Cookie: opts.cookie } : {},
  });
}

/** Run a loader/gate that authenticates by THROWING a redirect Response. */
async function thrownResponse(promise: Promise<unknown>): Promise<Response | null> {
  try {
    await promise;
    return null;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function loggedLink(): string {
  const call = h.logCalls.find(
    (c: LogCall) => c.scope === "studio-login" && typeof c.obj.link === "string",
  );
  expect(call, "expected the magic link to be logged (no email transport in tests)").toBeTruthy();
  return call!.obj.link as string;
}

const cookiePair = (setCookie: string): string => setCookie.split(";")[0]!;

beforeEach(() => {
  vi.clearAllMocks();
  h.tokens.length = 0;
  h.logCalls.length = 0;
  vi.stubEnv("STUDIO_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("STUDIO_ACCESS_TOKEN", BREAK_GLASS);
  vi.stubEnv("STUDIO_ALLOWED_EMAILS", `${OWNER}, second@example.com`);
  // Force the logged-link transport regardless of the host machine's env.
  vi.stubEnv("GMAIL_SMTP_USER", "");
  vi.stubEnv("GMAIL_SMTP_APP_PASSWORD", "");
  vi.stubEnv("RESEND_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("magic-link flow, end to end", () => {
  it("login → emailed link → verify sets the signed cookie → requireStudioAccess accepts it", async () => {
    // 1. Request a link for an allowlisted address.
    const loginRes = await loginAction(loginArgs(OWNER));
    expect(await loginRes.json()).toEqual({ sent: true });
    expect(h.tokens).toHaveLength(1);

    // Only the SHA-256 hash hits the DB — a leak yields no usable link.
    const link = loggedLink();
    expect(link.startsWith("https://studio.example/studio/verify?token=")).toBe(true);
    const rawToken = new URL(link).searchParams.get("token")!;
    expect(h.tokens[0]!.tokenHash).toBe(createHash("sha256").update(rawToken).digest("hex"));
    expect(h.tokens[0]!.tokenHash).not.toBe(rawToken);

    // 2. Verify consumes the token and grants the session cookie.
    const redirect = await thrownResponse(verifyLoader(verifyArgs(rawToken)));
    expect(redirect?.status).toBe(302);
    expect(redirect?.headers.get("Location")).toBe("/studio");
    const setCookie = redirect!.headers.get("Set-Cookie")!;
    expect(setCookie.startsWith("qz_studio_session=")).toBe(true);
    expect(setCookie).toContain("HttpOnly");

    // 3. The cookie authenticates studio requests and identifies who signed in.
    const authed = studioRequest({ cookie: cookiePair(setCookie) });
    await expect(requireStudioAccess(authed)).resolves.toBeUndefined();
    expect(await studioSessionEmail(authed)).toBe(OWNER);
  });

  it("a consumed token is single-use — the second verify falls through to the retry screen", async () => {
    await loginAction(loginArgs(OWNER));
    const rawToken = new URL(loggedLink()).searchParams.get("token")!;
    expect(await thrownResponse(verifyLoader(verifyArgs(rawToken)))).not.toBeNull();
    // Second click: loader returns null (renders "Link expired"), no cookie.
    expect(await verifyLoader(verifyArgs(rawToken))).toBeNull();
  });

  it("expired and garbage tokens are rejected", async () => {
    const raw = "expired-token-raw-value";
    h.tokens.push({
      email: OWNER,
      tokenHash: createHash("sha256").update(raw).digest("hex"),
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 45 * 60 * 1000), // 15-min TTL long past
      usedAt: null,
    });
    expect(await verifyLoader(verifyArgs(raw))).toBeNull();
    expect(await verifyLoader(verifyArgs("complete-garbage"))).toBeNull();
    expect(await verifyLoader(verifyArgs(""))).toBeNull();
  });

  it("non-allowlisted email → same 'sent' reply (anti-enumeration) but NO token and NO email", async () => {
    const res = await loginAction(loginArgs("stranger@evil.example"));
    expect(await res.json()).toEqual({ sent: true });
    expect(h.tokens).toHaveLength(0);
    expect(h.logCalls.find((c: LogCall) => typeof c.obj.link === "string")).toBeUndefined();
  });

  it("a second immediate request is silently absorbed by the 60s cooldown (still 'sent', one token)", async () => {
    await loginAction(loginArgs(OWNER));
    const res = await loginAction(loginArgs(OWNER));
    expect(await res.json()).toEqual({ sent: true });
    expect(h.tokens).toHaveLength(1);
  });
});

describe("legacy ?key= break-glass (owner decision 2026-07-07: KEEP while magic-link is being confirmed)", () => {
  it("a valid key grants access: sets the signed legacy cookie and redirects to the clean URL", async () => {
    const redirect = await thrownResponse(
      requireStudioAccess(studioRequest({ query: `?key=${BREAK_GLASS}` })),
    );
    expect(redirect?.status).toBe(302);
    // Token stripped from the address bar / history.
    expect(redirect?.headers.get("Location")).toBe("/studio/quizzes");
    const setCookie = redirect!.headers.get("Set-Cookie")!;
    expect(setCookie.startsWith("qz_studio=")).toBe(true);

    // The granted cookie then passes the gate without the key.
    await expect(
      requireStudioAccess(studioRequest({ cookie: cookiePair(setCookie) })),
    ).resolves.toBeUndefined();
  });

  it("every break-glass use emits the audit line (ip + path + accepted, never the token)", async () => {
    await thrownResponse(requireStudioAccess(studioRequest({ query: `?key=${BREAK_GLASS}` })));
    const audit = h.logCalls.find(
      (c: LogCall) => c.scope === "studio-login" && c.level === "warn" && c.obj.accepted === true,
    );
    expect(audit).toBeTruthy();
    expect(audit!.msg).toContain("break-glass");
    expect(audit!.obj.path).toBe("/studio/quizzes");
    expect(JSON.stringify(audit!.obj)).not.toContain(BREAK_GLASS);
  });

  it("a wrong key is refused (login redirect), logged as a rejected probe, and sets no cookie", async () => {
    const redirect = await thrownResponse(
      requireStudioAccess(studioRequest({ query: "?key=wrong-guess" })),
    );
    expect(redirect?.status).toBe(302);
    expect(redirect?.headers.get("Location")).toBe("/studio/login");
    expect(redirect?.headers.get("Set-Cookie")).toBeNull();
    const probe = h.logCalls.find(
      (c: LogCall) => c.scope === "studio-login" && c.level === "warn" && c.obj.accepted === false,
    );
    expect(probe).toBeTruthy();
  });

  it("no cookie, no key → redirected to /studio/login", async () => {
    const redirect = await thrownResponse(requireStudioAccess(studioRequest()));
    expect(redirect?.status).toBe(302);
    expect(redirect?.headers.get("Location")).toBe("/studio/login");
  });

  it("neither secret configured → explicit 503 (misconfiguration is loud, not an open door)", async () => {
    vi.stubEnv("STUDIO_SESSION_SECRET", "");
    vi.stubEnv("STUDIO_ACCESS_TOKEN", "");
    const res = await thrownResponse(requireStudioAccess(studioRequest()));
    expect(res?.status).toBe(503);
  });
});
