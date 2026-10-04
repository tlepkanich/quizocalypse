import type { LoaderFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { loader } from "../routes/q.$id[.]json";

// HII-6 — pin the public .json wire round-trip end to end: the CORS-open,
// CDN-cacheable payload must NEVER carry the merchant's editor-only review/FAQ
// source text or the full multi-locale translation maps. stripPublicJsonPayload
// is unit-tested in isolation; this proves the ROUTE actually applies it (a
// refactor dropping the call would turn this red instead of leaking to shoppers).
// Lives in app/lib (not app/routes) per the Remix-route-test rule.
vi.mock("../db.server", () => ({
  default: { quiz: { findFirst: vi.fn() } },
}));

const p = prisma as unknown as { quiz: { findFirst: Mock } };

function loaderArgs(id: string | undefined): LoaderFunctionArgs {
  const request = new Request(`https://shop.example/q/${id}.json`);
  return { request, params: { id }, context: {} } as unknown as LoaderFunctionArgs;
}

beforeEach(() => {
  p.quiz.findFirst.mockReset();
});

describe("/q/:id.json public payload (HII-6 strip round-trip)", () => {
  it("strips review_enrichment_sources + translations, keeps the rest + CORS", async () => {
    p.quiz.findFirst.mockResolvedValue({
      status: "published",
      publishedJson: {
        quiz_id: "q1",
        nodes: [{ id: "intro" }],
        product_index: [{ product_id: "p1" }],
        review_enrichment_sources: { text: "secret pasted reviews", url: "https://x" },
        translations: { fr: { strings: { a: "Bonjour" } } },
        design_tokens: { colors: { primary: "#111" } },
      },
    });
    const res = await loader(loaderArgs("q1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = JSON.parse(await res.text());
    expect(body).not.toHaveProperty("review_enrichment_sources");
    expect(body).not.toHaveProperty("translations");
    expect(body.quiz_id).toBe("q1");
    expect(body.product_index).toEqual([{ product_id: "p1" }]);
    expect(body.design_tokens).toEqual({ colors: { primary: "#111" } });
  });

  it("never serves integration credentials or decider discount codes", async () => {
    p.quiz.findFirst.mockResolvedValue({
      status: "published",
      publishedJson: {
        quiz_id: "q1",
        logic_model: "decider",
        nodes: [
          {
            id: "int",
            type: "integration",
            data: { actions: [{ kind: "klaviyo", api_key: "pk_live_x", label: "K" }] },
          },
        ],
        discount_config: { enabled: true, code: "QUIZ-AAAAAA", static_code: "S10" },
      },
    });
    const text = await (await loader(loaderArgs("q1"))).text();
    expect(text).not.toContain("pk_live_x");
    expect(text).not.toContain("QUIZ-AAAAAA");
    expect(text).not.toContain("S10");
  });

  it("404s when the quiz is missing or has no publishedJson (unpublished)", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    expect((await loader(loaderArgs("missing"))).status).toBe(404);
    p.quiz.findFirst.mockResolvedValue({ status: "draft", publishedJson: null });
    expect((await loader(loaderArgs("draft1"))).status).toBe(404);
  });

  it("400s on a missing id param (before any DB hit)", async () => {
    expect((await loader(loaderArgs(undefined))).status).toBe(400);
    expect(p.quiz.findFirst).not.toHaveBeenCalled();
  });
});

// /q/:id.embed.json is newer than the credential strip; it rides the same
// stripPublicDoc seam (runtimePayload.server.ts) — pin that it stays there.
describe("/q/:id.embed.json public payload (credential + code redaction)", () => {
  it("serves no integration credentials and no decider discount code", async () => {
    const { Quiz } = await import("./quizSchema");
    const { loader: embedLoader } = await import("../routes/q.$id[.]embed[.]json");
    const doc = Quiz.parse({
      quiz_id: "e1",
      logic_model: "decider",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        {
          id: "int",
          type: "integration",
          position: { x: 1, y: 0 },
          data: {
            actions: [
              { kind: "klaviyo", api_key: "pk_embed_secret" },
              { kind: "webhook", url: "https://hook.example", secret: "embed-shh" },
            ],
          },
        },
      ],
      edges: [],
      discount_config: { enabled: true, code: "QUIZ-EMBED1" },
    });
    p.quiz.findFirst.mockResolvedValue({
      id: "e1",
      name: "Embed",
      status: "published",
      version: 1,
      publishedJson: { ...doc, product_index: [], shop_domain: "s.myshopify.com" },
      shop: { aiRecCopyEnabled: true },
    });
    const request = new Request("https://app.example/q/e1.embed.json");
    const res = await embedLoader({ request, params: { id: "e1" }, context: {} } as unknown as LoaderFunctionArgs);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"integration"');
    expect(text).not.toContain("pk_embed_secret");
    expect(text).not.toContain("embed-shh");
    expect(text).not.toContain("QUIZ-EMBED1");
  });
});

// AI-written personalization is opt-in: the loader key the runtime reads is
// true ONLY when the shop turned the switch on.
describe("runtime payload aiCopyEnabled (opt-in)", () => {
  it.each([
    ["the shop turned it on", { aiRecCopyEnabled: true }, true],
    ["the shop left it off", { aiRecCopyEnabled: false }, false],
    ["the shop row is missing", null, false],
  ])("%s → %s", async (_label, shop, expected) => {
    const { Quiz } = await import("./quizSchema");
    const { loader: embedLoader } = await import("../routes/q.$id[.]embed[.]json");
    const doc = Quiz.parse({
      quiz_id: "e2",
      scope: { collection_ids: [] },
      nodes: [
        { id: "intro", type: "intro", position: { x: 0, y: 0 }, data: { headline: "Hi" } },
        { id: "end", type: "end", position: { x: 1, y: 0 }, data: { headline: "Bye" } },
      ],
      edges: [],
    });
    p.quiz.findFirst.mockResolvedValue({
      id: "e2",
      name: "Embed",
      status: "published",
      version: 1,
      publishedJson: { ...doc, product_index: [], shop_domain: "s.myshopify.com" },
      shop,
    });
    const request = new Request("https://app.example/q/e2.embed.json");
    const res = await embedLoader({ request, params: { id: "e2" }, context: {} } as unknown as LoaderFunctionArgs);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { aiCopyEnabled: boolean }).aiCopyEnabled).toBe(expected);
  });
});
