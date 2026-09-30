import { json, type ActionFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import prisma from "../db.server";
import { resolveApiShop } from "../lib/studioAccess.server";
import {
  resolveMembership,
  type Membership,
  type ResolvableProduct,
  metafieldValuesOf,
} from "../lib/groupMembership";
import { loadBucketInputs } from "../lib/bucketPersist.server";
import { bucketRowFor, type BucketType } from "../lib/bucketPersist";
import { normalizeTags } from "../lib/enrichTags";

// ════════════════════════════════════════════════════════════════════════════
// Logic tab (HANDOFF §4.3 "one resource index" + DECISIONS G1; Logic step
// redesign D15) — ensure a quiz-scoped Category row exists for each picked
// resource, so a rule can target tags / collections / products / custom
// groups directly, and so "Add recommendations" can add them to the quiz.
// A rule target must be a Category id (the publish gate fetches the rows and
// BLOCKS on missing ones).
//
// D15 (owner 2026-09-22):
//   • kinds tag | collection | product | group resolve through STEP 1's
//     resolver (bucketRowFor over loadBucketInputs), so a key added here and
//     the same key added on the Recommendations step produce the same row:
//     tags are matched as Step-1 slugs (both sides normalized), a group is a
//     snapshot copy of the shop-global group (source "group", sourceRef = its
//     id), exactly as Step 1 copies it. The server names every row; the
//     client's `name` is accepted (old callers still send it) and ignored
//     for these kinds.
//   • metafield keeps the membership path (BucketType has no metafield; only
//     the builder's rule window sends it).
//   • rows are ALWAYS quiz-scoped: only a row of THIS quiz is reused (a
//     reused shop-global row has quizId null and never shows in the strip,
//     the tray or the rule window's band).
//   • 1–12 resources per call; the client batches.
//   • empty or missing items are skipped WITH a reason, never written empty.
//   • response: one result per input, in input order — { kind, ref,
//     category } or { kind, ref, skipped } — plus `categories` (the rows
//     that exist now, input order, skips omitted) for the older lift.
//
// ADDITIVE + idempotent: an existing quiz row for the same (source,
// sourceRef) is reused, never duplicated. Nothing is deleted here. Every row
// carries discoveryRunId `logic-tab-<quizId>`, which is what makes it
// survive Step 1's re-group and set-buckets (step1Build.server.ts,
// bucketPersist.ts isLogicTabTarget).
// ════════════════════════════════════════════════════════════════════════════

const ENSURE_TARGETS_MAX = 12;

const ResourceSchema = z.object({
  // "metafield" refs use the membership convention "key: value" (the same
  // string metafieldValuesOf produces — groupMembership matches exact).
  // "group" refs are the id of a shop-global Category (quizId null).
  kind: z.enum(["tag", "collection", "product", "metafield", "group"]),
  ref: z.string().min(1).max(500),
  name: z.string().min(1).max(200).optional(),
});

const BodySchema = z.object({
  quizId: z.string().min(1),
  resources: z.array(ResourceSchema).min(1).max(ENSURE_TARGETS_MAX),
});

type Resource = z.infer<typeof ResourceSchema>;

/** Why a resource was not added. The client words it; never a guess. */
type EnsureSkipReason = "empty" | "not_found";

type CategoryRow = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  productIds: string[];
  source: string;
  sourceRef: string | null;
  quizId: string | null;
};

const slug = (raw: string): string => normalizeTags([raw], new Set())[0] ?? "";

/** Whether an existing quiz row is the row for this resource (identity is
 *  (source, sourceRef), never the name). Tags compare as Step-1 slugs, so a
 *  row an older window wrote with a raw tag still counts; a smart
 *  collection counts as a collection. */
function sameResource(row: Pick<CategoryRow, "source" | "sourceRef">, r: Resource): boolean {
  if (!row.sourceRef) return false;
  switch (r.kind) {
    case "tag":
      return row.source === "tag" && (row.sourceRef === r.ref || slug(row.sourceRef) === slug(r.ref));
    case "collection":
      return (row.source === "collection" || row.source === "smart_collection") && row.sourceRef === r.ref;
    default:
      return row.source === r.kind && row.sourceRef === r.ref;
  }
}

