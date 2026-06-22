import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { encrypt, decrypt } from "./crypto";
import { syncCatalogForShopId } from "../jobs/catalogSync";

// shopify.server is dynamically imported (not a top-level import) so this module
// stays loadable in contexts that haven't configured the Shopify app — the pure
// helpers (normalizeShopDomain, adminClientFromToken) are unit-tested without it.
// At runtime shopify.server is already loaded, so the dynamic import is cached.
async function shopifyUnauthenticated() {
  return (await import("../shopify.server")).unauthenticated;
}

// ────────────────────────────────────────────────────────────────────────────
// Standalone Shopify connector. A non-Shopify workspace (source="standalone")
// connects a Shopify store with a CUSTOM-APP Admin API access token (the
// merchant creates a custom app in Settings → Apps → Develop apps, grants
// read_products/read_inventory, installs it, and reveals the Admin API token).
// We validate it, store it AES-256-GCM encrypted, and sync the catalog into the
// standalone shop by reusing the same bulk-operation ingestion the embedded
// install uses — driven through a tiny fetch-backed admin client, since
// syncCatalog only ever calls admin.graphql(query, {variables}).json().
// ────────────────────────────────────────────────────────────────────────────

const SHOPIFY_ADMIN_API_VERSION = "2025-01"; // matches app/shopify.server.ts (ApiVersion.January25)

/**
 * Normalize merchant input to a canonical `<store>.myshopify.com` host, or null
 * if it can't be one. Accepts a bare handle, a full URL, or the host itself.
 * Pure — unit-tested.
 */
export function normalizeShopDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\s+/g, "");
  if (!d) return null;
  if (!d.includes(".")) d = `${d}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d) ? d : null;
}

/**
 * A minimal AdminApiContext-compatible client backed by a raw custom-app token.
 * syncCatalogForShopId only uses `.graphql(query, { variables })` → `.json()`,
 * and fetch returns a Response with `.json()`, so this shim is sufficient.
 */
export function adminClientFromToken(domain: string, token: string): AdminApiContext {
  return {
    graphql: (query: string, opts?: { variables?: Record<string, unknown> }) =>
      fetch(`https://${domain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query, variables: opts?.variables ?? {} }),
      }),
  } as unknown as AdminApiContext;
}

export interface ConnectionTest {
  ok: boolean;
  shopName?: string;
  error?: string;
}

