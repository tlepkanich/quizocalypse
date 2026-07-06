// BIC-2 C3c — the shared Anthropic client seam: model constants, the lazy SDK
// client, the A3 per-shop usage-emitter hook, and the retry error. Split out
// of claude.ts as a pure move. ISOMORPHIC: no prisma, no node builtins — the
// AsyncLocalStorage lives in aiUsageContext.server.ts and aiBudget.server.ts
// installs its emitAiUsage through setAiUsageEmitter (via the claude.ts
// barrel) at module load. Model constants are exported for the sibling ai/*
// modules only — the barrel deliberately does not re-export them.
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-4-6";
// Cheap/fast path for simple, bounded transformations (answer tooltips,
// feature→benefit bullets). Kept on the same known-good family for now; this is
// the single seam to swap in a Haiku id once confirmed, to cut cost per the spec.
export const MODEL_FAST = MODEL;
// FAST F4 (owner-approved, quality-gated) — Haiku for the funnel's two MIDDLE
// passes ONLY: generateQuizTypes + generateQuizTemplates (bounded, schema-
// forced card copy where latency is the merchant-visible cost). Everything
// else — question flow, edits, web research, tooltips — stays on MODEL /
// MODEL_FAST per the owner's keep-Sonnet decision. Haiku 4.5 takes plain
// forced-tool messages.create (no effort param — it would 400).
export const MODEL_SPEED = "claude-haiku-4-5";
export const MAX_TOKENS = 8192;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

// BIC-2 A3 — per-shop usage recording, without polluting this isomorphic
// module: this file stays prisma-free AND node-builtin-free (an async_hooks
// import here fails the client build), so the AsyncLocalStorage lives in
// aiUsageContext.server.ts and aiBudget.server.ts installs its emitAiUsage
// through this hook at module load. Until something installs it (or in any
// client bundle that dead-code-carries this file), the emitter is null and
// usage emission is a no-op.
export type AiUsageEmitter = (usage: {
  input_tokens: number;
  output_tokens: number;
}) => void;

let aiUsageEmitter: AiUsageEmitter | null = null;

export function setAiUsageEmitter(emitter: AiUsageEmitter): void {
  aiUsageEmitter = emitter;
}

// BIC-2 A3 — the ONE seam every generator's API call goes through. Emits each
// response's token usage to the installed emitter, so server callers that wrap
// a generator in withAiSpendRecording(shopId, …) get per-shop usage recorded
// with ZERO per-generator changes here. The emit can NEVER fail a generation
// that already succeeded.
export async function createMessage(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const res = await client().messages.create(params);
  try {
    aiUsageEmitter?.({
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
    });
  } catch {
    // Emitter bugs are the emitter's problem; the response stands.
  }
  return res;
}

export class QuizGenerationError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastValidationIssue?: string,
  ) {
    super(message);
    this.name = "QuizGenerationError";
  }
}

export const MAX_ATTEMPTS = 3; // initial + 2 retries per spec.
