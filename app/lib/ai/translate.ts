// BIC-2 C3c — Phase K quiz translation (chunked, parallel). Pure move out of
// claude.ts. ISOMORPHIC — no node builtins.
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildBrandVoiceAddition,
  type BrandGuidelines,
} from "../brandGuidelines";
import { z } from "zod";
import { MODEL, MAX_TOKENS, MAX_ATTEMPTS, createMessage, QuizGenerationError } from "./client";

// ---------- Phase K — quiz translation ----------

const TRANSLATE_SYSTEM_PROMPT =
  "You are a professional e-commerce localizer. Translate each provided string into the TARGET LOCALE, returning the SAME key with the translated text. " +
  "Rules: PRESERVE every @merge.tag token EXACTLY as written (e.g. @name, @email, @answer.q1 — these are runtime variables, never translate or remove them); " +
  "preserve emoji and {n}-style placeholders verbatim; keep product names, brand names, and proper nouns untranslated; " +
  "match the register of modern e-commerce UX writing in the target language (concise, friendly, imperative for buttons); " +
  "keep button/CTA strings SHORT (they must fit a button); translate every key you are given and emit nothing else.";

const translateToolJsonSchema = {
  type: "object",
  required: ["translations"],
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "text"],
        properties: {
          key: { type: "string", description: "EXACTLY the input key, unchanged." },
          text: { type: "string", description: "The translated string." },
        },
      },
    },
  },
} as const;

const TranslationBatch = z.object({
  translations: z.array(z.object({ key: z.string(), text: z.string() })),
});

export interface TranslateQuizInput {
  strings: Array<{ key: string; text: string }>;
  targetLocale: string;
  toneSample?: string;
  brandGuidelines?: BrandGuidelines;
}

const TRANSLATE_CHUNK = 60;

/**
 * Translate the extracted string list into the target locale, chunked so a
 * large quiz never overruns the output budget. Chunks run IN PARALLEL — a
 * real quiz (~150 strings = 3 chunks) must finish inside the Fly edge
 * proxy's ~60s request window, and sequential chunks blew it (verified live:
 * the proxy closed the socket mid-request and nothing persisted). Each chunk
 * keeps its own zod gate + retry (the enrichFromReviews pattern); keys not
 * present in the chunk's input are dropped, missing keys are tolerated
 * (callers fall back to English per-string). Returns a flat key→text map.
 */
export async function translateQuiz(
  input: TranslateQuizInput,
): Promise<Record<string, string>> {
  const system = TRANSLATE_SYSTEM_PROMPT + buildBrandVoiceAddition(input.brandGuidelines);
  const tool = {
    name: "emit_translations",
    description: "Emit the translated strings, one entry per input key.",
    input_schema: translateToolJsonSchema as unknown as Anthropic.Tool.InputSchema,
  } satisfies Anthropic.Tool;

  const chunks: Array<Array<{ key: string; text: string }>> = [];
  for (let start = 0; start < input.strings.length; start += TRANSLATE_CHUNK) {
    chunks.push(input.strings.slice(start, start + TRANSLATE_CHUNK));
  }

  const translateChunk = async (
    chunk: Array<{ key: string; text: string }>,
    index: number,
  ): Promise<Record<string, string>> => {
    const allowed = new Set(chunk.map((s) => s.key));
    const userMessage = [
      `TARGET LOCALE: ${input.targetLocale}`,
      ...(input.toneSample
        ? ["", "BRAND VOICE SAMPLE (match this register):", input.toneSample]
        : []),
      "",
      "STRINGS TO TRANSLATE (return every key):",
      ...chunk.map((s) => `${s.key} ||| ${s.text}`),
    ].join("\n");

    let lastIssue: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await createMessage({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        tools: [tool],
        tool_choice: { type: "tool", name: "emit_translations" },
        messages: [
          {
            role: "user",
            content:
              attempt === 1
                ? userMessage
                : `${userMessage}\n\nPrevious attempt failed validation: ${lastIssue}. Re-emit strictly matching the schema.`,
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
      const parsed = TranslationBatch.safeParse(toolUse.input);
      if (!parsed.success) {
        lastIssue = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        continue;
      }
      const out: Record<string, string> = {};
      for (const t of parsed.data.translations) {
        if (allowed.has(t.key) && t.text.trim()) out[t.key] = t.text;
      }
      return out;
    }
    throw new QuizGenerationError(
      `Translation chunk ${index + 1} failed validation after retries.`,
      MAX_ATTEMPTS,
      lastIssue,
    );
  };

  const results = await Promise.all(chunks.map((c, i) => translateChunk(c, i)));
  return Object.assign({}, ...results) as Record<string, string>;
}
