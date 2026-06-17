import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { encrypt, decrypt } from "./crypto";
import { syncCatalogForShopId } from "../jobs/catalogSync";

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
 * Detached catalog sync for a connected standalone shop. Decrypts the stored
 * token, builds the admin shim, and pulls the catalog into this shop with the
 * storefront domain so product "Shop now" URLs resolve. Sets lastSyncStatus.
 */
export function startConnectedSync(shopId: string): void {
  void (async () => {
    try {
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { shopifyConnectDomain: true, shopifyConnectToken: true },
      });
      if (!shop?.shopifyConnectDomain || !shop.shopifyConnectToken) {
        await prisma.shop.update({
          where: { id: shopId },
          data: { lastSyncStatus: "error", lastSyncError: "Not connected to Shopify." },
        });
        return;
      }
      const admin = adminClientFromToken(shop.shopifyConnectDomain, decrypt(shop.shopifyConnectToken));
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
    select: { shopifyConnectDomain: true, shopifyConnectToken: true },
  });
  if (!shop?.shopifyConnectDomain || !shop.shopifyConnectToken) {
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