/** Validate a domain+token by reading the store name. Never throws. */
export async function testShopifyConnection(domain: string, token: string): Promise<ConnectionTest> {
  try {
    const res = await adminClientFromToken(domain, token).graphql(`{ shop { name } }`);
    if (!res.ok) {
      const auth = res.status === 401 || res.status === 403;
      return {
        ok: false,
        error: auth
          ? "Invalid access token, or the custom app lacks read_products. Double-check the token."
          : `Shopify returned HTTP ${res.status}.`,
      };
    }
    const body = (await res.json()) as {
      data?: { shop?: { name?: string } };
      errors?: unknown;
    };
    const name = body.data?.shop?.name;
    if (!name) {
      const msg = Array.isArray(body.errors)
        ? (body.errors[0] as { message?: string })?.message
        : typeof body.errors === "string"
          ? body.errors
          : null;
      return { ok: false, error: msg ?? "Couldn't read the store — check the domain and token." };
    }
    return { ok: true, shopName: name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Connection failed." };
  }
}

/**
 * Resolve a live Admin client from the EMBEDDED app's stored offline OAuth
 * session for `domain` — the "Use my installed Shopify app" path (no token to
 * paste). Returns the admin + store name, or a clear error if the app isn't
 * installed on that store / the session can't be resolved. Never throws.
 */
export async function resolveAppAdmin(
  domain: string,
): Promise<{ ok: true; admin: AdminApiContext; shopName: string } | { ok: false; error: string }> {
  try {
    const unauthenticated = await shopifyUnauthenticated();
    const { admin } = await unauthenticated.admin(domain);
    const res = await admin.graphql(`{ shop { name } }`);
    if (!res.ok) {
      return {
        ok: false,
        error: `Your installed app's session for ${domain} isn't usable (HTTP ${res.status}). Open the Shopify app once to refresh it, or connect with a token instead.`,
      };
    }
    const body = (await res.json()) as { data?: { shop?: { name?: string } } };
    const name = body.data?.shop?.name;
    if (!name) return { ok: false, error: "Couldn't read the store through the installed app." };
    return { ok: true, admin: admin as AdminApiContext, shopName: name };
  } catch {
    return {
      ok: false,
      error: `No installed Quizocalypse app was found for ${domain}. Install the app on that store first, or connect with an Admin API token instead.`,
    };
  }
}

export interface ConnectResult {
  ok: boolean;
  shopName?: string;
  error?: string;
}

/**
 * Validate + persist the connection (token encrypted) and kick the first sync
 * (detached, so it survives Fly's ~60s edge window — the UI polls lastSyncStatus).
 */
export async function connectShopify(
  shopId: string,
  rawDomain: string,
  rawToken: string,
): Promise<ConnectResult> {
  const domain = normalizeShopDomain(rawDomain);
  if (!domain) return { ok: false, error: "Enter a valid .myshopify.com store domain." };
  const token = rawToken.trim();
  if (!token) return { ok: false, error: "Paste your Admin API access token." };

  const test = await testShopifyConnection(domain, token);
  if (!test.ok) return { ok: false, error: test.error };

  await prisma.shop.update({
    where: { id: shopId },
    data: {
      shopifyConnectDomain: domain,
      shopifyConnectToken: encrypt(token),
      shopifyConnectedAt: new Date(),
      lastSyncStatus: "syncing",
      lastSyncError: null,
    },
  });

  startConnectedSync(shopId);
  return { ok: true, shopName: test.shopName };
}

/**
 * The access token the EMBEDDED Shopify app already stored for `domain`, read
 * straight from the Prisma Session table (what PrismaSessionStorage writes on
 * install / token exchange). Prefers an offline, unexpired session; falls back to
 * the latest with any token. Returns null when this database has no session for
 * the shop — e.g. the app was installed against a different deployment/DB.
 * Reusing this token directly sidesteps `unauthenticated.admin()`, which can't
 * refresh token-exchange offline tokens outside the embedded iframe.
 */
async function embeddedSessionToken(domain: string): Promise<string | null> {
  const sessions = await prisma.session.findMany({ where: { shop: domain } });
  if (!sessions.length) return null;
  const now = Date.now();
  const ranked = [...sessions].sort(
    (a, b) =>
      Number(a.isOnline) - Number(b.isOnline) || // offline (false) first
      (b.expires?.getTime() ?? Infinity) - (a.expires?.getTime() ?? Infinity), // later-expiring first
  );
  const pick = ranked.find((s) => !s.expires || s.expires.getTime() > now) ?? ranked[0];
  return pick?.accessToken ?? null;
}

/**
 * Connect via the EMBEDDED app instead of a pasted token — the "Use my installed
 * Shopify app" path. Reuses the access token the embedded app already stored in
 * the Session table (no re-paste); persists it encrypted so sync uses the proven
 * token shim. Falls back to live OAuth-session resolution, then a clear error.
 */
export async function connectShopifyViaApp(shopId: string, rawDomain: string): Promise<ConnectResult> {
  const domain = normalizeShopDomain(rawDomain);
  if (!domain) return { ok: false, error: "Enter a valid .myshopify.com store domain." };

  // 1) Reuse the embedded app's already-stored token directly.
  const sessionToken = await embeddedSessionToken(domain);
  if (sessionToken) {
    const test = await testShopifyConnection(domain, sessionToken);
    if (test.ok) {
      await prisma.shop.update({
        where: { id: shopId },
        data: {
          shopifyConnectDomain: domain,
          shopifyConnectToken: encrypt(sessionToken),
          shopifyConnectedAt: new Date(),
          lastSyncStatus: "syncing",
          lastSyncError: null,
        },
      });
      startConnectedSync(shopId);
      return { ok: true, shopName: test.shopName };
    }
  }

  // 2) Fall back to the library's live offline-session resolution.
  const probe = await resolveAppAdmin(domain);
  if (probe.ok) {
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        shopifyConnectDomain: domain,
        shopifyConnectToken: null, // app-session connection — resolved at sync time
        shopifyConnectedAt: new Date(),
        lastSyncStatus: "syncing",
        lastSyncError: null,
      },
    });
    startConnectedSync(shopId);
    return { ok: true, shopName: probe.shopName };
  }

  // 3) Nothing to reuse — explain precisely (token expiry vs. wrong database).
  return {
    ok: false,
    error: sessionToken
      ? `Found the installed app's session for ${domain}, but Shopify rejected its token — token-exchange offline tokens are short-lived. Re-open the Quizocalypse app in your Shopify admin to refresh it, then try again, or connect with an Admin API token.`
      : `No installed-app session for ${domain} exists in this workspace's database. If the app is installed on a different server or a local dev build, its token lives in that database — connect with an Admin API token instead.`,
  };
}

/**
 * The Admin client for a connected shop: the stored custom-app token shim when
 * a token is present, else the embedded app's offline OAuth session.
 */
async function adminForConnectedShop(domain: string, encToken: string | null): Promise<AdminApiContext> {
  if (encToken) return adminClientFromToken(domain, decrypt(encToken));
  const unauthenticated = await shopifyUnauthenticated();
  const { admin } = await unauthenticated.admin(domain);
  return admin as AdminApiContext;
}

/**
 * Detached catalog sync for a connected standalone shop. Builds the admin (token
 * shim OR the installed app's OAuth session) and pulls the catalog into this shop
 * with the storefront domain so product "Shop now" URLs resolve. Sets lastSyncStatus.
 */
export function startConnectedSync(shopId: string): void {
  void (async () => {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopifyConnectDomain: true, shopifyConnectToken: true },
      });
      if (!shop?.shopifyConnectDomain) {
        await prisma.shop.update({
          where: { id: shopId },
          data: { lastSyncStatus: "error", lastSyncError: "Not connected to Shopify." },
        });
        return;
      }
      const admin = await adminForConnectedShop(shop.shopifyConnectDomain, shop.shopifyConnectToken);
      // syncCatalogForShopId writes lastSyncStatus ok/error itself.
      await syncCatalogForShopId(admin, shopId, { storefrontDomain: shop.shopifyConnectDomain });
    } catch (err) {
      await prisma.shop.update({
        where: { id: shopId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          lastSyncError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        },
      });
    }
  })();
}

/** Re-sync an already-connected shop on demand. */
export async function resyncConnected(shopId: string): Promise<{ ok: boolean; error?: string }> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopifyConnectDomain: true },
  });
  if (!shop?.shopifyConnectDomain) {
    return { ok: false, error: "No Shopify store is connected." };
  }
  await prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncStatus: "syncing", lastSyncError: null },
  });
  startConnectedSync(shopId);
  return { ok: true };
}

/** Forget the connection. Synced products stay (the merchant can delete them). */
export async function disconnectShopify(shopId: string): Promise<void> {
  await prisma.shop.update({
    where: { id: shopId },
    data: { shopifyConnectDomain: null, shopifyConnectToken: null, shopifyConnectedAt: null },
  });
}
