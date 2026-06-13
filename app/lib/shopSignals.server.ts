import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

// ════════════════════════════════════════════════════════════════════════════
// Shop signal readers (Brand Identity Step 0). The maximal-but-scope-free pull:
// everything the identity digest needs is reachable under the scopes we already
// hold — shop metadata is free, `shop.brand` + theme files + orders are covered
// by read_products / read_themes / read_orders. (Verified against the live Admin
// schema 2026-06-13: there is no `read_shop` scope.)
//
// Every reader takes an `admin` GraphQL client so it runs from the install hook
// (afterAuth's admin) OR the offline path (unauthenticated.admin) identically,
// and every reader is BEST-EFFORT: it swallows any failure and returns
// null/[] so a missing field, scope, or API-version drift only DROPS a signal —
// it never breaks the build. The digest is an enhancement, never a dependency.
// ════════════════════════════════════════════════════════════════════════════

type Admin = AdminApiContext;

async function runQuery<T>(
  admin: Admin,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await admin.graphql(query, variables ? { variables } : undefined);
    const json = (await res.json()) as { data?: T };
    return json.data ?? null;
  } catch {
    return null; // scope / version / network — drop the signal
  }
}

// ── Shop metadata (free, no special scope) ──────────────────────────────────
export interface ShopMetaSignal {
  name?: string;
  description?: string; // SEO meta description
  currencyCode?: string;
  planName?: string;
  primaryDomain?: string;
  ownerName?: string;
  timezone?: string;
}

const SHOP_META_QUERY = `#graphql
  query QuizShopMeta {
    shop {
      name
      description
      currencyCode
      shopOwnerName
      ianaTimezone
      plan { displayName }
      primaryDomain { host }
    }
  }
`;

export async function readShopMeta(admin: Admin): Promise<ShopMetaSignal | null> {
  const data = await runQuery<{
    shop?: {
      name?: string | null;
      description?: string | null;
      currencyCode?: string | null;
      shopOwnerName?: string | null;
      ianaTimezone?: string | null;
      plan?: { displayName?: string | null } | null;
      primaryDomain?: { host?: string | null } | null;
    } | null;
  }>(admin, SHOP_META_QUERY);
  const shop = data?.shop;
  if (!shop) return null;
  const meta: ShopMetaSignal = {};
  if (shop.name) meta.name = shop.name;
  if (shop.description) meta.description = shop.description;
  if (shop.currencyCode) meta.currencyCode = shop.currencyCode;
  if (shop.plan?.displayName) meta.planName = shop.plan.displayName;
  if (shop.primaryDomain?.host) meta.primaryDomain = shop.primaryDomain.host;
  if (shop.shopOwnerName) meta.ownerName = shop.shopOwnerName;
  if (shop.ianaTimezone) meta.timezone = shop.ianaTimezone;
  return Object.keys(meta).length > 0 ? meta : null;
}

// ── shop.brand (Shopify Branding API — under read_products) ──────────────────
// Kept as its OWN query so that if a future API version drops `shop.brand`
// (it's absent from newer schemas) the parse error only kills THIS reader, not
// the shop-meta one above.
export interface ShopBrandSignal {
  slogan?: string;
  shortDescription?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  colors?: { primary?: string; secondary?: string };
}

const SHOP_BRAND_QUERY = `#graphql
  query QuizShopBrand {
    shop {
      brand {
        slogan
        shortDescription
        logo { image { url } }
        coverImage { image { url } }
        colors {
          primary { background }
          secondary { background }
        }
      }
    }
  }
`;

export async function readShopBrand(admin: Admin): Promise<ShopBrandSignal | null> {
  const data = await runQuery<{
    shop?: {
      brand?: {
        slogan?: string | null;
        shortDescription?: string | null;
        logo?: { image?: { url?: string | null } | null } | null;
        coverImage?: { image?: { url?: string | null } | null } | null;
        colors?: {
          primary?: Array<{ background?: string | null }> | null;
          secondary?: Array<{ background?: string | null }> | null;
        } | null;
      } | null;
    } | null;
  }>(admin, SHOP_BRAND_QUERY);
  const brand = data?.shop?.brand;
  if (!brand) return null;
  const out: ShopBrandSignal = {};
  if (brand.slogan) out.slogan = brand.slogan;
  if (brand.shortDescription) out.shortDescription = brand.shortDescription;
  if (brand.logo?.image?.url) out.logoUrl = brand.logo.image.url;
  if (brand.coverImage?.image?.url) out.coverImageUrl = brand.coverImage.image.url;
  const primary = brand.colors?.primary?.[0]?.background ?? undefined;
  const secondary = brand.colors?.secondary?.[0]?.background ?? undefined;
  if (primary || secondary) out.colors = { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) };
  return Object.keys(out).length > 0 ? out : null;
}

