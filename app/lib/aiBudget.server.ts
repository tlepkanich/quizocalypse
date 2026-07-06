import prisma from "../db.server";
import { reportError } from "./log.server";
import { setAiUsageEmitter } from "./claude";
import {
  emitAiUsage,
  withAiUsageObserver,
  type ObservedAiUsage,
} from "./aiUsageContext.server";

// BIC-2 A3 — per-shop daily AI spend ceilings over ONE shared Anthropic key.
// Three pieces:
//   recordAiUsage   — atomic upsert-increment into the (shopId, UTC day) AiUsage
//                     row. NEVER throws: usage tracking must never break the
//                     feature that spent the tokens.
//   checkAiBudget   — "is this shop still under today's ceiling?" Reads the
//                     SAME row recording writes (one source of truth). FAILS
//                     OPEN on DB errors: a broken budget table must not take
//                     down generation — log + allow.
//   withAiSpendRecording — the caller-side wrapper that threads a shopId into
//                     claude.ts's usage emits (see aiUsageContext.ts).
//
// The ceiling is SOFT: check happens before the call, record after the
// response, so a concurrent call can slip past by one request. Acceptable —
// the atomic increments keep the ledger honest and the next check refuses.

// Install the ALS-backed emitter into claude.ts's usage hook. This module is
// imported by every withAiSpendRecording caller, so the hook is always live
// before any recording scope can exist (see aiUsageContext.server.ts).
setAiUsageEmitter(emitAiUsage);

export interface AiBudgetCheck {
  allowed: boolean;
  spentUSD: number;
  limitUSD: number;
}

export type AiBudgetKind = "runtime" | "merchant";

// Pricing: we track TOKENS (model-agnostic) and convert with the SONNET rate
// ($3/MTok input, $15/MTok output) even though the funnel's type/template
// passes run on Haiku 4.5 ($1/$5). One conservative rate keeps the row and the
// math trivial, and errs toward refusing slightly EARLY (over-estimating Haiku
// spend), never late — the right bias for a ceiling protecting a shared key.
const USD_PER_INPUT_TOKEN = 3 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 15 / 1_000_000;

// Defaults when the env knobs are unset:
//   AI_BUDGET_RUNTIME_DAILY_USD  = 2  — the PUBLIC shopper surface (rec-copy),
//                                      the tightest ceiling.
//   AI_BUDGET_MERCHANT_DAILY_USD = 10 — merchant-invoked spends (why-copy,
//                                      path-quality, funnel generation, edits).
// An explicit `0` = feature OFF (unlimited) — the escape hatch to disable
// enforcement per surface without a deploy rollback.
const DEFAULT_LIMIT_USD: Record<AiBudgetKind, number> = {
  runtime: 2,
  merchant: 10,
};

/** UTC day key, "yyyy-mm-dd". Exported for tests (day-rollover math). */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Estimated USD spend for a usage row, at the conservative Sonnet rate. */
export function estimateSpendUSD(row: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return (
    row.inputTokens * USD_PER_INPUT_TOKEN +
    row.outputTokens * USD_PER_OUTPUT_TOKEN
  );
}

function limitFor(kind: AiBudgetKind): number {
  const raw =
    kind === "runtime"
      ? process.env.AI_BUDGET_RUNTIME_DAILY_USD
      : process.env.AI_BUDGET_MERCHANT_DAILY_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_LIMIT_USD[kind];
  const parsed = Number(raw);
  // A malformed or negative knob falls back to the default — never to
  // unlimited (misconfiguration must not silently disable the ceiling).
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LIMIT_USD[kind];
  return parsed;
}

/** Record one response's token usage against the shop's UTC-day row. A single
 *  atomic upsert-increment (Prisma → Postgres INSERT … ON CONFLICT DO UPDATE;
 *  no read-modify-write). NEVER throws and never rejects — failures are
 *  logged via reportError and swallowed. */
export async function recordAiUsage(
  shopId: string,
  usage: { input_tokens: number; output_tokens: number },
): Promise<void> {
  try {
    const inputTokens = Math.max(0, Math.floor(usage.input_tokens || 0));
    const outputTokens = Math.max(0, Math.floor(usage.output_tokens || 0));
    const day = utcDayKey();
    await prisma.aiUsage.upsert({
      where: { shopId_day: { shopId, day } },
      create: { shopId, day, inputTokens, outputTokens, calls: 1 },
      update: {
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        calls: { increment: 1 },
      },
    });
  } catch (err) {
    reportError(err, { scope: "ai-budget", msg: "usage record failed", shopId });
  }
}

/** Is this shop still under today's ceiling for `kind`? Reads the same AiUsage
 *  row recording writes. limitUSD 0 = feature off → always allowed (and skips
 *  the DB read). FAILS OPEN on DB errors: log + allow — a budget-table hiccup
 *  must never take down generation. */
export async function checkAiBudget(
  shopId: string,
  kind: AiBudgetKind,
): Promise<AiBudgetCheck> {
  const limitUSD = limitFor(kind);
  if (limitUSD === 0) return { allowed: true, spentUSD: 0, limitUSD: 0 };
  try {
    const row = await prisma.aiUsage.findUnique({
      where: { shopId_day: { shopId, day: utcDayKey() } },
      select: { inputTokens: true, outputTokens: true },
    });
    const spentUSD = row ? estimateSpendUSD(row) : 0;
    return { allowed: spentUSD < limitUSD, spentUSD, limitUSD };
  } catch (err) {
    reportError(err, {
      scope: "ai-budget",
      msg: "budget check failed (fail-open)",
      shopId,
    });
    return { allowed: true, spentUSD: 0, limitUSD };
  }
}

/** Run `fn` with every Anthropic response inside it recorded against `shopId`.
 *  The record is fire-and-forget (recordAiUsage never rejects), so the
 *  observer can't slow or fail the generation path. Check ≠ record: this only
 *  RECORDS actual responses — enforcement stays at the endpoints, so a
 *  refused request charges nothing. */
export function withAiSpendRecording<T>(
  shopId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withAiUsageObserver((usage: ObservedAiUsage) => {
    void recordAiUsage(shopId, usage);
  }, fn);
}
