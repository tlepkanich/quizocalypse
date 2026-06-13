import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { syncCatalog, ensureShop } from "./jobs/catalogSync";
import { syncThemeTokens } from "./lib/themeSync.server";
import { startBrandIdentityBuild } from "./lib/brandIdentityBuild.server";

// TECH DEBT: Spec §3.1 requires OAuth tokens encrypted at rest. The
// EncryptedSessionStorage wrapper is implemented at app/lib/encryptedSessionStorage.ts
// and roundtrip-tested in app/lib/crypto.test.ts, but cannot wrap PrismaSessionStorage
// here due to a transitive version conflict between @shopify/shopify-app-remix (v13
// of shopify-api) and @shopify/shopify-app-session-storage-prisma (v12). Resolve by
// pinning @shopify/shopify-api with npm overrides before launch, then re-wrap below.
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.January25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      const shop = await ensureShop(session.shop);
      // PoC: synchronous catalog sync inside the install callback. Acceptable
      // up to ~5k SKUs per spec §3.1. Replace with BullMQ job before launch.
      try {
        await syncCatalog(admin, session.shop);
      } catch (err) {
        console.error("[afterAuth] catalog sync failed:", err);
      }
      // Seed brand color tokens from Shopify Branding (Dev Spec §3.1 / Step 2).
      // Best-effort, non-destructive — never blocks install.
      try {
        await syncThemeTokens(admin, session.shop);
      } catch (err) {
        console.error("[afterAuth] theme token sync failed:", err);
      }
      // Builder Step 0: digest the just-synced catalog (+ the maximal pull via
      // this LIVE admin) into the merchant Brand Identity. Detached + best-effort
      // — never blocks install; the confirm screen polls brandIdentityState.
      startBrandIdentityBuild(shop.id, admin);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.January25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
