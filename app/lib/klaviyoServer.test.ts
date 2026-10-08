import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import prisma from "../db.server";
import { connectKlaviyo, createKlaviyoSegment, shopKlaviyoKey } from "./klaviyo.server";
import { decrypt } from "./crypto";

vi.mock("../db.server", () => ({
  default: { shop: { findUnique: vi.fn(), update: vi.fn() }, quiz: { findMany: vi.fn() } },
}));
const p = prisma as unknown as { shop: { findUnique: Mock; update: Mock } };
const fetchMock = vi.fn();
const KEY = "pk_abcdefghijklmnopqrstuvwxyz0123";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TOKEN_ENCRYPTION_KEY = "b".repeat(64);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("connectKlaviyo", () => {
  it("checks the key with Klaviyo, then stores it ENCRYPTED with the account name", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ attributes: { contact_information: { organization_name: "Glow Co" } } }] })),
    );
    const r = await connectKlaviyo("shop1", ` ${KEY} `);
    expect(r).toEqual({ ok: true, accountName: "Glow Co" });
    const data = p.shop.update.mock.calls[0]![0].data as { klaviyoApiKey: string; klaviyoAccountName: string };
    expect(data.klaviyoApiKey).not.toContain("pk_");
    expect(decrypt(data.klaviyoApiKey)).toBe(KEY);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ revision: "2026-07-15" });
  });

  it("a key Klaviyo refuses is not saved", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const r = await connectKlaviyo("shop1", KEY);
    expect(r.ok).toBe(false);
    expect(p.shop.update).not.toHaveBeenCalled();
  });

  it("something that isn't a private key never reaches Klaviyo", async () => {
    const r = await connectKlaviyo("shop1", "hello");
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createKlaviyoSegment", () => {
  const spec = { quizId: "qz1", quizName: "Skin", facet: { kind: "all" as const }, status: "all" as const };

  it("without a connection it asks to connect and calls nothing", async () => {
    p.shop.findUnique.mockResolvedValue({ klaviyoApiKey: null });
    const r = await createKlaviyoSegment("shop1", "Wiskr · All", spec);
    expect(r).toMatchObject({ ok: false, code: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("looks up the Completed Quiz metric, then makes ONE segment call", async () => {
    const { encrypt } = await import("./crypto");
    p.shop.findUnique.mockResolvedValue({ klaviyoApiKey: encrypt(KEY) });
    expect(await shopKlaviyoKey("shop1")).toBe(KEY);
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/api/metrics/")
        ? new Response(JSON.stringify({ data: [{ id: "M_quiz" }] }))
        : new Response(JSON.stringify({ data: { id: "SEG1" } }), { status: 201 }),
    );
    const r = await createKlaviyoSegment("shop1", "Wiskr · All", spec);
    expect(r).toEqual({ ok: true, segmentId: "SEG1", name: "Wiskr · All" });
    const segCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/segments/"));
    expect(segCalls).toHaveLength(1);
    const body = JSON.parse((segCalls[0]![1] as RequestInit).body as string);
    expect(body.data.type).toBe("segment");
    expect(body.data.attributes.definition.condition_groups.length).toBe(2);
  });
});
