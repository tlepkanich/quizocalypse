import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildScopedIndex } from "../lib/catalogIndex";
import { generateQuiz, QuizGenerationError } from "../lib/claude";

// Spec §3.2: AI Quiz Generator. Input validated with Zod, then catalog summary
// + prompt go to Claude with forced tool-use. Output re-validated against the
// quiz schema. Retry policy is inside `generateQuiz`.
//
// Note on route name: spec §5.1 lists this as `POST /api/quizzes/:id/generate`.
// For the PoC we don't have a separate "create quiz" step yet, so this endpoint
// both creates and generates in one call. The full MVP splits these.

const FormSchema = z.object({
  collection_ids: z.array(z.string()).default([]),
  goal_prompt: z.string().trim().min(1).max(500),
  question_count: z.number().int().min(3).max(8),
});

function parseForm(form: FormData): z.infer<typeof FormSchema> | null {
  try {
    const raw = {
      collection_ids: JSON.parse(String(form.get("collection_ids") ?? "[]")),
      goal_prompt: String(form.get("goal_prompt") ?? ""),
      question_count: Number(form.get("question_count")),
    };
    const parsed = FormSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const input = parseForm(form);
  if (!input) {
    return json(
      { ok: false, error: "Invalid input. Check prompt length and question count." },
      { status: 400 },
    );
  }

  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) {
    return json({ ok: false, error: "Shop not found. Sync the catalog first." }, { status: 400 });
  }

  const [allProducts, allCollections] = await Promise.all([
    prisma.product.findMany({ where: { shopId: shop.id } }),
    prisma.collection.findMany({ where: { shopId: shop.id } }),
  ]);

  const index = buildScopedIndex(
    allProducts,
    allCollections,
    input.collection_ids,
  );

  if (index.products.length === 0) {
    return json(
      { ok: false, error: "No products in the selected collections." },
      { status: 400 },
    );
  }

  const quiz = await prisma.quiz.create({
    data: {
      shopId: shop.id,
      name: input.goal_prompt.slice(0, 80),
      status: "draft",
      draftJson: {},
    },
  });

  try {
    const draftJson = await generateQuiz({
      quizId: quiz.id,
      goalPrompt: input.goal_prompt,
      questionCount: input.question_count,
      collectionIds: input.collection_ids,
      catalogSummary: index.summary,
    });

    await prisma.quiz.update({
      where: { id: quiz.id },
      data: { draftJson: draftJson as never },
    });

    return json({ ok: true, quizId: quiz.id, draftJson });
  } catch (err) {
    if (err instanceof QuizGenerationError) {
      return json(
        {
          ok: false,
          error: `${err.message} Last issue: ${err.lastValidationIssue ?? "unknown"}`,
          attempts: err.attempts,
        },
        { status: 502 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
