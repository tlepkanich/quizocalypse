import type { HeadersFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import type { IndexedProduct } from "../lib/recommendationEngine";
import { extractPersonaPages, findPersonaPage, productUrl } from "../lib/personaSeo";

// §M8.1/M8.3/M9 — the persona landing page. SSR + indexable (crawlable by
// default, unlike per-session result snapshots which are noindex). Generated
// entirely from the baked persona data (name/description/curated products), so
// it's near-zero extra authoring. Carries JSON-LD (ItemList + FAQPage) for rich
// results + answer-engine extraction (GEO). Self-contained styles — never the
// admin sheet.
export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id, slug } = params;
  if (!id || !slug) throw new Response("Not found", { status: 404 });
  const quiz = await prisma.quiz.findFirst({
    where: { id },
    select: { id: true, name: true, publishedJson: true },
  });
  if (!quiz?.publishedJson) throw new Response("Not found", { status: 404 });
  const raw = quiz.publishedJson as Parameters<typeof extractPersonaPages>[0] & {
    shop_domain?: string;
    platform?: "shopify" | "standalone";
  };
  const page = findPersonaPage(raw, slug);
  if (!page) throw new Response("Persona not found", { status: 404 });
  const siblings = extractPersonaPages(raw)
    .filter((p) => p.slug !== slug)
    .map((p) => ({ slug: p.slug, name: p.name }));
  const products = page.products.map((p) => ({
    ...p,
    url: productUrl(raw.shop_domain, p.handle, raw.platform),
  }));

  // §M9.3/M10.2 — "matched by N shoppers": distinct completed sessions whose
  // resolved target is THIS persona (a citable specific for answer engines +
  // social proof). Read-only aggregate over the recommendation_viewed events;
  // floored (E7) — shown only above a small threshold so it's never thin.
  const MATCH_FLOOR = 10;
  const matchedRows = await prisma.event.findMany({
    where: {
      quizId: id,
      eventType: "recommendation_viewed",
      payload: { path: ["resolved_target_id"], equals: page.targetId },
    },
    select: { sessionId: true },
    distinct: ["sessionId"],
    take: 100_000,
  });
  const matchedCount = matchedRows.length >= MATCH_FLOOR ? matchedRows.length : null;

  return json(
    { quizId: quiz.id, quizName: quiz.name, page: { ...page, products }, siblings, matchedCount },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60", "X-Robots-Tag": "index, follow" } },
  );
};

export const headers: HeadersFunction = ({ loaderHeaders }) => loaderHeaders;

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  if (!data) return [{ title: "Persona" }];
  const { page, quizName } = data;
  const title = `${page.name} — ${quizName}`;
  const description = page.description || `The ${page.name} pick: a curated set from ${quizName}.`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    ...(page.image ? [{ property: "og:image", content: page.image }] : []),
  ];
};

type ProductWithUrl = IndexedProduct extends unknown
  ? { title: string; handle: string; price: string | null; image: string | null; url: string }
  : never;

export default function PersonaPage() {
  const { quizId, page, siblings, matchedCount } = useLoaderData<typeof loader>();
  const products = page.products as ProductWithUrl[];
  const matchedLine = matchedCount ? `Matched by ${matchedCount.toLocaleString()} shoppers` : null;

  // JSON-LD — ItemList (the curated set) + FAQPage (the persona answer) for
  // rich results (M8.3) and answer-engine citation (M9.1/M9.2).
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ItemList",
        name: page.name,
        description: page.description || undefined,
        numberOfItems: products.length,
        itemListElement: products.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Product",
            name: p.title,
            url: p.url,
            ...(p.image ? { image: p.image } : {}),
            ...(p.price ? { offers: { "@type": "Offer", price: p.price, priceCurrency: "USD" } } : {}),
          },
        })),
      },
      ...(page.description
        ? [
            {
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: `What is ${page.name}?`,
                  acceptedAnswer: {
                    "@type": "Answer",
                    // §M9.3 — fold the citable "matched by N" specific into the answer.
                    text: matchedLine ? `${page.description} (${matchedLine.toLowerCase()}.)` : page.description,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };

  return (
    <main style={S.page}>
      {/* Escape `<` so a persona name/description containing `</script>` can't
          break out of the JSON-LD script element (defense-in-depth; the copy is
          merchant/AI-authored + baked, not shopper-supplied). */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
      <article style={S.wrap}>
        <p style={S.eyebrow}>Your match</p>
        <h1 style={S.h1}>{page.name}</h1>
        {matchedLine ? <p style={S.matched}>✦ {matchedLine}</p> : null}
        {page.description ? <p style={S.lede}>{page.description}</p> : null}
        <Link to={`/q/${quizId}`} style={S.cta}>Take the quiz →</Link>

        {products.length ? (
          <>
            <h2 style={S.h2}>{page.name} — the lineup</h2>
            <ul style={S.grid}>
              {products.map((p) => (
                <li key={p.handle} style={S.card}>
                  <a href={p.url} style={S.cardLink}>
                    {p.image ? <img src={p.image} alt={p.title} style={S.img} loading="lazy" /> : <div style={S.imgPh} aria-hidden />}
                    <span style={S.pTitle}>{p.title}</span>
                    {p.price ? <span style={S.pPrice}>${p.price}</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {siblings.length ? (
          <nav style={S.sibs} aria-label="Other results">
            <h2 style={S.h2}>Other results</h2>
            <ul style={S.sibList}>
              {siblings.map((s) => (
                <li key={s.slug}>
                  <Link to={`/q/${quizId}/persona/${s.slug}`} style={S.sibLink}>{s.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>
    </main>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", color: "#1b1a17", background: "#faf8f3", minHeight: "100vh", padding: "48px 20px" },
  wrap: { maxWidth: 960, margin: "0 auto" },
  eyebrow: { textTransform: "uppercase", letterSpacing: ".08em", fontSize: 12, color: "#8a857c", margin: 0 },
  h1: { fontSize: "clamp(30px, 6vw, 52px)", lineHeight: 1.05, margin: "6px 0 14px" },
  matched: { fontSize: 13, fontWeight: 700, color: "#6D5AE6", margin: "0 0 10px", letterSpacing: ".01em" },
  lede: { fontSize: 18, lineHeight: 1.55, color: "#3f3b34", maxWidth: 720 },
  cta: { display: "inline-block", marginTop: 10, background: "#6D5AE6", color: "#fff", padding: "12px 22px", borderRadius: 12, textDecoration: "none", fontWeight: 700 },
  h2: { fontSize: 22, margin: "40px 0 14px" },
  grid: { listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 18 },
  card: { border: "1px solid #ece9e2", borderRadius: 14, background: "#fff", overflow: "hidden" },
  cardLink: { display: "flex", flexDirection: "column", textDecoration: "none", color: "inherit", height: "100%" },
  img: { width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" },
  imgPh: { width: "100%", aspectRatio: "1 / 1", background: "#f0ede6" },
  pTitle: { fontSize: 14, fontWeight: 600, padding: "12px 14px 2px", lineHeight: 1.3 },
  pPrice: { fontSize: 13, color: "#6b665e", padding: "0 14px 14px" },
  sibs: { marginTop: 44, borderTop: "1px solid #ece9e2", paddingTop: 20 },
  sibList: { listStyle: "none", padding: 0, margin: 0, display: "flex", flexWrap: "wrap", gap: 10 },
  sibLink: { display: "inline-block", border: "1px solid #ddd8ce", borderRadius: 999, padding: "7px 15px", textDecoration: "none", color: "#3f3b34", fontWeight: 600, fontSize: 14 },
};
