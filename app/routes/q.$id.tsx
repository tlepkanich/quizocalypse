import type { HeadersFunction, LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { QuizRuntime } from "../components/runtime/QuizRuntime";
import quizRuntimeStyles from "../styles/quiz-runtime.css?url";
import { buildRuntimePayload } from "../lib/runtimePayload.server";

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

  // Shared with /q/:id.embed.json (the DOM embed's data source) so the two
  // surfaces can never drift. See app/lib/runtimePayload.server.ts.
  const { payload, heroPreload } = await buildRuntimePayload(id, request);

  return json(payload, {
    // Same 60s convention as the JSON + launcher endpoints: a re-publish
    // propagates within a minute; SWR keeps repeat visits instant.
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      ...(heroPreload ? { Link: heroPreload } : {}),
    },
  });
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
