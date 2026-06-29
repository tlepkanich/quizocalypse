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
