import type { HeadersFunction, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import type { IndexedProduct } from "../lib/recommendationEngine";
import { QuizRuntime } from "../components/runtime/QuizRuntime";
import quizRuntimeStyles from "../styles/quiz-runtime.css?url";
import { applyTranslations, parseLocaleParam, resolveLocale } from "../lib/quizTranslate";
import { stripPublicDoc } from "../lib/quizPublish";
import { imagePreloadLinkHeader } from "../lib/imagePreload";
import { chromeFor } from "../components/runtime/chromeStrings";

// Public shopper-facing runtime. No Polaris, no Shopify auth — this is what a
// real customer sees when the merchant shares the quiz link. Spec §3.6. The
// interactive runtime itself is the shared <QuizRuntime> component (also used by
// the builder's Preview step in mode="preview"); this route owns only the loader
// (publishedJson) and the thin live wrapper.

// Warm up the font origins before the runtime's in-tree Google Fonts <link>
// resolves — saves the DNS/TLS round-trips on first paint (best-in-class P1).
// BIC-2 B1: quiz-runtime.css is the shopper-side sheet (base reset + the few
// straggler rules the runtime consumes) — the ~100KB admin sheet no longer
// ships on this path.
export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: quizRuntimeStyles },
];

// Pass the loader's headers through to the document response (Cache-Control +
// the optional hero-preload Link). Loader-set (not static) so thrown 404s
// ("not published") are never publicly cached.
export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

// Phase L1 — rich unfurls when the merchant shares the quiz link (socials,
// QR landings, DMs). Title/description come from the intro; the image is the
// intro hero if set, else the first product photo in the index.
export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Product quiz" }];
  const intro = data.doc.nodes.find((n) => n.type === "intro");
  const title = data.name || "Find your match";
  const description =
    (intro?.type === "intro" && (intro.data.subtext || intro.data.headline)) ||
    "Answer a few questions and get personalized product recommendations.";
  const image =
    (intro?.type === "intro" && intro.data.hero_image_url) ||
    data.productIndex.find((p) => p.image_url)?.image_url ||
    null;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    ...(image ? [{ property: "og:image", content: image }] : []),
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    ...(image ? [{ name: "twitter:image", content: image }] : []),
  ];
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
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
      // L2-12 — the per-shop runtime-AI kill switch; read live (never baked
      // into publishedJson) so a flip takes effect without a republish.
      shop: { select: { aiRecCopyEnabled: true } },
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
  // (added at publish time). LOGIC v2: the decider bake (target_product_ids_map
  // + target_index) is likewise publish-time-only — Quiz.safeParse strips it,
  // so it must be recovered from the raw JSON here (the answer_weights pattern).
  const publishedRaw = quiz.publishedJson as {
    product_index?: IndexedProduct[];
    shop_domain?: string;
    answer_weights?: Record<string, number>;
    platform?: "shopify" | "standalone";
    target_product_ids_map?: Record<string, string[]>;
    target_index?: Record<string, { type: "product" | "collection" | "tag"; name?: string }>;
  };

  // Phase K: resolve the requested locale against the quiz's translations and
  // apply the overlay SERVER-SIDE — the shopper (and every crawler reading
  // the og tags below via `meta`) gets translated copy in the document
  // itself. Explicit ?locale= only (cache-safe: query params are distinct
  // HTTP cache keys); exact match → language-prefix → default English.
  const requestedLocale = new URL(request.url).searchParams.get("locale");
  const available = Object.keys(parsed.data.translations ?? {});
  const locale = resolveLocale(parseLocaleParam(requestedLocale), available);

  // Phase L2 — a buddy invite carries the inviter's session id; the runtime
  // shows "see how you compare" once this shopper completes. Format-gated
  // only (it's an unguessable capability token, same as My Results).
  const buddyParam = new URL(request.url).searchParams.get("buddy");
  const buddySessionId =
    buddyParam && /^[A-Za-z0-9_-]{8,64}$/.test(buddyParam) ? buddyParam : null;
  const localized = locale
    ? applyTranslations(parsed.data, parsed.data.translations![locale]!.strings)
    : parsed.data;
  const chrome = chromeFor(locale ? parsed.data.translations![locale]!.strings : null);

  // BIC P7 + Phase K: publish copies the draft, so the merchant's pasted
  // review/FAQ source AND the full multi-locale translation maps would
  // otherwise ship to every shopper page load — strip both (the locale is
  // already applied above; the client never needs the raw maps).
  const publicDoc = stripPublicDoc(localized);

  // BIC-2 B2b — preload the intro hero (the LCP image on quizzes that set
  // one) via a `Link: <url>; rel=preload; as=image` response header. Header
  // only, ZERO DOM change: `links()` is static (it can't see loader data) and
  // a <link> element would alter the /q HTML. https-only + header-safe
  // encoding enforced by the helper; anything odd → no header.
  const introNode = publicDoc.nodes.find((n) => n.type === "intro");
  const heroPreload =
    introNode?.type === "intro"
      ? imagePreloadLinkHeader(introNode.data.hero_image_url)
      : null;

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
      // §5 — de-linked rec page renders result nodes from rec_page_design.
      designLinked: parsed.data.design_linked ?? true,
      recPageDesign: parsed.data.rec_page_design ?? null,
      shopDomain: publishedRaw.shop_domain ?? "",
      // QD-7 — pre-existing quizzes have no `platform` baked → "shopify", so the
      // shopper runtime keeps add-to-cart with zero re-publish (back-compat).
      platform: publishedRaw.platform ?? "shopify",
      answerWeights: publishedRaw.answer_weights ?? null,
      targetProductIdsMap: publishedRaw.target_product_ids_map ?? null,
      targetIndex: publishedRaw.target_index ?? null,
      locale: locale ?? "en",
      chrome,
      buddySessionId,
      // L2-12 — additive loader key (the L2-9 mechanism): lets the runtime
      // skip the rec-copy fetch entirely when the shop's switch is off. The
      // ENDPOINT re-checks the live column regardless (this value can lag the
      // 60s CDN window and a hand-rolled POST bypasses it).
      aiCopyEnabled: quiz.shop?.aiRecCopyEnabled ?? true,
    },
    {
      // Same 60s convention as the JSON + launcher endpoints: a re-publish
      // propagates within a minute; SWR keeps repeat visits instant.
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        ...(heroPreload ? { Link: heroPreload } : {}),
      },
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
      designLinked={data.designLinked}
      recPageDesign={data.recPageDesign}
      quizId={data.quizId}
      version={data.version}
      shopDomain={data.shopDomain}
      platform={data.platform}
      answerWeights={data.answerWeights}
      targetProductIdsMap={data.targetProductIdsMap}
      targetIndex={data.targetIndex}
      chrome={data.chrome}
      locale={data.locale}
      buddySessionId={data.buddySessionId}
      aiCopyEnabled={data.aiCopyEnabled}
    />
  );
}