// ── Live theme config/settings_data.json (under read_themes) ─────────────────
// Brittle by nature (every theme's settings schema differs), so we extract a few
// robust signals + a capped raw slice the AI can read directly, and tolerate any
// shape failure.
const THEME_RAW_CAP = 4000;

export interface ThemeSignal {
  colors: string[]; // distinct hex values found in settings
  fontHandles: string[]; // Shopify font-picker handles (e.g. "assistant_n4")
  logoUrl?: string;
  raw: string; // capped slice of settings_data.json for the AI
}

const THEME_SETTINGS_QUERY = `#graphql
  query QuizThemeSettings {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        files(filenames: ["config/settings_data.json"]) {
          nodes {
            body {
              ... on OnlineStoreThemeFileBodyText { content }
            }
          }
        }
      }
    }
  }
`;

export async function readThemeSettings(admin: Admin): Promise<ThemeSignal | null> {
  const data = await runQuery<{
    themes?: {
      nodes?: Array<{
        files?: { nodes?: Array<{ body?: { content?: string | null } | null }> | null } | null;
      }> | null;
    } | null;
  }>(admin, THEME_SETTINGS_QUERY);
  const content = data?.themes?.nodes?.[0]?.files?.nodes?.[0]?.body?.content;
  if (!content || typeof content !== "string") return null;

  const colors = Array.from(
    new Set((content.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase())),
  ).slice(0, 20);
  // Font-picker values look like "assistant_n4", "helvetica_n7" — handle_weight.
  const fontHandles = Array.from(
    new Set((content.match(/"[a-z0-9_]+_n[0-9]"/g) ?? []).map((f) => f.replace(/"/g, ""))),
  ).slice(0, 12);
  const logoMatch = content.match(/"(?:logo|brand_logo)"\s*:\s*"([^"]+)"/);

  return {
    colors,
    fontHandles,
    ...(logoMatch?.[1] ? { logoUrl: logoMatch[1] } : {}),
    raw: content.length > THEME_RAW_CAP ? `${content.slice(0, THEME_RAW_CAP)}…` : content,
  };
}

// ── Best-sellers by revenue (under read_orders) ─────────────────────────────
// Bounded recent-paid-orders aggregation: sum line-item revenue per product over
// up to MAX_ORDER_PAGES pages, then rank descending. "Recent revenue" is a strong
// enough signal for which products to digest; an empty result simply lets the
// corpus fall back to its deterministic proxy.
const ORDERS_PAGE = 50;
const MAX_ORDER_PAGES = 5; // ≤250 orders — install-time, bounded

export interface BestSeller {
  productId: string;
  revenue: number;
}

const BEST_SELLERS_QUERY = `#graphql
  query QuizBestSellers($cursor: String) {
    orders(first: ${ORDERS_PAGE}, after: $cursor, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid") {
      nodes {
        lineItems(first: 50) {
          nodes {
            quantity
            originalTotalSet { shopMoney { amount } }
            product { id }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

type OrdersResp = {
  orders?: {
    nodes?: Array<{
      lineItems?: {
        nodes?: Array<{
          originalTotalSet?: { shopMoney?: { amount?: string | null } | null } | null;
          product?: { id?: string | null } | null;
        }> | null;
      } | null;
    }> | null;
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
  } | null;
};

export async function readBestSellers(admin: Admin): Promise<BestSeller[]> {
  const revenue = new Map<string, number>();
  let cursor: string | undefined = undefined;

  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const data: OrdersResp | null = await runQuery<OrdersResp>(admin, BEST_SELLERS_QUERY, {
      cursor,
    });
    const conn: NonNullable<OrdersResp["orders"]> | undefined = data?.orders ?? undefined;
    if (!conn?.nodes) break;
    for (const order of conn.nodes) {
      for (const li of order.lineItems?.nodes ?? []) {
        const id = li.product?.id;
        const amount = Number(li.originalTotalSet?.shopMoney?.amount ?? 0);
        if (id && Number.isFinite(amount) && amount > 0) {
          revenue.set(id, (revenue.get(id) ?? 0) + amount);
        }
      }
    }
    const next: string | null | undefined = conn.pageInfo?.endCursor;
    if (!conn.pageInfo?.hasNextPage || !next) break;
    cursor = next;
  }

  return [...revenue.entries()]
    .map(([productId, rev]) => ({ productId, revenue: rev }))
    .sort((a, b) => b.revenue - a.revenue);
}
