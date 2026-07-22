import type Anthropic from "@anthropic-ai/sdk";
// ai-fallbacks Gap 8 — the shared client seam (60s timeout, transient retries,
// budget-ledger usage emit) replaces this file's former self-built client.
import { createMessage } from "./ai/client";
import {
  DiscoveryResult,
  type DiscoveredCategory,
} from "./categorySchema";
import { assignProducts } from "./categoryAssign";

// Claude-powered shopper-archetype discovery. Reads a compact catalog
// summary, returns 5–9 categories with embodying tags + rationale. The
// caller (api.categories.discover) then runs assignProducts to bucket
// every product into one or two of these categories via deterministic
// tag-overlap.

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_ATTEMPTS = 3;

const DISCOVER_SYSTEM_PROMPT =
  "You are a senior merchandiser studying a Shopify catalog and " +
  "discovering archetypal shopper categories that the catalog naturally " +
  "clusters into. Think 'cozy comfort', 'adventure-ready', 'workhorse " +
  "essentials', 'gift-worthy'. Rules:\n" +
  "- Pick 5–9 categories. More for diverse catalogs, fewer for narrow " +
  "ones. Coverage matters more than cleverness — every product should " +
  "fit at least one category.\n" +
  "- Each name is short, memorable, 1–3 words.\n" +
  "- Each description is two sentences, merchant-facing.\n" +
  "- Each set of embodying tags (4–8 tags) must use vocabulary that " +
  "ACTUALLY appears in the supplied catalog — never invent tags.\n" +
  "- Each rationale is one sentence explaining what defines the archetype.\n" +
  "- Categories should be distinguishable: no two with overlapping >50% " +
  "of their tag sets.\n" +
  "- Never write commentary outside the tool call.";

const discoverToolSchema = {
  type: "object",
  required: ["categories"],
  properties: {
    categories: {
      type: "array",
      minItems: 3,
      maxItems: 12,
      items: {
        type: "object",
        required: ["name", "description", "tags", "rationale"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

export class CategoryDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationIssue?: string,
  ) {
    super(message);
    this.name = "CategoryDiscoveryError";
  }
}

export interface DiscoverCategoriesInput {
  // Compact summary of the catalog: top tags, sample titles, sample
  // descriptions. We reuse `buildScopedIndex(...)` from catalogIndex.ts
  // upstream to produce this.
  catalogSummary: string;
}

export async function discoverCategories(
  input: DiscoverCategoriesInput,
): Promise<DiscoveredCategory[]> {
  const tool = {
    name: "emit_categories",
    description:
      "Emit the discovered shopper categories. This is the only allowed response.",
    input_schema: discoverToolSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const userMessage = [
    "Catalog summary (real tags + sample products from this shop):",
    input.catalogSummary,
    "",
    "Read the catalog. Discover 5–9 archetypal shopper categories that " +
      "the catalog naturally clusters into. Tags must use the actual " +
      "vocabulary in this catalog. Emit via the tool call.",
  ].join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: DISCOVER_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_categories" },
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
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }

    const parsed = DiscoveryResult.safeParse(toolUse.input);
    if (parsed.success) return parsed.data.categories;

    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new CategoryDiscoveryError(
    "Category discovery failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// AI product assignment — Claude places EVERY product into the single best
// bucket by its title/type/description (semantic, so a tag-poor catalog still
// distributes instead of collapsing into one bucket via tag-overlap). Any
// products Claude misses are filled deterministically (no orphans). Throws on
// API failure / no key / low coverage → the caller falls back to the fully
// deterministic assignProducts.
// ───────────────────────────────────────────────────────────────────────────

const ASSIGN_MAX_TOKENS = 8192;
// Above this, the prompt/response token budget gets unreliable — let the
// deterministic fallback handle very large catalogs.
const ASSIGN_MAX_PRODUCTS = 400;

export interface AiAssignCategory {
  key: string;
  name: string;
  description?: string;
  tags?: string[];
}
export interface AiAssignProduct {
  productId: string;
  title: string;
  productType?: string;
  tags?: string[];
}

const ASSIGN_SYSTEM_PROMPT =
  "You are a merchandiser sorting a Shopify catalog into buckets. Assign EVERY " +
  "product to exactly ONE bucket — the best semantic fit from its title and " +
  "type. Spread products sensibly across the buckets; never dump most of the " +
  "catalog into a single bucket. Use the provided bucket names verbatim. " +
  "Respond only via the tool call.";

const assignToolSchema = {
  type: "object",
  required: ["assignments"],
  properties: {
    assignments: {
      type: "array",
      items: {
        type: "object",
        required: ["product_id", "bucket"],
        properties: {
          product_id: { type: "string" },
          bucket: { type: "string" },
        },
      },
    },
  },
} as const;

export async function assignProductsAI(
  categories: AiAssignCategory[],
  products: AiAssignProduct[],
): Promise<Map<string, string[]>> {
  if (categories.length === 0) return new Map();
  if (products.length > ASSIGN_MAX_PRODUCTS) {
    throw new Error("Catalog too large for AI assignment; use deterministic.");
  }

  const tool = {
    name: "assign_products",
    description: "Assign every product to exactly one bucket. The only allowed response.",
    input_schema: assignToolSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const bucketList = categories
    .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ""}`)
    .join("\n");
  const productList = products
    .map((p) => `${p.productId}\t${p.title}${p.productType ? ` (${p.productType})` : ""}`)
    .join("\n");
  const userMessage = [
    "Buckets:",
    bucketList,
    "",
    "Products (id<TAB>title (type)):",
    productList,
    "",
    "Assign every product id to exactly one bucket by best fit. Use bucket names verbatim. Emit via the tool call.",
  ].join("\n");

  const nameToKey = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.key]));
  const productIds = new Set(products.map((p) => p.productId));

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: ASSIGN_MAX_TOKENS,
      system: ASSIGN_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "assign_products" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt issue: ${lastIssue}. Assign every product.`,
        },
      ],
    });

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const input = toolUse?.input as
      | { assignments?: Array<{ product_id?: unknown; bucket?: unknown }> }
      | undefined;
    if (!input || !Array.isArray(input.assignments)) {
      lastIssue = "No assignments array in response.";
      continue;
    }

    const buckets = new Map<string, string[]>();
    for (const c of categories) buckets.set(c.key, []);
    const assigned = new Set<string>();
    for (const a of input.assignments) {
      const pid = typeof a.product_id === "string" ? a.product_id : "";
      const key =
        typeof a.bucket === "string"
          ? nameToKey.get(a.bucket.trim().toLowerCase())
          : undefined;
      if (pid && key && productIds.has(pid) && !assigned.has(pid)) {
        buckets.get(key)!.push(pid);
        assigned.add(pid);
      }
    }

    if (assigned.size < Math.ceil(products.length * 0.5)) {
      lastIssue = `Only ${assigned.size}/${products.length} products assigned.`;
      continue;
    }

    // Fill any products Claude skipped, deterministically — no orphans.
    const remaining = products.filter((p) => !assigned.has(p.productId));
    if (remaining.length > 0) {
      const det = assignProducts(
        categories.map((c) => ({ key: c.key, name: c.name, tags: c.tags ?? [] })),
        remaining.map((p) => ({
          productId: p.productId,
          tags: p.tags ?? [],
          title: p.title,
          productType: p.productType,
        })),
      );
      for (const [k, ids] of det) for (const id of ids) buckets.get(k)!.push(id);
    }

    return buckets;
  }

  throw new CategoryDiscoveryError(
    "AI product assignment failed after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}
