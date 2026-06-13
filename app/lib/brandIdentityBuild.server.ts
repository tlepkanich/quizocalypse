import Anthropic from "@anthropic-ai/sdk";
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import {
  BrandIdentity,
  type BrandIdentity as BrandIdentityT,
  type IdentitySource,
} from "./brandIdentity";
import {
  BrandIdentityDraft,
  assembleBrandIdentity,
  refineBrandIdentity,
} from "./brandIdentityAssemble";
import { buildScopedIndex, selectIdentityCorpus } from "./catalogIndex";
import {
  readShopMeta,
  readShopBrand,
  readThemeSettings,
  readBestSellers,
  type ShopMetaSignal,
  type ShopBrandSignal,
  type ThemeSignal,
} from "./shopSignals.server";

// ════════════════════════════════════════════════════════════════════════════
// Brand Identity build (Step 0, P3). The forced-tool Claude call that digests
// the maximal Shopify signal set into a persistent BrandIdentity, plus the
// offline-capable detached runner that powers BOTH the install hook and the
// studio validation endpoint.
//
// Two safety disciplines, mirrored from the rest of the codebase:
//  · The AI picks a theme preset FROM THE REAL MENU; the server reconciles it
//    into derived_tokens (preset palette + real brand colors overlaid) — the AI
//    never invents a token pack.
//  · The build is an enhancement, never a dependency: every failure path leaves
//    `brandIdentity` null and writes a readable `brandIdentityState` error.
// ════════════════════════════════════════════════════════════════════════════

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_ATTEMPTS = 3;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

export class BrandIdentityError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationIssue?: string,
  ) {
    super(message);
    this.name = "BrandIdentityError";
  }
}

