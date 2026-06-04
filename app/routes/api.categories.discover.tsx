// app/routes/api.categories.discover.tsx
// Discovers shopper-archetype categories for the active shop: reads the whole
// catalog, calls Claude to propose 5–9 categories, runs the deterministic
// tag-overlap assignment, and atomically overwrites the existing set. The
// discover → assign → persist core lives in lib/bucketDiscovery.server.ts so the
// onboarding orchestrator reuses the identical logic.

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { resolveApiShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { CategoryDiscoveryError } from "../lib/categoryDiscover";
import {
  discoverAndPersistBuckets,
  BucketDiscoveryError,
} from "../lib/bucketDiscovery.server";

// Pull an optional `quizId` from either a JSON or urlencoded/multipart body.
// Returns a trimmed non-empty quiz id, or null when the caller didn't scope
// the request (legacy whole-shop discovery). Tolerant of a missing/invalid
// body so the no-arg legacy call still works.
async function readQuizId(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const data = (await request.json()) as Record<string, unknown>;
      const raw = data.quizId;
      return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    }
    const form = await request.formData();
    const raw = form.get("quizId");
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
  } catch {
    return null;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }
  // Dual-auth: works from the embedded admin AND the standalone /studio surface.
  const shop = await resolveApiShop(request);

  // Optional quiz scope (mirrors /api/categories/group). When present the
  // discovered buckets are bound to this quiz and the destructive wipe only
  // clears this quiz's set; when absent, behavior is unchanged (legacy
  // /app/categories page wipes the shop-global set).
  const quizId = await readQuizId(request);
  if (quizId !== null) {
    const ownedQuiz = await prisma.quiz.findFirst({
      where: { id: quizId, shopId: shop.id },
      select: { id: true },
    });
    if (!ownedQuiz) {
      return json({ ok: false, error: "Quiz not found" }, { status: 404 });
    }
  }

  try {
    const { runId, buckets } = await discoverAndPersistBuckets(shop.id, quizId);
    return json({
      ok: true,
      runId,
      categories: buckets.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        tags: b.tags,
        productCount: b.productCount,
        rationale: b.rationale,
      })),
    });
  } catch (err) {
    if (err instanceof BucketDiscoveryError) {
      return json({ ok: false, error: err.message }, { status: err.status });
    }
    if (err instanceof CategoryDiscoveryError) {
      return json(
        {
          ok: false,
          error: `${err.message}${err.lastValidationIssue ? ` (${err.lastValidationIssue})` : ""}`,
        },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: msg }, { status: 500 });
  }
}