const toClient = (c: CategoryRow): CategoryRow => ({
  id: c.id,
  name: c.name,
  description: c.description,
  tags: c.tags,
  productIds: c.productIds,
  source: c.source,
  sourceRef: c.sourceRef,
  quizId: c.quizId,
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

  // This quiz's rows, the only rows ever reused (D15). Rows created below
  // join the list, so the same key twice in one call returns one row.
  const quizRows: CategoryRow[] = await prisma.category.findMany({
    where: { shopId: shop.id, quizId },
    select: {
      id: true,
      name: true,
      description: true,
      tags: true,
      productIds: true,
      source: true,
      sourceRef: true,
      quizId: true,
    },
  });

  const needsBuckets = resources.some((r) => r.kind !== "metafield");
  const inputs = needsBuckets ? await loadBucketInputs(shop.id) : null;
  let resolvable: ResolvableProduct[] | null = null;
  const metafieldProducts = async (): Promise<ResolvableProduct[]> => {
    if (resolvable) return resolvable;
    const products = await prisma.product.findMany({
      where: { shopId: shop.id },
      select: { productId: true, tags: true, collectionIds: true, metafields: true },
    });
    resolvable = products.map((p) => ({
      id: p.productId,
      tags: p.tags,
      collectionIds: p.collectionIds,
      metafieldValues: metafieldValuesOf(p.metafields),
    }));
    return resolvable;
  };

  type Result =
    | { kind: Resource["kind"]; ref: string; category: CategoryRow }
    | { kind: Resource["kind"]; ref: string; skipped: EnsureSkipReason };
  const results: Result[] = [];

  for (const r of resources) {
    const existing = quizRows.find((row) => sameResource(row, r));
    if (existing) {
      results.push({ kind: r.kind, ref: r.ref, category: toClient(existing) });
      continue;
    }

    let data: {
      name: string;
      tags: string[];
      productIds: string[];
      source: string;
      sourceRef: string;
      membership?: Membership;
    } | null = null;
    let reason: EnsureSkipReason = "empty";

    if (r.kind === "metafield") {
      const membership: Membership = { tags: [], collections: [], metafields: [r.ref], manual: [] };
      const productIds = resolveMembership(membership, await metafieldProducts());
      if (productIds.length > 0) {
        data = {
          name: r.name ?? r.ref,
          tags: [],
          productIds,
          source: "metafield",
          sourceRef: r.ref,
          membership,
        };
      }
    } else if (inputs) {
      const type: BucketType = r.kind;
      const row = bucketRowFor(
        type,
        r.ref,
        inputs.products,
        inputs.collections,
        inputs.productTitleById,
        inputs.collectionTitleById,
        inputs.groups,
      );
      if (row) {
        data = {
          name: row.name,
          tags: row.tags,
          productIds: row.productIds,
          source: row.source,
          sourceRef: row.sourceRef,
        };
      } else if (type === "product") {
        reason = "not_found";
      } else if (type === "collection") {
        reason = inputs.collectionTitleById.has(r.ref) ? "empty" : "not_found";
      } else if (type === "group") {
        reason = inputs.groups.some((g) => g.id === r.ref) ? "empty" : "not_found";
      }
    }

    if (!data) {
      results.push({ kind: r.kind, ref: r.ref, skipped: reason });
      continue;
    }
    // The resolver may have canonicalised the key (a raw tag → its slug):
    // reuse a row that already holds the canonical key.
    const canonical = quizRows.find(
      (row) => row.source === data!.source && row.sourceRef === data!.sourceRef,
    );
    if (canonical) {
      results.push({ kind: r.kind, ref: r.ref, category: toClient(canonical) });
      continue;
    }
    const created: CategoryRow = await prisma.category.create({
      data: {
        shopId: shop.id,
        quizId,
        name: data.name,
        description: "",
        tags: data.tags,
        productIds: data.productIds,
        source: data.source,
        sourceRef: data.sourceRef,
        ...(data.membership ? { membership: data.membership } : {}),
        discoveryRunId: `logic-tab-${quizId}`,
      },
    });
    quizRows.push(created);
    results.push({ kind: r.kind, ref: r.ref, category: toClient(created) });
  }

  return json({
    ok: true,
    results,
    categories: results.flatMap((x) => ("category" in x ? [x.category] : [])),
  });
}