const IDENTITY_TOOL_SCHEMA = {
  type: "object",
  required: ["summary", "design", "positioning"],
  properties: {
    summary: { type: "string", description: "Dense 3–5 sentence brand digest." },
    tags: { type: "array", items: { type: "string" }, description: "Brand-level descriptors." },
    descriptions: { type: "array", items: { type: "string" }, description: "2–6 one-line claims." },
    design: {
      type: "object",
      required: ["suggested_theme_preset_id", "suggested_layout_variant_id"],
      properties: {
        aesthetic: { type: "array", items: { type: "string" } },
        imagery_density: { type: "string", enum: ["sparse", "moderate", "rich"] },
        color_temperament: {
          type: "string",
          enum: ["warm", "cool", "neutral", "monochrome", "vibrant"],
        },
        formality: { type: "string", enum: ["casual", "balanced", "refined", "luxury"] },
        suggested_theme_preset_id: {
          type: "string",
          enum: ["linen", "minimal", "editorial", "bold", "pastel", "dark"],
        },
        suggested_layout_variant_id: {
          type: "string",
          enum: ["cozy", "classic", "editorial"],
        },
        rationale: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
    positioning: {
      type: "object",
      properties: {
        industry: { type: "string" },
        vertical: { type: "string" },
        target_demographic: { type: "array", items: { type: "string" } },
        price_tier: { type: "string", enum: ["value", "mid", "premium", "luxury", "mixed"] },
        category_trends: { type: "array", items: { type: "string" } },
        rationale: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
    },
    voice: {
      type: "object",
      required: ["tone_description"],
      properties: {
        tone_description: { type: "string" },
        do_list: { type: "array", items: { type: "string" } },
        dont_list: { type: "array", items: { type: "string" } },
        sample_phrases: { type: "array", items: { type: "string" } },
        forbidden_phrases: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

const IDENTITY_SYSTEM_PROMPT =
  "You are a brand strategist + design director studying a Shopify store. From " +
  "the catalog, shop metadata, brand assets, live theme, and best-sellers, " +
  "distill ONE durable brand identity. Rules:\n" +
  "- summary: a dense 3–5 sentence paragraph capturing who this brand is, what " +
  "it sells, to whom, and how it carries itself. This is the reusable digest.\n" +
  "- tags: 4–10 brand-level descriptors (not product tags): 'sustainable', " +
  "'gifting', 'clinical', 'heritage'.\n" +
  "- descriptions: 2–6 one-line claims / differentiators.\n" +
  "- design lens: read the THEME + imagery to judge aesthetic adjectives, " +
  "imagery_density, color_temperament, and formality, then pick the closest " +
  "theme preset and layout variant FROM THE PROVIDED LISTS (never invent ids). " +
  "Explain the pick in one rationale sentence.\n" +
  "- positioning lens: infer industry, vertical, target_demographic, price_tier " +
  "(from the price band), and 2–4 category_trends specific to this industry.\n" +
  "- voice: a short tone_description + a few do/don't/sample phrases that match " +
  "how this brand actually writes (use the tone sample).\n" +
  "- Be decisive but set confidence honestly (low for thin/educational catalogs).\n" +
  "- Respond ONLY via the tool call.";

const THEME_PRESET_MENU = [
  "linen: warm cream paper, ink text, persimmon, serif — elevated DTC",
  "minimal: clean monochrome with one cobalt accent, Inter",
  "editorial: serif headlines, generous margins, flat — considered/premium",
  "bold: high-contrast black, electric accent, pill radius, elevated",
  "pastel: soft rose/lilac, beauty/lifestyle",
  "dark: deep navy, luminous accents — premium tech",
].join("\n  ");

const LAYOUT_MENU = [
  "cozy: dense/compact — popups + tight embeds",
  "classic: balanced default",
  "editorial: airy, spacious, 2-column desktop result",
].join("\n  ");

export interface BuildBrandIdentityInput {
  catalogSummary: string;
  toneSample?: string;
  lowVolumeEducationalHint?: boolean;
  shopMeta?: ShopMetaSignal | null;
  shopBrand?: ShopBrandSignal | null;
  theme?: ThemeSignal | null;
  bestSellerCount?: number;
  websiteText?: string;
  // Signals actually used — stamped onto the identity's provenance.
  sources: IdentitySource[];
  // Injected so the function stays deterministic for tests.
  now: string;
}

export async function buildBrandIdentity(
  input: BuildBrandIdentityInput,
): Promise<BrandIdentityT> {
  const tool = {
    name: "emit_brand_identity",
    description: "Emit the distilled brand identity. The only allowed response.",
    input_schema: IDENTITY_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const parts: string[] = [];
  if (input.shopMeta) {
    const m = input.shopMeta;
    parts.push(
      "Shop: " +
        [
          m.name && `name=${m.name}`,
          m.description && `meta="${m.description}"`,
          m.planName && `plan=${m.planName}`,
          m.currencyCode && `currency=${m.currencyCode}`,
          m.primaryDomain && `domain=${m.primaryDomain}`,
        ]
          .filter(Boolean)
          .join(" · "),
    );
  }
  if (input.shopBrand) {
    const b = input.shopBrand;
    parts.push(
      "Brand assets: " +
        [
          b.slogan && `slogan="${b.slogan}"`,
          b.shortDescription && `desc="${b.shortDescription}"`,
          b.colors?.primary && `primary=${b.colors.primary}`,
          b.colors?.secondary && `secondary=${b.colors.secondary}`,
          b.logoUrl && "has-logo",
        ]
          .filter(Boolean)
          .join(" · "),
    );
  }
  if (input.theme) {
    parts.push(
      `Live theme signals: colors=[${input.theme.colors.slice(0, 8).join(", ")}] fonts=[${input.theme.fontHandles.join(", ")}]`,
    );
    if (input.theme.raw) parts.push(`Theme settings excerpt:\n${input.theme.raw}`);
  }
  if (input.bestSellerCount && input.bestSellerCount > 0) {
    parts.push(`Best-sellers: ${input.bestSellerCount} products ranked by recent revenue.`);
  }
  if (input.lowVolumeEducationalHint) {
    parts.push(
      "NOTE: very small catalog — this is likely an EDUCATIONAL / explainer store, " +
        "not a product-finder. Bias positioning + design accordingly.",
    );
  }
  if (input.websiteText) parts.push(`Brand website excerpt:\n${input.websiteText}`);

  const userMessage = [
    "Theme presets you may choose from:\n  " + THEME_PRESET_MENU,
    "Layout variants you may choose from:\n  " + LAYOUT_MENU,
    "",
    "Catalog summary (real tags + sample products):",
    input.catalogSummary,
    input.toneSample ? `\nWriting-style sample (mimic the voice):\n${input.toneSample}` : "",
    parts.length ? `\nAdditional signals:\n${parts.join("\n")}` : "",
    "",
    "Distill the brand identity. Emit via the tool call.",
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await client().messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: IDENTITY_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_brand_identity" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }

    const parsed = BrandIdentityDraft.safeParse(toolUse.input);
    if (parsed.success) {
      return assembleBrandIdentity(parsed.data, {
        brandColors: input.shopBrand?.colors,
        sources: input.sources,
        now: input.now,
        lowVolumeEducationalHint: input.lowVolumeEducationalHint,
      });
    }
    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new BrandIdentityError(
    "Brand identity build failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ── The offline-capable runner — powers afterAuth AND the studio endpoint ────
type Admin = AdminApiContext;

// Soft-resolve an offline admin client. Returns null (never throws) when no
// usable offline session exists — the admin signals are ENHANCEMENTS, so the
// build proceeds from the catalog alone. The real error is logged for diagnosis
// (it was previously swallowed behind a generic message).
async function resolveOfflineAdmin(shopDomain: string): Promise<Admin | null> {
  // Lazy import keeps shopify.server (which builds shopifyApp() at module load)
  // out of the import graph for the pure-seam unit tests.
  const { unauthenticated } = await import("../shopify.server");
  try {
    const { admin } = await unauthenticated.admin(shopDomain);
    return admin as Admin;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[brandIdentity] no offline admin for ${shopDomain}: ${msg}`);
    return null;
  }
}

export type RunIdentityResult =
  | { ok: true; identity: BrandIdentityT }
  | { ok: false; error: string };

export async function runBrandIdentityBuild(
  shopId: string,
  admin?: Admin,
  opts?: { refine?: boolean },
): Promise<RunIdentityResult> {
  await prisma.shop
    .update({ where: { id: shopId }, data: { brandIdentityState: "building" } })
    .catch(() => {});
  try {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new Error("shop not found");

    // Admin is an ENHANCEMENT, not a dependency: with it we add the maximal
    // pull (shop meta / brand / theme / best-sellers); without it the digest is
    // built from the catalog alone (which is already in our DB). Never throws.
    const adminClient = admin ?? (await resolveOfflineAdmin(shop.shopDomain));

    const [products, collections] = await Promise.all([
      prisma.product.findMany({ where: { shopId } }),
      prisma.collection.findMany({ where: { shopId } }),
    ]);
    if (products.length === 0) {
      throw new Error("no products synced — sync your catalog first");
    }

    // Best-sellers first (they drive the corpus ranking), then the corpus, then
    // the rest of the signals in parallel. All admin-gated + best-effort.
    const bestSellers = adminClient ? await readBestSellers(adminClient) : [];
    const bestSellerIds = bestSellers.map((b) => b.productId);
    const corpus = selectIdentityCorpus(products, bestSellerIds);

    const [shopMeta, shopBrand, theme] = adminClient
      ? await Promise.all([
          readShopMeta(adminClient),
          readShopBrand(adminClient),
          readThemeSettings(adminClient),
        ])
      : [null, null, null];

    const indexed = buildScopedIndex(corpus.products, collections, []);
    const now = new Date().toISOString();
    const sources: IdentitySource[] = [{ kind: "catalog", detail: corpus.note, at: now }];
    if (shopMeta) sources.push({ kind: "shop_meta", detail: "", at: now });
    if (shopBrand) sources.push({ kind: "shop_brand", detail: "", at: now });
    if (theme) sources.push({ kind: "theme", detail: "", at: now });
    if (bestSellers.length) {
      sources.push({ kind: "best_sellers", detail: `${bestSellers.length} ranked`, at: now });
    }

    let identity = await buildBrandIdentity({
      catalogSummary: indexed.summary,
      toneSample: corpus.toneSample || undefined,
      lowVolumeEducationalHint: corpus.lowVolumeEducationalHint,
      shopMeta,
      shopBrand,
      theme,
      bestSellerCount: bestSellers.length,
      sources,
      now,
    });

    // Refresh path: preserve the merchant's locked edits across the rebuild.
    if (opts?.refine) {
      const prior = BrandIdentity.safeParse(shop.brandIdentity);
      if (prior.success) identity = refineBrandIdentity(identity, prior.data);
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: { brandIdentity: identity as never, brandIdentityState: null },
    });
    return { ok: true, identity };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.shop
      .update({ where: { id: shopId }, data: { brandIdentityState: `error:${msg.slice(0, 300)}` } })
      .catch(() => {});
    return { ok: false, error: msg };
  }
}

// Detached fire-and-forget for the install hook (afterAuth). Safe on Fly's
// always-on machine, like startAiOnboardingBuild. The state column is the poll.
export function startBrandIdentityBuild(shopId: string, admin?: Admin): void {
  void runBrandIdentityBuild(shopId, admin).catch(() => {});
}
