// app/routes/api.categories.set-members.tsx
// Id-stable bucket-membership editor for the Logic tab's Product Mapping table.
//
// Unlike /api/categories.group (which does deleteMany + createMany and RE-MINTS
// every Category cuid), this action updates `productIds` IN PLACE by id. That
// matters because each result node binds to a bucket via `data.category_id`;
// re-minting would stale every binding and churn reconcileBucketsToResultNodes
// (headline resets) on every cell toggle. Here, ids are preserved → bindings
// survive, no reconcile needed.
//
// Body (JSON or form): { quizId, members: { [categoryId]: string[] } }.
// Only categories owned by (shop, quiz) are touched; unknown ids are ignored.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Coerce the posted `members` field into { [categoryId]: string[] }. Accepts a
// JSON string (form transport) or an already-parsed object (application/json).
// Returns null on any structural problem so the caller can 400.
function parseMembers(raw: unknown): Record<string, string[]> | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string[]> = {};
  for (const [categoryId, ids] of Object.entries(value as Record<string, unknown>)) {
    if (typeof categoryId !== "string" || categoryId.length === 0) return null;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      return null;
    }
    // Dedupe defensively — the matrix shouldn't produce dupes, but be safe.
    out[categoryId] = [...new Set(ids as string[])];
  }
  return out;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  const form = await request.formData();
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) out[key] = value;
  return out;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const quizId = typeof body.quizId === "string" ? body.quizId.trim() : "";
  if (!quizId) {
    return json({ ok: false, error: "Missing quizId" }, { status: 400 });
  }
  const ownedQuiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId: shop.id },
    select: { id: true },
  });
  if (!ownedQuiz) {
    return json({ ok: false, error: "Quiz not found" }, { status: 404 });
  }

  const members = parseMembers(body.members);
  if (!members) {
    return json({ ok: false, error: "Invalid members payload" }, { status: 400 });
  }

  const ids = Object.keys(members);
  if (ids.length === 0) {
    return json({ ok: true, updated: 0, categories: [] });
  }

  // Update categories owned by this shop that are either scoped to this quiz
  // OR shop-global (quizId = null). Loaders surface global buckets referenced
  // by a quiz's result nodes (legacy/AI-bound quizzes), so the table can render
  // — and therefore edit — those columns too; scoping to only the quiz id would
  // silently no-op those saves and leave the table permanently "dirty". Other
  // quizzes' scoped buckets stay protected. Loading source keeps
  // manualProductIds consistent for manual buckets.
  const owned = await prisma.category.findMany({
    where: { id: { in: ids }, shopId: shop.id, OR: [{ quizId }, { quizId: null }] },
    select: { id: true, source: true },
  });
  const sourceById = new Map(owned.map((c) => [c.id, c.source]));

  const updates = owned.map((c) => {
    const productIds = members[c.id] ?? [];
    return prisma.category.update({
      where: { id: c.id },
      data: {
        productIds,
        // A manual bucket's pinned set IS its membership; for source-derived
        // buckets the table edit is a manual override, so we don't touch their
        // manualProductIds (kept []), and productIds becomes the override set.
        ...(sourceById.get(c.id) === "manual" ? { manualProductIds: productIds } : {}),
      },
    });
  });

  try {
    await prisma.$transaction(updates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }

  const rows = await prisma.category.findMany({
    where: { id: { in: owned.map((c) => c.id) } },
    select: { id: true, name: true, productIds: true },
  });

  return json({
    ok: true,
    updated: rows.length,
    categories: rows.map((r) => ({
      id: r.id,
      name: r.name,
      productCount: r.productIds.length,
    })),
  });
}
