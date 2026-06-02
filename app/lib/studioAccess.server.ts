import { createCookie, redirect } from "@remix-run/node";
import { timingSafeEqual } from "node:crypto";
import type { Shop } from "@prisma/client";
import prisma from "../db.server";

// ───────────────────────────────────────────────────────────────────────────
// Access gate for the standalone /studio surface. This surface is NOT behind
// Shopify's embedded auth, so it's protected by a single shared token
// (STUDIO_ACCESS_TOKEN). Flow: visit /studio?key=<token> once → we set a
// signed, httpOnly cookie and redirect to the clean URL; thereafter the cookie
// grants access. Rotating the token invalidates every existing cookie (the
// cookie is HMAC-signed WITH the token, and stores only a constant marker).
// ───────────────────────────────────────────────────────────────────────────

// Constant-time string compare (length-guarded) to avoid a timing side-channel
// on the ?key= check. Exported for unit testing.
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Signed cookie bound to the current token — built lazily so it reads the env
// at request time (not module load).
function accessCookie(token: string) {
  return createCookie("qz_studio", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secrets: [token],
  });
}

/**
 * Gate a standalone /studio request. Returns void when access is granted;
 * otherwise throws a Response (redirect after a valid ?key=, or a 401 prompt).
 * Call at the top of every /studio loader/action.
 */
export async function requireStudioAccess(request: Request): Promise<void> {
  const token = process.env.STUDIO_ACCESS_TOKEN;
  if (!token) {
    throw new Response(
      "The standalone builder is not configured. Set STUDIO_ACCESS_TOKEN in the environment.",
      { status: 503 },
    );
  }

  const cookie = accessCookie(token);
  const granted = await cookie.parse(request.headers.get("Cookie"));
  if (granted === "granted") return;

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (key && safeEqual(key, token)) {
    // Valid key → set the signed cookie and redirect to the clean URL so the
    // token doesn't linger in the address bar / history.
    url.searchParams.delete("key");
    throw redirect(url.pathname + url.search, {
      headers: { "Set-Cookie": await cookie.serialize("granted") },
    });
  }

  throw new Response(accessPromptHtml(), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Resolve the single shop the standalone surface manages, from DEV_SHOP_DOMAIN.
 * The standalone surface is a private feedback tool for one dev store, so it
 * never trusts client input for shop identity.
 */
export async function resolveStudioShop(): Promise<Shop> {
  const domain = process.env.DEV_SHOP_DOMAIN;
  if (!domain) {
    throw new Response(
      "DEV_SHOP_DOMAIN is not set. Point it at your installed dev store (e.g. my-store.myshopify.com).",
      { status: 503 },
    );
  }
  const shop = await prisma.shop.findUnique({ where: { shopDomain: domain } });
  if (!shop) {
    throw new Response(
      `No installed shop matches DEV_SHOP_DOMAIN (${domain}). Install the app on that store first.`,
      { status: 404 },
    );
  }
  return shop;
}

// Minimal standalone "enter access key" page (rendered as a raw Response, so it
// carries its own inline styles rather than going through root.tsx). The form
// has no `action`, so it GETs back to the current URL — nothing user-controlled
// is reflected into the markup (no XSS surface on this pre-auth page).
function accessPromptHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Studio · access</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f0f10;color:#fafafa;
       font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  form{display:flex;flex-direction:column;gap:12px;width:300px;padding:28px;background:#1a1a1c;
       border:1px solid #2a2a2e;border-radius:14px}
  h1{font-size:16px;margin:0 0 4px}
  p{font-size:13px;color:#a1a1aa;margin:0 0 8px}
  input{padding:10px 12px;border-radius:8px;border:1px solid #3a3a3e;background:#0f0f10;color:#fafafa;font-size:14px}
  button{padding:10px 12px;border-radius:8px;border:none;background:#2a6df4;color:#fff;font-weight:600;cursor:pointer}
</style></head>
<body><form method="get">
  <h1>Quizocalypse Studio</h1>
  <p>Enter the access key to open the builder.</p>
  <input name="key" type="password" placeholder="Access key" autofocus autocomplete="current-password" />
  <button type="submit">Enter</button>
</form></body></html>`;
}
