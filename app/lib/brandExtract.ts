import Anthropic from "@anthropic-ai/sdk";
import { BrandGuidelines, type BrandGuidelines as BrandGuidelinesT } from "./brandGuidelines";

// Extract structured brand guidelines from an uploaded file. Accepts PDF
// via Anthropic's document content block, images (PNG/JPEG/WebP) via the
// image block, or plain text / markdown via the text block. Forces tool-
// use so Claude returns the structured JSON shape directly.

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;
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

const EXTRACT_SYSTEM_PROMPT =
  "You are a senior brand strategist reading a brand's guidelines and " +
  "distilling them into a structured voice + visual specification a content " +
  "and design system can apply automatically. Be faithful to what the " +
  "brand actually says about itself — never invent guidelines that aren't " +
  "supported by the material. If the source is sparse (e.g. only colors, " +
  "no voice), populate what you can and leave the rest as defaults. Never " +
  "write commentary outside the tool call.";

// JSON schema mirrors the Zod BrandGuidelines shape. Hand-written so the
// extraction stays tightly typed at the tool boundary.
const extractToolSchema = {
  type: "object",
  required: ["name", "voice", "visual_suggestions", "source"],
  properties: {
    name: {
      type: "string",
      description:
        "Friendly display name of the brand (e.g. 'Casper Bedding'). Defaults to 'Brand' if not present.",
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
    visual_suggestions: {
      type: "object",
      properties: {
        tokens: {
          type: "object",
          description:
            "DesignTokens shape — colors (primary/secondary/accent/background/text/muted), typography (heading/body), radius, button_style, spacing. All fields optional; only include what's clearly stated.",
        },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    source: {
      type: "object",
      required: ["uploaded_at", "file_kind", "extraction_model"],
      properties: {
        uploaded_at: { type: "string" },
        file_name: { type: "string" },
        file_kind: { type: "string", enum: ["pdf", "image", "text", "preset"] },
        extraction_model: { type: "string" },
      },
    },
  },
} as const;

export class BrandExtractionError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationIssue?: string,
  ) {
    super(message);
    this.name = "BrandExtractionError";
  }
}

export interface ExtractBrandGuidelinesInput {
  // Raw bytes of the upload. Server-side only — never sent to the client.
  file: Buffer;
  // MIME type from the upload Content-Type. Used to pick the right
  // Anthropic content block.
  mediaType: string;
  fileName: string;
}

// Build the right Anthropic Beta content block for the uploaded file.
// We use the beta API so we can accept PDFs (BetaBase64PDFBlock) — the
// stable API doesn't expose document blocks yet. Throws when the media
// type isn't supported so the upload route can return a clean 415.
function buildContentBlock(
  input: ExtractBrandGuidelinesInput,
): Anthropic.Beta.BetaContentBlockParam {
  const { file, mediaType } = input;
  const base64 = file.toString("base64");

  if (mediaType === "application/pdf") {
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: base64,
      },
    };
  }

  if (
    mediaType === "image/png" ||
    mediaType === "image/jpeg" ||
    mediaType === "image/webp" ||
    mediaType === "image/gif"
  ) {
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: base64,
      },
    };
  }

  if (
    mediaType === "text/plain" ||
    mediaType === "text/markdown" ||
    mediaType === "text/x-markdown"
  ) {
    // Decode the buffer to UTF-8 text for the text block.
    return {
      type: "text",
      text: file.toString("utf-8"),
    };
  }

  throw new BrandExtractionError(
    `Unsupported media type: ${mediaType}. Upload PDF, PNG, JPEG, WebP, plain text, or markdown.`,
    0,
  );
}

export async function extractBrandGuidelines(
  input: ExtractBrandGuidelinesInput,
): Promise<BrandGuidelinesT> {
  const contentBlock = buildContentBlock(input);

  const tool = {
    name: "emit_brand_guidelines",
    description:
      "Emit the structured brand guidelines JSON. This is the only allowed response.",
    input_schema:
      extractToolSchema as unknown as Anthropic.Beta.BetaTool.InputSchema,
  } satisfies Anthropic.Beta.BetaTool;

  const userMessage =
    "Read the attached brand guideline material and emit a structured " +
    "BrandGuidelines JSON. Faithfully capture the brand's actual voice, " +
    "do/don't lists, and any color/font tokens you can identify. Use the " +
    "current ISO timestamp for source.uploaded_at, set source.file_name " +
    `to "${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}", and set ` +
    "source.extraction_model to the model id you are. Do not invent " +
    "guidelines that aren't supported by the material.";

  let lastIssue: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Use beta.messages.create for PDF document support — the stable
    // messages API doesn't expose document blocks yet. Beta header is
    // injected automatically by the SDK.
    const response = await client().beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: EXTRACT_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: "tool", name: "emit_brand_guidelines" },
      betas: ["pdfs-2024-09-25"],
      messages: [
        {
          role: "user",
          content: [
            contentBlock,
            {
              type: "text",
              text:
                attempt === 1
                  ? userMessage
                  : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Regenerate strictly matching the schema.`,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use",
    );
    if (!toolUse) {
      lastIssue = "No tool_use block in response.";
      continue;
    }

    // Stamp provenance server-side regardless of what Claude returned so
    // the merchant can't influence it via crafted PDFs.
    const claudeReturned = toolUse.input as Record<string, unknown>;
    const stamped = {
      ...claudeReturned,
      source: {
        ...((claudeReturned.source as Record<string, unknown>) ?? {}),
        uploaded_at: new Date().toISOString(),
        file_name: input.fileName,
        file_kind: inferFileKind(input.mediaType),
        extraction_model: MODEL,
      },
    };

    const parsed = BrandGuidelines.safeParse(stamped);
    if (parsed.success) return parsed.data;

    lastIssue = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
  }

  throw new BrandExtractionError(
    "Brand guideline extraction failed validation after retries.",
    MAX_ATTEMPTS,
    lastIssue,
  );
}

function inferFileKind(
  mediaType: string,
): "pdf" | "image" | "text" | "preset" {
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  return "text";
}
