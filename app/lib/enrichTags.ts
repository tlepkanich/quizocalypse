import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
// ai-fallbacks Gap 8 — the shared client seam (60s timeout, transient retries,
// budget-ledger usage emit) replaces this file's former self-built client.
import { createMessage } from "./ai/client";

// Claude-powered product tag enrichment. Reads title + description +
// existing tags + vendor + product type, returns a list of additional
// tags that will improve quiz tag-overlap matching. Mirrors the
// generateQuiz / regenerateQuestion pattern (forced tool-use, 3 retries,
// re-validation against a Zod schema).

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1024;
const MAX_ATTEMPTS = 3;

const ENRICH_SYSTEM_PROMPT =
  "You are a Shopify merchandiser tagging products to power tag-overlap " +
  "matching in a product-finder quiz. Given a product's title, " +
  "description, vendor, type, and existing tags, suggest 5–12 ADDITIONAL " +
  "tags that capture: style, use case, audience, material, season, " +
  "occasion, mood, price tier, or visual aesthetic. Rules:\n" +
  "- Tags must be lowercase, hyphenated where multi-word (e.g. " +
  "'cold-weather', 'business-casual').\n" +
  "- Do NOT duplicate any existing tag (case-insensitive).\n" +
  "- Do NOT invent attributes not supported by the description or title.\n" +
  "- Prefer broad, queryable tags over hyper-specific ones (e.g. 'wool' " +
  "over 'merino-wool-200gsm').\n" +
  "- Never write commentary outside the tool call.";

const EnrichSchema = z.object({
  suggested_tags: z
    .array(z.string().min(1).max(60))
    .min(0)
    .max(20),
});
export type EnrichResult = z.infer<typeof EnrichSchema>;

const enrichToolSchema = {
  type: "object",
  required: ["suggested_tags"],
  properties: {
    suggested_tags: {
      type: "array",
      items: { type: "string" },
      description:
        "5–12 additional lowercase hyphenated tags for this product. Empty array if the product description provides no enrichment signal.",
    },
  },
} as const;

export class EnrichmentError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationIssue?: string,
  ) {
    super(message);
    this.name = "EnrichmentError";
  }
}

export interface EnrichProductInput {
  title: string;
  // Plain-text description (HTML pre-stripped via stripHtml in catalogSync).
  description: string | null;
  existingTags: string[];
  vendor?: string | null;
  productType?: string | null;
}

// Returns deduplicated lowercase tags that don't overlap with existing
// tags. Caller is responsible for persisting (Prisma update + Shopify push).
export async function enrichProductTags(
  input: EnrichProductInput,
): Promise<string[]> {
  const tool = {
    name: "emit_tags",
    description:
      "Emit the suggested additional tags for this product. This is the only allowed response.",
    input_schema: enrichToolSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const existingLower = new Set(
    input.existingTags.map((t) => t.toLowerCase()),
  );

  const userMessage = [
    `Title: ${input.title}`,
    input.vendor ? `Vendor: ${input.vendor}` : null,
    input.productType ? `Type: ${input.productType}` : null,
    `Existing tags: ${
      input.existingTags.length > 0 ? input.existingTags.join(", ") : "(none)"
    }`,
    "",
    "Description:",
    input.description?.trim()
      ? input.description.trim().slice(0, 4000)
      : "(no description available)",
    "",
    "Emit additional tags via the tool call. Avoid duplicating any existing tag.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await createMessage({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: ENRICH_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_tags" },
      messages: [
        {
          role: "user",
          content:
            attempt === 1
              ? userMessage
              : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Try again, strictly matching the schema.`,
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

    const parsed = EnrichSchema.safeParse(toolUse.input);
    if (parsed.success) {
      return normalizeTags(parsed.data.suggested_tags, existingLower);
    }
    lastIssue = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new EnrichmentError(
    "Tag enrichment failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

// Lowercase, trim, replace spaces with hyphens, dedupe, and exclude
// anything already in the existing-tags set. Caps the result at 12 tags
// to keep the merged tag list bounded.
export function normalizeTags(
  raw: string[],
  existingLower: Set<string>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawTag of raw) {
    const cleaned = rawTag
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/[^a-z0-9\-:]+/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (cleaned.length === 0 || cleaned.length > 60) continue;
    if (existingLower.has(cleaned)) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= 12) break;
  }
  return out;
}

// Merge enriched tags into existing tags, preserving order: existing
// first, new ones appended. Case-insensitive dedup against the existing
// list. Returns the merged array ready to write back to Prisma + Shopify.
export function mergeTags(
  existing: string[],
  enriched: string[],
): string[] {
  const existingLower = new Set(existing.map((t) => t.toLowerCase()));
  const merged = [...existing];
  for (const t of enriched) {
    if (!existingLower.has(t.toLowerCase())) {
      merged.push(t);
      existingLower.add(t.toLowerCase());
    }
  }
  return merged;
}
