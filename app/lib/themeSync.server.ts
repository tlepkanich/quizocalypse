import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { BrandTokens, brandColorsToTokens, type DesignTokensT } from "./designTokens";

// Seed a shop's brand color tokens from Shopify Branding on install (Dev Spec
// §3.1 / Step 2 — "Pull Shopify theme color tokens … logo URL"). Uses the
// structured Shopify Brand API (shop.brand), which is far more reliable than
// parsing each theme's bespoke settings_data.json (where color/font keys differ
// per theme). Non-destructive: only fills color slots the merchant hasn't set.
// Best-effort — the install hook swallows any throw.
//
// Note: fonts + logo (also §3.1) require theme-asset (settings_data.json)
// parsing, which is theme-specific and brittle — deferred as a follow-on.

const BRAND_QUERY = `#graphql
  query QuizThemeBrand {
    shop {
      brand {
        colors {
          primary { background }
          secondary { background }
        }
      }
    }
  }
`;

type BrandResp = {
  data?: {
    shop?: {
      brand?: {
        colors?: {
          primary?: Array<{ background?: string | null }> | null;
          secondary?: Array<{ background?: string | null }> | null;
        } | null;
      } | null;
    } | null;
  };
};

export async function syncThemeTokens(
  admin: AdminApiContext,
  shopDomain: string,
): Promise<void> {
  let resp: BrandResp;
  try {
    const res = await admin.graphql(BRAND_QUERY);
    resp = (await res.json()) as BrandResp;
  } catch {
    return; // Brand API unavailable (API version / scope) — skip silently
  }

  const brandColors = resp.data?.shop?.brand?.colors;
  const synced = brandColorsToTokens({
    primary: brandColors?.primary?.[0]?.background ?? null,
    secondary: brandColors?.secondary?.[0]?.background ?? null,
  });
  if (Object.keys(synced).length === 0) return; // nothing usable to seed

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, brandTokens: true },
  });
  if (!shop) return;

  const existing = BrandTokens.safeParse(shop.brandTokens ?? {});
  const current: Partial<DesignTokensT> = existing.success ? existing.data : {};
  // Non-destructive: any color the merchant already set wins over the synced one.
  const mergedColors = { ...synced, ...(current.colors ?? {}) };
  const next = { ...current, colors: mergedColors };

  await prisma.shop.update({
    where: { id: shop.id },
    data: { brandTokens: next as never },
  });
}
