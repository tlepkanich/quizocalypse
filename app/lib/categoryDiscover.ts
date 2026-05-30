import Anthropic from "@anthropic-ai/sdk";
import {
  DiscoveryResult,
  type DiscoveredCategory,
} from "./categorySchema";

// Claude-powered shopper-archetype discovery. Reads a compact catalog
// summary, returns 5–9 categories with embodying tags + rationale. The
// caller (api.categories.discover) then runs assignProducts to bucket
// every product into one or two of these categories via deterministic
// tag-overlap.

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
    const response = await client().messages.create({
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
