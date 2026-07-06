import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { logFor } from "../lib/log.server";
import { resolveApiShop } from "../lib/studioAccess.server";
import { reviewPathQuality, QuizGenerationError } from "../lib/claude";
import { checkAiBudget, withAiSpendRecording } from "../lib/aiBudget.server";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { Quiz } from "../lib/quizSchema";
import { buildPathQualityOutcomes } from "../lib/pathQuality.server";
import { pathReportHash } from "../lib/pathReportMeta";

// LOGIC v2 §7 Tier-2 (L2-12c) — the ADVISORY AI path-quality review behind the
// "✦ Run AI quality review" button in the Test-all-paths panel. It reads each
// reachable, mapped outcome and judges whether the recommendation makes sense,
// returning advisory rows the panel stores in the DRAFT (path_report_ai, stripped
// at publish). It NEVER gates publish — the pure Tier-1 report is independent.
// Dual-auth like /api/generate-why-copy: embedded admin OR the studio cookie.

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, { status: 405 });
  const shop = await resolveApiShop(request);

  let quizId = "";
  try {
    const body = (await request.json()) as { quizId?: unknown };
    quizId = typeof body.quizId === "string" ? body.quizId : "";
  } catch {
    // fall through to the missing-quizId 400 below
  }
  if (!quizId) return json({ ok: false, error: "quizId required" }, { status: 400 });

  // BIC-2 A3 — per-shop daily merchant spend ceiling, checked before any
  // grounding work (a refusal charges and loads nothing). checkAiBudget fails
  // open on DB errors, so a budget hiccup never blocks the merchant.
  const budget = await checkAiBudget(shop.id, "merchant");
  if (!budget.allowed) {
    return json(
      {
        ok: false,
        code: "ai_budget",
        error: "Today's AI limit for this shop is reached — try again tomorrow.",
      },
      { status: 402 },
    );
  }

  let draftJson: unknown = null;
  let categories: { id: string; name: string; productIds: string[] }[] = [];
  let brandGuidelines: unknown = null;
  try {
    const quiz = await prisma.quiz.findFirst({
      where: { id: quizId, shopId: shop.id },
      select: { draftJson: true },
    });
    if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });
    draftJson = quiz.draftJson;
    const [cats, shopRow] = await Promise.all([
      prisma.category.findMany({
        where: { shopId: shop.id, quizId },
        select: { id: true, name: true, productIds: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.shop.findUnique({ where: { id: shop.id }, select: { brandGuidelines: true } }),
    ]);
    categories = cats;
    brandGuidelines = shopRow?.brandGuidelines ?? null;
  } catch (err) {
    logFor("path-quality").error({ err, quizId }, "lookup failed");
    return json({ ok: false, error: "Lookup failed — try again." }, { status: 500 });
  }

  const parsed = Quiz.safeParse(draftJson);
  if (!parsed.success) return json({ ok: false, error: "Draft failed validation" }, { status: 400 });
  const doc = parsed.data;
  if (doc.logic_model !== "decider") {
    return json({ ok: false, error: "Path review is for decider quizzes." }, { status: 400 });
  }

  // Resolve product titles for every target's sampled members (grounding).
  const wantedIds = new Set(categories.flatMap((c) => c.productIds.slice(0, 8)));
  const productTitleById = new Map<string, string>();
  try {
    if (wantedIds.size > 0) {
      const products = await prisma.product.findMany({
        where: { shopId: shop.id, productId: { in: [...wantedIds] } },
        select: { productId: true, title: true },
      });
      for (const p of products) productTitleById.set(p.productId, p.title);
    }
  } catch (err) {
    logFor("path-quality").error({ err, quizId }, "product lookup failed");
    return json({ ok: false, error: "Lookup failed — try again." }, { status: 500 });
  }

  const outcomes = buildPathQualityOutcomes(doc, categories, productTitleById);
  // Nothing to judge → early 400 (never call the model on empty content, the
  // generate-why-copy precedent). The panel keeps its prior rows / prompt.
  if (outcomes.length === 0) {
    return json(
      { ok: false, error: "No mapped outcomes to review yet — map a deciding answer first." },
      { status: 400 },
    );
  }

  try {
    const review = await withAiSpendRecording(shop.id, () =>
      reviewPathQuality({
        outcomes,
        brandGuidelines: parseBrandGuidelinesSafe(brandGuidelines),
      }),
    );
    // Defense: keep only rows the model anchored to a real server-sent outcome.
    const known = new Set(outcomes.map((o) => o.outcome_id));
    const rows = review
      .filter((r) => known.has(r.outcome_id))
      .map((r) => ({ outcome_id: r.outcome_id, verdict: r.verdict, note: r.note }));
    return json({
      ok: true,
      review: rows,
      meta: { at: new Date().toISOString(), hash: pathReportHash(doc) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const credit = /credit balance is too low|insufficient.*credit|billing|purchase credits/i.test(message);
    logFor("path-quality").error({ quizId, detail: message }, "review failed");
    if (err instanceof QuizGenerationError || credit) {
      return json(
        {
          ok: false,
          code: credit ? "ai_credits" : "ai_error",
          error: credit
            ? "AI credits are depleted — add credits and try again."
            : "Quality review failed — try again.",
        },
        { status: credit ? 402 : 502 },
      );
    }
    return json({ ok: false, code: "ai_error", error: "Quality review failed — try again." }, { status: 502 });
  }
}
