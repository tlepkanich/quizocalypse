import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { resolveApiShop } from "../lib/studioAccess.server";
import { generateWhyCopy, QuizGenerationError } from "../lib/claude";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { membershipHash } from "../lib/whyCopyMeta";

// rec-page-spec-V2 §8.2 (L2-11) — CONFIG-TIME grounded why-copy: the merchant
// clicks "✦ AI generate" in the Step-4 panel and this drafts the reasoning
// from the scope's OWN product data (description/tags), nothing else — the
// spec's safety requirement against invented claims. The draft lands in the
// editable whyCopy field for merchant approval before publish; the shopper
// runtime stays zero-AI (the per-shopper layer is L2-12, owner-gated).
// Dual-auth like /api/validate-discount: embedded admin OR the studio cookie.

// Grounding caps: enough products to write honest copy, small enough to keep
// the prompt tight. Global copy samples across every bucket.
const TARGET_PRODUCT_CAP = 8;
const GLOBAL_PRODUCT_CAP = 12;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, { status: 405 });
  const shop = await resolveApiShop(request);

  let quizId = "";
  let targetId: string | null = null;
  try {
    const body = (await request.json()) as { quizId?: unknown; targetId?: unknown };
    quizId = typeof body.quizId === "string" ? body.quizId : "";
    targetId = typeof body.targetId === "string" && body.targetId ? body.targetId : null;
  } catch {
    // fall through to the missing-quizId 400 below
  }
  if (!quizId) return json({ ok: false, error: "quizId required" }, { status: 400 });

  let quiz: { id: string; name: string } | null = null;
  let categories: { id: string; name: string; productIds: string[] }[] = [];
  try {
    quiz = await prisma.quiz.findFirst({
      where: { id: quizId, shopId: shop.id },
      select: { id: true, name: true },
    });
    if (quiz) {
      categories = await prisma.category.findMany({
        where: { shopId: shop.id, quizId: quiz.id },
        select: { id: true, name: true, productIds: true },
        orderBy: { createdAt: "asc" },
      });
    }
  } catch (err) {
    console.error("[generate-why-copy] lookup failed", err);
    return json({ ok: false, error: "Lookup failed — try again." }, { status: 500 });
  }
  if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });

  const target = targetId ? categories.find((c) => c.id === targetId) ?? null : null;
  if (targetId && !target) {
    return json({ ok: false, error: "That result is no longer available." }, { status: 404 });
  }

  // The canonical grounding set — the SAME ids the panel hashes client-side
  // (whyCopyMemberIds), so the staleness comparison is apples to apples.
  const memberIds = target
    ? target.productIds
    : categories.flatMap((c) => c.productIds);
  const sampleIds = memberIds.slice(0, target ? TARGET_PRODUCT_CAP : GLOBAL_PRODUCT_CAP);

  let products: { title: string; description: string; tags: string[] }[] = [];
  let brandGuidelines: unknown = null;
  try {
    const [rows, shopRow] = await Promise.all([
      prisma.product.findMany({
        where: { shopId: shop.id, productId: { in: sampleIds } },
        select: { title: true, descriptionText: true, tags: true },
      }),
      prisma.shop.findUnique({ where: { id: shop.id }, select: { brandGuidelines: true } }),
    ]);
    products = rows.map((p) => ({
      title: p.title,
      description: p.descriptionText ?? "",
      tags: p.tags,
    }));
    brandGuidelines = shopRow?.brandGuidelines ?? null;
  } catch (err) {
    console.error("[generate-why-copy] product lookup failed", err);
    return json({ ok: false, error: "Lookup failed — try again." }, { status: 500 });
  }
  if (products.length === 0) {
    return json(
      { ok: false, error: "No products in this result yet — nothing to ground the copy in." },
      { status: 400 },
    );
  }

  try {
    const copy = await generateWhyCopy({
      targetName: target ? target.name : `${quiz.name} (all results)`,
      products,
      brandGuidelines: parseBrandGuidelinesSafe(brandGuidelines),
    });
    return json({
      ok: true,
      copy,
      // Provenance the panel stores in doc.why_copy_meta — hashed over the
      // FULL membership (not the prompt sample) so any membership change
      // flips the stale flag.
      meta: { at: new Date().toISOString(), members: membershipHash(memberIds) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const credit = /credit balance is too low|insufficient.*credit|billing|purchase credits/i.test(message);
    console.error("[generate-why-copy] generation failed", message);
    if (err instanceof QuizGenerationError || credit) {
      return json(
        {
          ok: false,
          code: credit ? "ai_credits" : "ai_error",
          error: credit
            ? "AI credits are depleted — add credits and try again."
            : "Copy generation failed — try again.",
        },
        { status: credit ? 402 : 502 },
      );
    }
    return json({ ok: false, code: "ai_error", error: "Copy generation failed — try again." }, { status: 502 });
  }
}
