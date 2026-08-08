import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { resolveApiShop } from "../lib/studioAccess.server";
import {
  resolveMembership,
  type Membership,
  type ResolvableProduct,
} from "../lib/groupMembership";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4.3 "one resource index" + DECISIONS G1) — ensure a
// Category row exists for each picked resource, so the create-rule modal can
// target tags / collections / products directly. A rule target must be a
// Category id (the publish gate fetches the rows and BLOCKS on missing ones),
// so picking a raw resource materializes a quiz-scoped Category backed by the
// same membership machinery Groups use.
//
// ADDITIVE + idempotent: an existing row with the same (quizId, source,
// sourceRef) is reused, never duplicated. Nothing is deleted here — this is
// deliberately NOT api.categories.group (whose re-group clears the quiz's
// buckets first).
// ════════════════════════════════════════════════════════════════════════════

const ResourceSchema = z.object({
  // "metafield" refs use the membership convention "key: value" (the same
  // string metafieldValuesOf produces — groupMembership matches exact).
  kind: z.enum(["tag", "collection", "product", "metafield"]),
  ref: z.string().min(1).max(500),
  name: z.string().min(1).max(200),
});

// The membership metafield-value convention (studio.groups' metafieldValuesOf).
function metafieldValuesOf(mf: unknown): string[] {
  if (!mf || typeof mf !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(mf as Record<string, unknown>)) {
    const val =
      v && typeof v === "object" && "value" in (v as object)
        ? String((v as { value: unknown }).value)
        : String(v);
    out.push(`${k}: ${val}`);
  }
  return out;
}

const BodySchema = z.object({
  quizId: z.string().min(1),
  resources: z.array(ResourceSchema).min(1).max(12),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  const shop = await resolveApiShop(request);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Invalid request body", issues: parsed.error.issues.slice(0, 3) },
      { status: 400 },
    );
  }
  const { quizId, resources } = parsed.data;

  const ownedQuiz = await prisma.quiz.findFirst({
    where: { id: quizId, shopId: shop.id },
    select: { id: true },
  });
  if (!ownedQuiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });

  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    select: { productId: true, tags: true, collectionIds: true, metafields: true },
  });
  const resolvable: ResolvableProduct[] = products.map((p) => ({
    id: p.productId,
    tags: p.tags,
    collectionIds: p.collectionIds,
    metafieldValues: metafieldValuesOf(p.metafields),
  }));

  const out = [];
  for (const r of resources) {
    // Reuse before create — quiz-scoped first, then shop-global. Postgres
    // sorts NULLS FIRST on a plain desc, which would invert the precedence
    // (review L2-2) — nulls: "last" keeps the quiz-scoped row winning.
    const existing = await prisma.category.findFirst({
      where: {
        shopId: shop.id,
        source: r.kind,
        sourceRef: r.ref,
        OR: [{ quizId }, { quizId: null }],
      },
      orderBy: { quizId: { sort: "desc", nulls: "last" } },
    });
    if (existing) {
      out.push(existing);
      continue;
    }
    const membership: Membership = {
      tags: r.kind === "tag" ? [r.ref] : [],
      collections: r.kind === "collection" ? [r.ref] : [],
      metafields: r.kind === "metafield" ? [r.ref] : [],
      manual: r.kind === "product" ? [r.ref] : [],
    };
    const productIds = resolveMembership(membership, resolvable);
    const created = await prisma.category.create({
      data: {
        shopId: shop.id,
        quizId,
        name: r.name,
        description: "",
        tags: r.kind === "tag" ? [r.ref] : [],
        productIds,
        source: r.kind,
        sourceRef: r.ref,
        membership,
        discoveryRunId: `logic-tab-${quizId}`,
      },
    });
    out.push(created);
  }

  return json({
    ok: true,
    categories: out.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      tags: c.tags,
      productIds: c.productIds,
      source: c.source,
      sourceRef: c.sourceRef,
      quizId: c.quizId,
    })),
  });
}
