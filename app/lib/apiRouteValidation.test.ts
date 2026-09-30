import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { action as groupAction } from "../routes/api.categories.group";
import { action as enrichAction } from "../routes/api.products.enrich";
import { action as ensureAction } from "../routes/api.categories.ensure-targets";

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
    category: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
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
  category: { deleteMany: Mock; createMany: Mock; findMany: Mock; create: Mock };
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

// ── Logic step redesign D15 — ensure-targets ("+ Add recommendations") ────
describe("api.categories.ensure-targets — D15", () => {
  type Row = {
    id: string;
    name: string;
    description: string;
    tags: string[];
    productIds: string[];
    source: string;
    sourceRef: string | null;
    quizId: string | null;
  };
  const CATALOG = [
    { productId: "p0", title: "Balm", tags: ["Dry Skin"], productType: "", collectionIds: ["c1"], metafields: null },
    { productId: "p1", title: "Serum", tags: ["dry skin", "Glow"], productType: "", collectionIds: ["c1"], metafields: null },
    { productId: "p2", title: "Toner", tags: [], productType: "", collectionIds: [], metafields: null },
  ];
  let quizRows: Row[];
  let globalRows: Array<{ id: string; name: string; tags: string[]; productIds: string[] }>;
  let seq: number;

  beforeEach(() => {
    quizRows = [];
    globalRows = [
      { id: "g1", name: "Winter kit", tags: ["winter"], productIds: ["p0", "p2"] },
      { id: "g0", name: "Empty group", tags: [], productIds: [] },
    ];
    seq = 0;
    p.quiz.findFirst.mockResolvedValue({ id: "qz" });
    p.product.findMany.mockResolvedValue(CATALOG);
    p.collection.findMany.mockResolvedValue([
      { collectionId: "c1", title: "Face care" },
      { collectionId: "c9", title: "Empty shelf" },
    ]);
    p.category.findMany.mockImplementation(async (args: { where: { quizId: string | null } }) =>
      args.where.quizId === null ? globalRows : quizRows,
    );
    p.category.create.mockImplementation(async ({ data }: { data: Omit<Row, "id"> }) => {
      const row = { id: `new${++seq}`, ...data } as Row;
      return row;
    });
  });

  const post = async (resources: unknown[]) => {
    const res = await ensureAction(jsonPost("api/categories/ensure-targets", { quizId: "qz", resources }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it("rejects 13 resources (the client batches at 12)", async () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => ({ kind: "product", ref: `p${i}` }));
    expect((await post(thirteen)).status).toBe(400);
    expect(p.category.create).not.toHaveBeenCalled();
  });

  it("accepts the new group kind without a name", async () => {
    const { status, body } = await post([{ kind: "group", ref: "g1" }]);
    expect(status).toBe(200);
    const results = body.results as Array<{ category?: Row }>;
    expect(results[0]!.category).toMatchObject({
      name: "Winter kit",
      source: "group",
      sourceRef: "g1",
      tags: ["winter"],
      productIds: ["p0", "p2"],
      quizId: "qz",
    });
    const data = p.category.create.mock.calls[0]![0].data;
    expect(data.discoveryRunId).toBe("logic-tab-qz");
  });

  it("resolves a slug tag against raw catalogue tags of any casing, named by the server", async () => {
    const { body } = await post([{ kind: "tag", ref: "dry-skin", name: "ignored" }]);
    const row = (body.results as Array<{ category: Row }>)[0]!.category;
    expect(row.source).toBe("tag");
    expect(row.sourceRef).toBe("dry-skin");
    expect(row.productIds.sort()).toEqual(["p0", "p1"]);
    expect(row.name).not.toBe("ignored");
  });

  it("refuses empty or unknown items with a reason, keeping input order", async () => {
    const { body } = await post([
      { kind: "group", ref: "g0" },
      { kind: "product", ref: "p1" },
      { kind: "collection", ref: "c9" },
      { kind: "product", ref: "nope" },
    ]);
    const results = body.results as Array<{ ref: string; skipped?: string; category?: Row }>;
    expect(results.map((r) => r.ref)).toEqual(["g0", "p1", "c9", "nope"]);
    expect(results[0]!.skipped).toBe("empty");
    expect(results[1]!.category?.sourceRef).toBe("p1");
    expect(results[2]!.skipped).toBe("empty");
    expect(results[3]!.skipped).toBe("not_found");
    // A skip in the middle never shifts the surviving rows (B-case).
    expect((body.categories as Row[]).map((c) => c.sourceRef)).toEqual(["p1"]);
    expect(p.category.create).toHaveBeenCalledTimes(1);
  });

  it("reuses this quiz's row (raw tag, smart collection) and never a shop-global one", async () => {
    quizRows = [
      { id: "t1", name: "Dry Skin", description: "", tags: ["Dry Skin"], productIds: ["p0"], source: "tag", sourceRef: "Dry Skin", quizId: "qz" },
      { id: "s1", name: "Face care", description: "", tags: [], productIds: ["p0"], source: "smart_collection", sourceRef: "c1", quizId: "qz" },
    ];
    const { body } = await post([
      { kind: "tag", ref: "dry-skin" },
      { kind: "collection", ref: "c1" },
      { kind: "product", ref: "p2" },
    ]);
    const ids = (body.results as Array<{ category: Row }>).map((r) => r.category.id);
    expect(ids.slice(0, 2)).toEqual(["t1", "s1"]);
    expect(p.category.create).toHaveBeenCalledTimes(1);
    const scopes = p.category.findMany.mock.calls.map((c) => c[0].where.quizId);
    // The reuse lookup reads this quiz only (the null read is the Step-1
    // resolver's group list, never a reuse candidate).
    expect(scopes).toContain("qz");
    expect((body.results as Array<{ category: Row }>)[2]!.category.quizId).toBe("qz");
  });

  it("the same key sent twice returns the same row", async () => {
    const { body } = await post([
      { kind: "product", ref: "p0" },
      { kind: "product", ref: "p0" },
    ]);
    const ids = (body.results as Array<{ category: Row }>).map((r) => r.category.id);
    expect(ids[0]).toBe(ids[1]);
    expect(p.category.create).toHaveBeenCalledTimes(1);
  });

  it("404 on a quiz the shop does not own", async () => {
    p.quiz.findFirst.mockResolvedValue(null);
    expect((await post([{ kind: "product", ref: "p0" }])).status).toBe(404);
  });
});
