import { json } from "@remix-run/node";
import type { Shop } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import { publishQuiz, PublishError } from "./quizPublish";
import { qrDataUrl } from "./qrCode.server";
import { ensureQuizDiscount } from "./discount.server";
import { regenerateQuestion, generateQuestionFlow, editQuiz, enrichFromReviews } from "./claude";
import { applyEditOps, outlineQuiz } from "./quizEdit";
import { applyReviewEnrichment, clampReviewText } from "./reviewEnrichment";
import { ingestWebsite } from "./websiteIngest.server";
import { applyQuestionFlow, type SmartBuildBucket } from "./smartBuild";
import { parseBrandGuidelinesSafe } from "./brandGuidelines";
import { buildScopedIndex, toneSampleFromCatalog } from "./catalogIndex";
import type { IndexedProduct } from "./recommendationEngine";

// ───────────────────────────────────────────────────────────────────────────
// Shared loader/action for the quiz editor — consumed by BOTH the React Flow
// canvas (app.quizzes.$id.tsx) and the Studio builder (app.quizzes.$id.studio
// .tsx) so the two front-ends never drift on save / publish / regenerate. This
// is the ONLY editor module that imports prisma / claude / authenticate.
// ───────────────────────────────────────────────────────────────────────────

// Loads everything the editor UI needs. Returns a plain object; the route wraps
// it in json() so `useLoaderData<typeof loader>` stays precisely typed.
export async function loadQuizEditorData(request: Request, id: string) {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  return loadQuizEditorDataForShop(shop, id, new URL(request.url).origin);
}

// Shop-resolved core of the loader — NO Shopify auth. The embedded route gets
// `shop` from authenticate.admin; the standalone /studio surface resolves it
// from the configured dev shop. Identical return shape either way.
export async function loadQuizEditorDataForShop(shop: Shop, id: string, origin: string) {
  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });

  // Shareable QR for the hosted quiz link (Phase E). Generated server-side so
  // `qrcode` stays out of the client bundle; the /q/<id> URL is stable pre- and
  // post-publish, so it's always ready for the publish banner.
  const previewUrl = `${origin}/q/${quiz.id}`;
  const qrCode = await qrDataUrl(previewUrl);

  const collections = await prisma.collection.findMany({
    where: { shopId: shop.id },
    select: { collectionId: true, title: true },
    orderBy: { title: "asc" },
  });

  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
  });
  const productIndex: IndexedProduct[] = products.map((p) => {
    const variants = (p.variants ?? []) as Array<{
      inventoryQuantity?: number | null;
    }>;
    return {
      product_id: p.productId,
      title: p.title,
      handle: p.handle,
      price: p.priceMin ? String(p.priceMin) : null,
      image_url: p.imageUrl,
      tags: p.tags,
      collection_ids: p.collectionIds,
      inventory_in_stock: variants.some(
        (v) => typeof v.inventoryQuantity === "number" && v.inventoryQuantity > 0,
      ),
    };
  });
  const catalogTags = [...new Set(products.flatMap((p) => p.tags))].sort((a, b) =>
    a.localeCompare(b),
  );

  const parsed = Quiz.safeParse(quiz.draftJson);

  // Step-1 buckets: this quiz's own Category rows, plus any legacy shop-global
  // (quizId = null) rows referenced by the draft's result nodes (so existing
  // AI-bound quizzes show their groups). Mapped to a lean, client-safe shape.
  const referencedCategoryIds = parsed.success
    ? parsed.data.nodes
        .filter((n) => n.type === "result" && n.data.category_id)
        .map((n) => (n.type === "result" ? (n.data.category_id as string) : ""))
        .filter(Boolean)
    : [];
  const categoryRows = await prisma.category.findMany({
    where: {
      shopId: shop.id,
      OR: [{ quizId: quiz.id }, { id: { in: referencedCategoryIds } }],
    },
    orderBy: { name: "asc" },
  });
  const categories = categoryRows.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    tags: c.tags,
    productIds: c.productIds,
    source: c.source,
    sourceRef: c.sourceRef,
    quizId: c.quizId,
  }));

  const brandVoiceName = parseBrandGuidelinesSafe(shop.brandGuidelines)?.name ?? null;

  return {
    quizId: quiz.id,
    name: quiz.name,
    status: quiz.status,
    version: quiz.version,
    valid: parsed.success,
    issues: parsed.success
      ? []
      : parsed.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
    doc: parsed.success ? parsed.data : null,
    rawJson: quiz.draftJson,
    collections,
    catalogTags,
    productIndex,
    categories,
    brandVoiceName,
    previewUrl,
    qrCode,
  };
}

