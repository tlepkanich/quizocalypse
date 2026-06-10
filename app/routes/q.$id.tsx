import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import type { IndexedProduct } from "../lib/recommendationEngine";
import { QuizRuntime } from "../components/runtime/QuizRuntime";

// Public shopper-facing runtime. No Polaris, no Shopify auth — this is what a
// real customer sees when the merchant shares the quiz link. Spec §3.6. The
// interactive runtime itself is the shared <QuizRuntime> component (also used by
// the builder's Preview step in mode="preview"); this route owns only the loader
// (publishedJson) and the thin live wrapper.

// Warm up the font origins before the runtime's in-tree Google Fonts <link>
// resolves — saves the DNS/TLS round-trips on first paint (best-in-class P1).
export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
];

// Pass the loader's Cache-Control through to the document response. Loader-set
// (not static) so thrown 404s ("not published") are never publicly cached.
export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id } = params;
  if (!id) throw new Response("Missing id", { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      publishedJson: true,
    },
  });
  if (!quiz) throw new Response("Quiz not found", { status: 404 });
  if (!quiz.publishedJson) {
    throw new Response("Quiz not yet published", { status: 404 });
  }

  const parsed = Quiz.safeParse(quiz.publishedJson);
  if (!parsed.success) {
    throw new Response("Published JSON failed validation", { status: 500 });
  }
  // product_index + shop_domain + answer_weights aren't in the Zod schema
  // (added at publish time).
  const publishedRaw = quiz.publishedJson as {
    product_index?: IndexedProduct[];
    shop_domain?: string;
    answer_weights?: Record<string, number>;
  };

  // BIC P7: publish copies the draft, so the merchant's pasted review/FAQ
  // source would otherwise ship to every shopper page load — strip it. The
  // omitted-optional shape still satisfies the runtime's QuizDoc.
  const { review_enrichment_sources: _editorOnly, ...publicDoc } = parsed.data;
  void _editorOnly;

  return json(
    {
      quizId: quiz.id,
      name: quiz.name,
      version: quiz.version,
      doc: publicDoc,
      productIndex: publishedRaw.product_index ?? [],
      designTokens: parsed.data.design_tokens ?? null,
      designOverrides: parsed.data.design_overrides ?? {},
      breakpointOverrides: parsed.data.breakpoint_overrides ?? {},
      resultLayoutMode: parsed.data.result_layout_mode,
      shopDomain: publishedRaw.shop_domain ?? "",
      answerWeights: publishedRaw.answer_weights ?? null,
    },
    {
      // Same 60s convention as the JSON + launcher endpoints: a re-publish
      // propagates within a minute; SWR keeps repeat visits instant.
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    },
  );
};

export default function StorefrontRuntime() {
  const data = useLoaderData<typeof loader>();
  return (
    <QuizRuntime
      mode="live"
      doc={data.doc}
      productIndex={data.productIndex}
      designTokens={data.designTokens}
      designOverrides={data.designOverrides}
      breakpointOverrides={data.breakpointOverrides}
      resultLayoutMode={data.resultLayoutMode}
      quizId={data.quizId}
      version={data.version}
      shopDomain={data.shopDomain}
      answerWeights={data.answerWeights}
    />
  );
}
