import prisma from "../db.server";
import { Quiz } from "./quizSchema";
import type { IndexedProduct } from "./recommendationEngine";
import { applyTranslations, parseLocaleParam, resolveLocale } from "./quizTranslate";
import { stripPublicDoc } from "./quizPublish";
import { imagePreloadLinkHeader } from "./imagePreload";
import { chromeFor } from "../components/runtime/chromeStrings";

// The ONE place the shopper runtime's props are assembled.
//
// This was the body of the /q/:id loader. The DOM embed needs the exact same
// 19 props, but as JSON fetched cross-origin instead of as a Remix loader
// payload — and /q/:id.json cannot serve it (it serves the stripped public
// doc, and its bytes are pinned at c02ccaec98a0fe9e; that route must not move).
//
// Pure move: the logic below is verbatim from the loader, so the /q HTML stays
// byte-identical. Both callers now share this seam — a drift between what the
// iframe renders and what the DOM embed renders is structurally impossible.

export async function buildRuntimePayload(id: string, request: Request) {
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
  // the og tags via `meta`) gets translated copy in the document itself.
  // Explicit ?locale= only (cache-safe: query params are distinct HTTP cache
  // keys); exact match → language-prefix → default English.
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
  // only, ZERO DOM change. https-only + header-safe encoding enforced by the
  // helper; anything odd → no header.
  const introNode = publicDoc.nodes.find((n) => n.type === "intro");
  const heroPreload =
    introNode?.type === "intro"
      ? imagePreloadLinkHeader(introNode.data.hero_image_url)
      : null;

  return {
    payload: {
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
    heroPreload,
  };
}