// Handles the editor's three intents: JSON PUT autosave, publish, and
// regenerate-node. Returns the json() Response directly (the route just
// forwards it), preserving the precise action-data union for useFetcher.
export async function handleQuizEditorAction(request: Request, id: string) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });
  return handleQuizEditorActionForShop(shop, id, request, () => Promise.resolve(admin));
}

// Shop-resolved core of the action — NO Shopify auth. `getAdmin` is a lazy
// Admin API client used ONLY by the publish intent's discount creation; the
// embedded route passes its live admin, the standalone surface an offline one
// (via unauthenticated.admin). Everything else is shop-scoped Prisma + pure.
export async function handleQuizEditorActionForShop(
  shop: Shop,
  id: string,
  request: Request,
  getAdmin: () => Promise<Parameters<typeof ensureQuizDiscount>[0]>,
) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { doc: unknown };
    const parsed = Quiz.safeParse(body.doc);
    if (!parsed.success) {
      return json(
        {
          ok: false,
          error: "Invalid quiz document",
          issues: parsed.error.issues.slice(0, 5),
        },
        { status: 400 },
      );
    }
    await prisma.quiz.update({
      where: { id },
      data: { draftJson: parsed.data as never },
    });
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "publish") {
    try {
      // Create the recommendation discount (if enabled + not yet created) and
      // persist its code to the draft so publishQuiz bakes it into
      // publishedJson. Discount failures don't block publishing.
      let discountWarning: string | undefined;
      const draft = await prisma.quiz.findFirst({
        where: { id, shopId: shop.id },
        select: { draftJson: true },
      });
      const parsedDraft = draft ? Quiz.safeParse(draft.draftJson) : null;
      if (
        parsedDraft?.success &&
        parsedDraft.data.discount_config.enabled &&
        !parsedDraft.data.discount_config.code
      ) {
        try {
          const ensured = await ensureQuizDiscount(await getAdmin(), parsedDraft.data);
          discountWarning = ensured.warning;
          if (ensured.code) {
            await prisma.quiz.update({
              where: { id },
              data: { draftJson: ensured.doc as never },
            });
          }
        } catch {
          // getAdmin() can fail on the standalone surface if no offline session
          // is stored for the shop. Never block publish on it — degrade to a
          // warning and ship without the discount code.
          discountWarning =
            "Couldn't create the discount code (Shopify admin unavailable). Published without it — re-publish from the embedded app to add it.";
        }
      }

      const result = await publishQuiz(prisma, { quizId: id, shopId: shop.id });
      return json({
        ok: true,
        action: "publish" as const,
        version: result.version,
        productCount: result.productCount,
        ...(discountWarning ? { warning: discountWarning } : {}),
      });
    } catch (err) {
      if (err instanceof PublishError) {
        return json(
          { ok: false, error: err.message, issues: err.issues },
          { status: 400 },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: message }, { status: 500 });
    }
  }

  if (intent === "regenerate-node") {
    const nodeId = String(form.get("nodeId") ?? "");
    const steeringPrompt = String(form.get("steeringPrompt") ?? "");

    const quiz = await prisma.quiz.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });

    const parsed = Quiz.safeParse(quiz.draftJson);
    if (!parsed.success) {
      return json({ ok: false, error: "Invalid quiz JSON" }, { status: 400 });
    }
    const doc = parsed.data;
    const target = doc.nodes.find((n) => n.id === nodeId && n.type === "question");
    if (!target || target.type !== "question") {
      return json({ ok: false, error: "Question node not found" }, { status: 404 });
    }

    const [allProducts, allCollections] = await Promise.all([
      prisma.product.findMany({ where: { shopId: shop.id } }),
      prisma.collection.findMany({ where: { shopId: shop.id } }),
    ]);
    const indexed = buildScopedIndex(
      allProducts,
      allCollections,
      doc.scope.collection_ids,
    );

    const brandGuidelines = parseBrandGuidelinesSafe(shop.brandGuidelines);

    let regen;
    try {
      regen = await regenerateQuestion({
        catalogSummary: indexed.summary,
        existingQuestion: target.data,
        steeringPrompt,
        ...(brandGuidelines ? { brandGuidelines } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: message }, { status: 502 });
    }

    const oldAnswers = target.data.answers;
    const mergedAnswers = regen.answers.map((newA, idx) => {
      const oldA = oldAnswers[idx];
      const aid = oldA?.id ?? `a_${Math.random().toString(36).slice(2, 10)}`;
      const handle =
        oldA?.edge_handle_id ?? `h_${Math.random().toString(36).slice(2, 10)}`;
      return {
        id: aid,
        text: newA.text,
        tags: newA.tags,
        ...(newA.collection_filter ? { collection_filter: newA.collection_filter } : {}),
        ...(newA.image_url ? { image_url: newA.image_url } : {}),
        edge_handle_id: handle,
      };
    });

    const handlesNow = new Set(mergedAnswers.map((a) => a.edge_handle_id));
    const prunedEdges = doc.edges.filter(
      (e) =>
        e.source !== nodeId || !e.source_handle || handlesNow.has(e.source_handle),
    );

    const updatedNode = {
      ...target,
      data: {
        ...target.data,
        text: regen.text,
        question_type: regen.question_type,
        required: regen.required,
        ...(regen.max_selections !== undefined
          ? { max_selections: regen.max_selections }
          : {}),
        answers: mergedAnswers,
      },
    };

    const updatedDoc = {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === nodeId ? updatedNode : n)),
      edges: prunedEdges,
    };

    const reparsed = Quiz.safeParse(updatedDoc);
    if (!reparsed.success) {
      return json(
        {
          ok: false,
          error:
            "Regenerated question failed schema validation: " +
            reparsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
        },
        { status: 500 },
      );
    }

    await prisma.quiz.update({
      where: { id },
      data: { draftJson: reparsed.data as never },
    });

    return json({
      ok: true,
      action: "regenerate-node" as const,
      doc: reparsed.data,
    });
  }

  if (intent === "rename") {
    const name = String(form.get("name") ?? "").trim().slice(0, 120);
    if (!name) return json({ ok: false, error: "Name is required" }, { status: 400 });
    await prisma.quiz.update({ where: { id }, data: { name } });
    return json({ ok: true, action: "rename" as const, name });
  }

  if (intent === "generate-questions") {
    const goalPrompt = String(form.get("goalPrompt") ?? "").slice(0, 500);
    const qcRaw = Number(form.get("questionCount"));
    const questionCount = Number.isFinite(qcRaw)
      ? Math.min(8, Math.max(3, Math.round(qcRaw)))
      : 5;
    const toneRaw = String(form.get("tone") ?? "friendly");
    const tone = (
      ["friendly", "editorial", "playful", "professional"].includes(toneRaw)
        ? toneRaw
        : "friendly"
    ) as "friendly" | "editorial" | "playful" | "professional";
    let flow = { welcome_message: false, email_gate: false, mixed_input_types: false };
    try {
      const raw = form.get("flow");
      if (typeof raw === "string" && raw) {
        const p = JSON.parse(raw) as Partial<typeof flow>;
        flow = {
          welcome_message: Boolean(p.welcome_message),
          email_gate: Boolean(p.email_gate),
          mixed_input_types: Boolean(p.mixed_input_types),
        };
      }
    } catch {
      // malformed flow JSON → keep defaults
    }

    const quiz = await prisma.quiz.findFirst({ where: { id, shopId: shop.id } });
    if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });
    const parsedDoc = Quiz.safeParse(quiz.draftJson);
    if (!parsedDoc.success) {
      return json({ ok: false, error: "Invalid quiz JSON" }, { status: 400 });
    }
    const doc = parsedDoc.data;

    // Buckets = each result node's bound Category (quiz-scoped, or legacy
    // referenced by category_id). Smart Build routes the questions to these.
    const resultNodes = doc.nodes.filter((n) => n.type === "result");
    const referencedCategoryIds = resultNodes
      .map((n) => (n.type === "result" ? n.data.category_id : undefined))
      .filter((v): v is string => Boolean(v));
    const categoryRows = await prisma.category.findMany({
      where: {
        shopId: shop.id,
        OR: [{ quizId: id }, { id: { in: referencedCategoryIds } }],
      },
    });
    const catById = new Map(categoryRows.map((c) => [c.id, c]));
    const buckets: SmartBuildBucket[] = [];
    for (const n of resultNodes) {
      if (n.type !== "result" || !n.data.category_id) continue;
      const cat = catById.get(n.data.category_id);
      if (!cat) continue;
      buckets.push({ id: cat.id, name: cat.name, tags: cat.tags, resultNodeId: n.id });
    }
    if (buckets.length === 0) {
      return json(
        {
          ok: false,
          error:
            "Group products into at least one outcome bucket (Step 1) before generating questions.",
        },
        { status: 400 },
      );
    }

    const [allProducts, allCollections] = await Promise.all([
      prisma.product.findMany({ where: { shopId: shop.id } }),
      prisma.collection.findMany({ where: { shopId: shop.id } }),
    ]);
    const indexed = buildScopedIndex(allProducts, allCollections, doc.scope.collection_ids);
    const brandGuidelines = parseBrandGuidelinesSafe(shop.brandGuidelines);

    let generated;
    try {
      generated = await generateQuestionFlow({
        goalPrompt,
        questionCount,
        catalogSummary: indexed.summary,
        buckets: buckets.map((b) => ({ id: b.id, name: b.name, tags: b.tags })),
        flow,
        tone,
        toneSample: toneSampleFromCatalog(allProducts),
        ...(brandGuidelines ? { brandGuidelines } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: message }, { status: 502 });
    }

    const updatedDoc = applyQuestionFlow(doc, generated, buckets);
    const reparsed = Quiz.safeParse(updatedDoc);
    if (!reparsed.success) {
      return json(
        {
          ok: false,
          error:
            "Generated flow failed schema validation: " +
            reparsed.error.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
        },
        { status: 500 },
      );
    }
    await prisma.quiz.update({ where: { id }, data: { draftJson: reparsed.data as never } });
    return json({ ok: true, action: "generate-questions" as const, doc: reparsed.data });
  }

  if (intent === "ai-edit") {
    const message = String(form.get("message") ?? "").trim().slice(0, 1200);
    if (!message) {
      return json({ ok: false, error: "Tell the assistant what to change." }, { status: 400 });
    }

    // Prior chat turns (plain text), for conversational context. Tolerant of
    // malformed input — bad history is ignored, never fatal.
    let history: Array<{ role: "user" | "assistant"; content: string }> = [];
    const rawHist = form.get("history");
    if (typeof rawHist === "string" && rawHist) {
      try {
        const p: unknown = JSON.parse(rawHist);
        if (Array.isArray(p)) {
          history = p
            .flatMap((m) => {
              if (m && typeof m === "object") {
                const role = (m as { role?: unknown }).role;
                const content = (m as { content?: unknown }).content;
                if ((role === "user" || role === "assistant") && typeof content === "string") {
                  return [{ role: role as "user" | "assistant", content }];
                }
              }
              return [];
            })
            .slice(-10);
        }
      } catch {
        // malformed history → ignore
      }
    }

    const quiz = await prisma.quiz.findFirst({ where: { id, shopId: shop.id } });
    if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });
    const parsedDoc = Quiz.safeParse(quiz.draftJson);
    if (!parsedDoc.success) {
      return json({ ok: false, error: "Invalid quiz JSON" }, { status: 400 });
    }
    const doc = parsedDoc.data;

    const [allProducts, allCollections] = await Promise.all([
      prisma.product.findMany({ where: { shopId: shop.id } }),
      prisma.collection.findMany({ where: { shopId: shop.id } }),
    ]);
    const indexed = buildScopedIndex(allProducts, allCollections, doc.scope.collection_ids);
    const brandGuidelines = parseBrandGuidelinesSafe(shop.brandGuidelines);

    let edit;
    try {
      edit = await editQuiz({
        outline: outlineQuiz(doc),
        catalogSummary: indexed.summary,
        message,
        history,
        toneSample: toneSampleFromCatalog(allProducts),
        ...(brandGuidelines ? { brandGuidelines } : {}),
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: m }, { status: 502 });
    }

    // Apply the ops deterministically, then gate on Quiz.parse. On failure we
    // return the error and DO NOT write — the stored draft is never corrupted.
    const { doc: edited, warnings } = applyEditOps(doc, edit.ops);
    const reparsed = Quiz.safeParse(edited);
    if (!reparsed.success) {
      return json(
        {
          ok: false,
          error:
            "That edit would have produced an invalid quiz, so it wasn't applied. Try rephrasing.",
          issues: reparsed.error.issues.slice(0, 3).map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 422 },
      );
    }

    await prisma.quiz.update({ where: { id }, data: { draftJson: reparsed.data as never } });
    return json({
      ok: true,
      action: "ai-edit" as const,
      doc: reparsed.data,
      assistant_message: edit.assistant_message,
      warnings,
    });
  }

  if (intent === "enrich-reviews") {
    // Reviews/FAQ ingestion (Dev Spec §3.2): rewrite answer wording + tooltips +
    // result why-bullets in the customers' own language. Accepts pasted text
    // and/or a URL (ingested server-side). Same safe seam as ai-edit — the AI
    // emits a structured enrichment over existing ids; we Quiz.parse-gate before
    // writing, so a bad enrichment never corrupts the stored draft.
    const pasted = String(form.get("reviews") ?? "");
    const reviewsUrl = String(form.get("reviewsUrl") ?? "").trim();
    let reviewText = clampReviewText(pasted);
    if (reviewsUrl) {
      const fetched = await ingestWebsite(reviewsUrl);
      reviewText = clampReviewText(`${pasted}\n${fetched}`);
    }
    if (reviewText.length < 20) {
      return json(
        { ok: false, error: "Paste some review or FAQ text (or a URL) to enrich from." },
        { status: 400 },
      );
    }

    const quiz = await prisma.quiz.findFirst({ where: { id, shopId: shop.id } });
    if (!quiz) return json({ ok: false, error: "Quiz not found" }, { status: 404 });
    const parsedDoc = Quiz.safeParse(quiz.draftJson);
    if (!parsedDoc.success) {
      return json({ ok: false, error: "Invalid quiz JSON" }, { status: 400 });
    }
    const doc = parsedDoc.data;

    const allProducts = await prisma.product.findMany({ where: { shopId: shop.id } });
    const brandGuidelines = parseBrandGuidelinesSafe(shop.brandGuidelines);

    let enrichment;
    try {
      enrichment = await enrichFromReviews({
        outline: outlineQuiz(doc),
        reviewText,
        toneSample: toneSampleFromCatalog(allProducts),
        ...(brandGuidelines ? { brandGuidelines } : {}),
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return json({ ok: false, error: m }, { status: 502 });
    }

    const { doc: enriched, changed } = applyReviewEnrichment(doc, enrichment);
    const reparsed = Quiz.safeParse(enriched);
    if (!reparsed.success) {
      return json(
        {
          ok: false,
          error: "That enrichment would have produced an invalid quiz, so it wasn't applied.",
        },
        { status: 422 },
      );
    }
    await prisma.quiz.update({ where: { id }, data: { draftJson: reparsed.data as never } });
    return json({
      ok: true,
      action: "enrich-reviews" as const,
      doc: reparsed.data,
      assistant_message:
        enrichment.summary || `Updated ${changed} item(s) using your reviews.`,
      changed,
    });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
}
