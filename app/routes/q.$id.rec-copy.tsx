import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { Quiz } from "../lib/quizSchema";
import type { IndexedProduct } from "../lib/recommendationEngine";
import { resolveTarget, settingsForTarget } from "../lib/recommendDecider";
import { generateRuntimeRecCopy, QuizGenerationError } from "../lib/claude";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { rateLimit } from "../lib/rateLimiters";
import { recCopyCacheKey, resolveRecCopy } from "../lib/recCopyCache.server";
import { checkAiBudget, withAiSpendRecording } from "../lib/aiBudget.server";

// LOGIC v2 L2-12b — the per-shopper runtime rec-copy endpoint (rec-page-spec-V2
// §8.3). POST-only, SAME-ORIGIN (the theme-extension iframe + hosted /q are both
// on the app domain, so no CORS is needed and no preflight fires). ALL prompt
// text is derived SERVER-SIDE from publishedJson — the client sends only
// {sessionId, answerIds}, closing prompt injection. Guarded by the per-shop kill
// switch (checked live, before the cache) and rate-limited (the spend bound,
// since sessionId is client-minted). Refusals return a cheap 200 {ok:false}
// with a distinct code; the runtime silently falls back to the merchant copy.

const RATE = 5; // req/min/IP — the spend ceiling

function no(code: string, status = 200) {
  return json({ ok: false, code }, { status });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return no("method", 405);

  const rl = rateLimit(request, "rec-copy", RATE);
  if (!rl.ok) {
    return new Response(JSON.stringify({ ok: false, code: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterS) },
    });
  }

  // ── input: format-validate only; all grounding is server-derived ──────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return no("bad_input", 400);
  }
  const sessionId = (body as { sessionId?: unknown }).sessionId;
  const rawAnswerIds = (body as { answerIds?: unknown }).answerIds;
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) {
    return no("bad_input", 400);
  }
  if (!Array.isArray(rawAnswerIds) || rawAnswerIds.some((a) => typeof a !== "string")) {
    return no("bad_input", 400);
  }

  const id = params.id;
  if (!id) return no("not_found", 404);

  let quiz: {
    shopId: string;
    publishedJson: unknown;
    shop: { aiRecCopyEnabled: boolean; brandGuidelines: unknown } | null;
  } | null;
  try {
    quiz = await prisma.quiz.findFirst({
      where: { id },
      select: {
        shopId: true,
        publishedJson: true,
        shop: { select: { aiRecCopyEnabled: true, brandGuidelines: true } },
      },
    });
  } catch (e) {
    logFor("rec-copy").error({ err: e, quizId: id }, "lookup failed");
    return no("server_error", 500);
  }
  if (!quiz?.publishedJson) return no("not_found", 404);

  // Kill switch — checked LIVE (never baked) and BEFORE any cache/AI work.
  if (quiz.shop && quiz.shop.aiRecCopyEnabled === false) return no("disabled");

  // BIC-2 A3 — per-shop daily spend ceiling on the PUBLIC surface. Over budget
  // → the same cheap 200 refusal shape as "disabled" (the runtime degrades to
  // the merchant copy silently); never a 5xx. checkAiBudget fails OPEN on DB
  // errors, so a budget-table hiccup can't break the endpoint.
  const budget = await checkAiBudget(quiz.shopId, "runtime");
  if (!budget.allowed) return no("budget");

  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) return no("not_found", 404);
  const doc = parsed.data;
  if (doc.logic_model !== "decider") return no("not_decider");

  const raw = quiz.publishedJson as {
    product_index?: IndexedProduct[];
    target_product_ids_map?: Record<string, string[]>;
    target_index?: Record<string, { type: string; name?: string }>;
  };

  // Filter the client's answer ids to ones actually present in the doc (only
  // real answers can drive routing — this is the injection boundary).
  const validAnswerIds = new Set<string>();
  const answerText = new Map<string, string>();
  const questionOfAnswer = new Map<string, string>();
  for (const n of doc.nodes) {
    if (n.type !== "question") continue;
    for (const a of n.data.answers) {
      validAnswerIds.add(a.id);
      answerText.set(a.id, a.text);
      questionOfAnswer.set(a.id, n.data.text);
    }
  }
  const answerIds = rawAnswerIds.filter((a): a is string => validAnswerIds.has(a));

  // Server re-derives the target + rule (never trust a client-sent target).
  const resolved = resolveTarget(answerIds, doc);
  if (!resolved) return no("no_target");

  const cfg = settingsForTarget(doc.rec_page_settings, resolved.targetId);
  // Refusals — cheap 200s the runtime treats as "use the merchant copy":
  if (!cfg.whyOn) return no("why_off");
  if (cfg.whyCopyLocked) return no("locked"); // merchant pinned their approved copy

  const key = recCopyCacheKey(id, sessionId, resolved.targetId);
  const now = Date.now();

  // Grounding — ALL server-derived. Hero = the target's first baked member.
  const targetName = raw.target_index?.[resolved.targetId]?.name ?? "your match";
  const heroId = raw.target_product_ids_map?.[resolved.targetId]?.[0];
  const heroRow = heroId ? raw.product_index?.find((p) => p.product_id === heroId) : undefined;
  // Baked sidecar fields aren't in the Zod schema (asserted, app-generated). Guard
  // the hero shape defensively so any malformed row degrades to general copy
  // (heroProduct facts dropped) instead of throwing a 502 inside the generator.
  const heroProduct = heroRow
    ? {
        title: typeof heroRow.title === "string" ? heroRow.title : "",
        description: typeof heroRow.description === "string" ? heroRow.description : "",
        tags: Array.isArray(heroRow.tags) ? heroRow.tags : [],
      }
    : null;
  const answerTexts = answerIds.map((a) => answerText.get(a)!).filter(Boolean);

  // §8.3 — when a RULE (not the bare deciding answer) fired, render its
  // conditions to a phrase so the copy frames the COMBINATION of answers.
  let matchedRuleText: string | undefined;
  if (resolved.matchedRuleId) {
    const rule = (doc.decision_rules ?? []).find((r) => r.id === resolved.matchedRuleId);
    if (rule && rule.conditions.length > 0) {
      matchedRuleText = rule.conditions
        .map((c) => {
          const at = answerText.get(c.answer_id) ?? "that option";
          const qt = questionOfAnswer.get(c.answer_id) ?? "a question";
          return c.op === "is" ? `${qt}: ${at}` : `${qt}: not ${at}`;
        })
        .join(" and ");
    }
  }

  const brandGuidelines = parseBrandGuidelinesSafe(quiz.shop?.brandGuidelines);

  try {
    // BIC-2 A3 — record usage against the shop (only fires on an actual API
    // response, so a cache hit charges nothing).
    const { copy, cached } = await withAiSpendRecording(quiz.shopId, () =>
      resolveRecCopy(key, now, () =>
        generateRuntimeRecCopy({
          targetName,
          heroProduct,
          answerTexts,
          ...(matchedRuleText ? { matchedRuleText } : {}),
          brandGuidelines,
        }),
      ),
    );
    return json({ ok: true, copy, cached });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const credit = /credit balance is too low|insufficient.*credit|billing|purchase credits/i.test(
      message,
    );
    if (credit) {
      logFor("rec-copy").error({ quizId: id, detail: message }, "AI credits depleted");
      return json({ ok: false, code: "ai_credits" }, { status: 402 });
    }
    logFor("rec-copy").error(
      { err: err instanceof QuizGenerationError ? message : err, quizId: id },
      "generation failed",
    );
    return json({ ok: false, code: "ai_error" }, { status: 502 });
  }
}
