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
// passes ONLY: generateQuizTypes + generateQuizTemplates, and their merged
// headless form generateQuizDirection (bounded, schema-forced card copy
// where latency is the merchant-visible cost). Everything
// else — question flow, edits, web research, tooltips — stays on MODEL /
// MODEL_FAST per the owner's keep-Sonnet decision. Haiku 4.5 takes plain
// forced-tool messages.create (no effort param — it would 400).
export const MODEL_SPEED = "claude-haiku-4-5";
// QBUILD-FAST — the planned question build's OUTLINE step only
// (generateQuestionPlan). Owner-approved 2026-10-05 after a blind side-by-side
// (7 stores, 144 builds): an Opus 4.8 outline with Sonnet writing gave better
// deciding questions and better whole quizzes at the same wall time. The
// WRITING stays on MODEL — Opus-written copy rated worst on plain wording.
// Opus 4.8 takes a plain forced-tool messages.create; Opus 5.5 does not (it
// 400s on forced tool use and cannot disable thinking).
export const MODEL_PLAN = "claude-opus-4-8";
export const MAX_TOKENS = 8192;
const AI_TIMEOUT_MS = 60_000;
const AI_TRANSIENT_RETRIES = 2;

let cachedClient: Anthropic | null = null;
function client(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    cachedClient = new Anthropic({
      apiKey,
      timeout: AI_TIMEOUT_MS,
      maxRetries: AI_TRANSIENT_RETRIES,
    });
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
  // QBUILD-FAST — the raw prompt-cache counters, for observers (probes).
  // Budget math reads input_tokens, which already carries them weighted.
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}) => void;

// The per-shop ledger converts tokens at the SONNET rate (aiBudget.server.ts).
// A model priced above that rate emits its tokens weighted by the price
// ratio, so the ceiling keeps erring early, never late. Opus 4.8 is $5/$25
// per MTok against Sonnet's $3/$15: 5/3 on input and output alike.
const LEDGER_TOKEN_WEIGHT: Record<string, number> = { [MODEL_PLAN]: 5 / 3 };

// Prompt-cached input bills at 1.25× (write) and 0.1× (read) of the input
// rate and is reported OUTSIDE usage.input_tokens. Fold it in at those
// weights so the per-shop ledger keeps counting every billed token. A
// Sonnet-rate response with no cache activity emits exactly what it did before.
function emittedUsage(usage: { input_tokens: number; output_tokens: number }, model: string) {
  const cached = usage as {
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  const written = cached.cache_creation_input_tokens ?? 0;
  const read = cached.cache_read_input_tokens ?? 0;
  const weight = LEDGER_TOKEN_WEIGHT[model] ?? 1;
  return {
    input_tokens: Math.round((usage.input_tokens + written * 1.25 + read * 0.1) * weight),
    output_tokens: Math.round(usage.output_tokens * weight),
    cache_creation_input_tokens: written,
    cache_read_input_tokens: read,
  };
}

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
    aiUsageEmitter?.(emittedUsage(res.usage, params.model));
  } catch {
    // Emitter bugs are the emitter's problem; the response stands.
  }
  return res;
}

// QBUILD-FAST — write `params`' cached prompt prefix for its model without
// waiting on real output: one output token, response discarded. For a burst
// of parallel calls whose cache nothing else writes — unwarmed, EVERY call in
// the burst misses and pays the 1.25× write. Best-effort by contract: it
// never rejects, because a failed warm-up only costs the cache discount and
// the real calls that follow surface any API error themselves.
export async function warmPromptCache(
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<void> {
  try {
    await createMessage({ ...params, max_tokens: 1 });
  } catch {
    // Deliberately dropped — see above.
  }
}

// Beta twin of createMessage for the one surface that needs it (brand-PDF
// extraction uses beta.messages for document support). Same shared client —
// timeout + transient retries — and the same usage emit, so the call lands in
// the budget ledger instead of the Gap-8 blind spot of a self-built client.
export async function createBetaMessage(
  params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Beta.Messages.BetaMessage> {
  const res = await client().beta.messages.create(params);
  try {
    aiUsageEmitter?.(emittedUsage(res.usage, params.model));
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
