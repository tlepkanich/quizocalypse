import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { action as groupAction } from "../routes/api.categories.group";
import { action as enrichAction } from "../routes/api.products.enrich";

// BIC-2 A2(e) — Zod at the boundary for the two previously-unvalidated api.*
// actions. Reject/accept per route, with the real callers' payload shapes
// (app.categories.tsx + Step1Products.tsx post source/groups/quizId to group;
// app._index.tsx posts an EMPTY form to enrich). Lives in app/lib per the
// publicWriteGuards precedent.

vi.mock("../db.server", () => ({
  default: {
    quiz: { findFirst: vi.fn() },
    product: { findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    collection: { findMany: vi.fn() },
    category: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    shop: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// group: dual-auth resolver → a fixed studio shop (auth is not under test).
vi.mock("./studioAccess.server", () => ({
  resolveApiShop: vi.fn().mockResolvedValue({ id: "s1" }),
}));

// enrich: shopify.server constructs shopifyApp() at module load (env-hungry);
// stub the whole module.
vi.mock("../shopify.server", () => ({
  authenticate: {
    admin: vi.fn().mockResolvedValue({
      session: { shop: "test.myshopify.com" },
      admin: { graphql: vi.fn() },
    }),
  },
}));

const p = prisma as unknown as {
  quiz: { findFirst: Mock };
  product: { findMany: Mock; count: Mock; update: Mock };
  collection: { findMany: Mock };
  category: { deleteMany: Mock; createMany: Mock; findMany: Mock };
  shop: { findUnique: Mock };
  $transaction: Mock;
};

function jsonPost(path: string, body: unknown): ActionFunctionArgs {
  const request = new Request(`https://studio.example/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

function formPost(path: string, fields: Record<string, string>): ActionFunctionArgs {
  const form = new URLSearchParams(fields);
  const request = new Request(`https://studio.example/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return { request, params: {}, context: {} } as unknown as ActionFunctionArgs;
}

const FIVE_PRODUCTS = Array.from({ length: 5 }, (_, i) => ({
  productId: `p${i}`,
  title: `Product ${i}`,
  tags: [],
  productType: "",
  collectionIds: [],
  metafields: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  p.product.findMany.mockResolvedValue(FIVE_PRODUCTS);
  p.collection.findMany.mockResolvedValue([]);
  p.$transaction.mockResolvedValue([]);
  p.category.findMany.mockResolvedValue([]);
});

describe("api.categories.group — Zod boundary", () => {
  it("400 + issues when source is missing (no business logic ran)", async () => {
    const res = await groupAction(jsonPost("api/categories/group", {}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; issues?: unknown[] };
    expect(body.ok).toBe(false);
    expect(body.issues?.length).toBeGreaterThan(0);
    expect(p.product.findMany).not.toHaveBeenCalled();
  });

  it("400 + issues on an unknown grouping source", async () => {
    const res = await groupAction(jsonPost("api/categories/group", { source: "bogus" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues?: unknown[] }).issues?.length).toBeGreaterThan(0);
  });

  it("400 when manual groups are structurally wrong (name not a string)", async () => {
    const res = await groupAction(
      jsonPost("api/categories/group", {
        source: "manual",
        groups: [{ name: 7, productIds: ["p1"] }],
      }),
    );
    expect(res.status).toBe(400);
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it("accepts the real manual-mode payload (JSON transport)", async () => {
    const res = await groupAction(
      jsonPost("api/categories/group", {
        source: "manual",
        groups: [{ name: "Boards", productIds: ["p1", "p2"] }],
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(p.$transaction).toHaveBeenCalledTimes(1);
  });

  it("accepts the real form-transport payload (tag source)", async () => {
    p.product.findMany.mockResolvedValue(
      FIVE_PRODUCTS.map((prod, i) => ({ ...prod, tags: [i < 3 ? "warm" : "cool"] })),
    );
    const res = await groupAction(formPost("api/categories/group", { source: "tag" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});

describe("api.products.enrich — Zod boundary", () => {
  beforeEach(() => {
    p.shop.findUnique.mockResolvedValue({ id: "s1" });
    p.product.findMany.mockResolvedValue([]);
    p.product.count.mockResolvedValue(0);
  });

  it("accepts the real caller's empty form post (no body params exist)", async () => {
    const res = await enrichAction(formPost("api/products/enrich", {}));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });

  it("400 on unparseable JSON", async () => {
    const res = await enrichAction(jsonPost("api/products/enrich", "{not json"));
    expect(res.status).toBe(400);
    expect(p.shop.findUnique).not.toHaveBeenCalled();
  });

  it("400 + issues on a non-object JSON body", async () => {
    const res = await enrichAction(jsonPost("api/products/enrich", '"a string"'));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues?: unknown[] }).issues?.length).toBeGreaterThan(0);
  });

  it("accepts an empty JSON object body", async () => {
    const res = await enrichAction(jsonPost("api/products/enrich", {}));
    expect(res.status).toBe(200);
  });
});
