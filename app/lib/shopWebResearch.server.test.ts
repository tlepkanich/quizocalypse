import { describe, it, expect, beforeEach } from "vitest";
import {
  positioningHash,
  parseWebResearchRecord,
  isFreshWebResearch,
  resolveShopWebResearch,
  WEB_RESEARCH_TTL_MS,
  __resetShopWebResearch,
  type ShopWebResearchIO,
  type ShopWebResearchRecord,
} from "./shopWebResearch.server";

// FAST F1 — the cache/hash/single-flight logic behind getOrStartShopWebResearch.
// The IO seam is injected so no DB / AI is touched.

const POS = {
  industry: "outdoor",
  vertical: "snowboards",
  price_tier: "premium",
  demographic: ["riders", "gift shoppers"],
};

// A brand identity blob whose positioning parses to POS via
// parseBrandIdentitySafe (BrandIdentity requires summary/design/positioning/
// updated_at; everything the hash doesn't read uses schema defaults).
const IDENTITY = {
  summary: "Test brand",
  design: {},
  positioning: {
    industry: "outdoor",
    vertical: "snowboards",
    price_tier: "premium",
    target_demographic: ["riders", "gift shoppers"],
  },
  updated_at: "2026-07-05T00:00:00Z",
};

const NOW = Date.parse("2026-07-05T12:00:00Z");

function freshRecord(overrides?: Partial<ShopWebResearchRecord>): ShopWebResearchRecord {
  return {
    text: "cached research text",
    positioning_hash: positioningHash(POS),
    at: new Date(NOW - 60_000).toISOString(), // 1 min old
    ...overrides,
  };
}

function makeIO(overrides?: Partial<ShopWebResearchIO> & { record?: unknown }): {
  io: ShopWebResearchIO;
  calls: { research: number; saved: ShopWebResearchRecord[] };
} {
  const calls = { research: 0, saved: [] as ShopWebResearchRecord[] };
  const io: ShopWebResearchIO = {
    loadShop: async () => ({
      brandIdentity: IDENTITY,
      webResearch: overrides && "record" in overrides ? overrides.record : null,
    }),
    saveResearch: async (_shopId, rec) => {
      calls.saved.push(rec);
    },
    runResearch: async () => {
      calls.research += 1;
      return "fresh research text";
    },
    now: () => NOW,
    ...(overrides?.loadShop ? { loadShop: overrides.loadShop } : {}),
    ...(overrides?.saveResearch ? { saveResearch: overrides.saveResearch } : {}),
    ...(overrides?.runResearch ? { runResearch: overrides.runResearch } : {}),
    ...(overrides?.now ? { now: overrides.now } : {}),
  };
  return { io, calls };
}

beforeEach(() => __resetShopWebResearch());

describe("positioningHash", () => {
  it("is deterministic for identical positioning", () => {
    expect(positioningHash(POS)).toBe(positioningHash({ ...POS }));
  });

  it("changes when any field changes", () => {
    const base = positioningHash(POS);
    expect(positioningHash({ ...POS, industry: "beauty" })).not.toBe(base);
    expect(positioningHash({ ...POS, vertical: "skincare" })).not.toBe(base);
    expect(positioningHash({ ...POS, price_tier: "budget" })).not.toBe(base);
    expect(positioningHash({ ...POS, demographic: ["riders"] })).not.toBe(base);
  });

  it("is ORDER-sensitive (industry/vertical swap must not collide)", () => {
    const swapped = { ...POS, industry: POS.vertical, vertical: POS.industry };
    expect(positioningHash(swapped)).not.toBe(positioningHash(POS));
  });
});

describe("parseWebResearchRecord", () => {
  it("round-trips a valid record", () => {
    const rec = freshRecord();
    expect(parseWebResearchRecord(rec)).toEqual(rec);
  });

  it("reads malformed shapes as cache misses, never throwing", () => {
    expect(parseWebResearchRecord(null)).toBeNull();
    expect(parseWebResearchRecord("junk")).toBeNull();
    expect(parseWebResearchRecord({ text: 42 })).toBeNull();
    expect(parseWebResearchRecord({ text: "x", positioning_hash: "y" })).toBeNull();
  });
});

describe("isFreshWebResearch", () => {
  const hash = positioningHash(POS);

  it("fresh: hash matches and age < 24h", () => {
    expect(isFreshWebResearch(freshRecord(), hash, NOW)).toBe(true);
    expect(
      isFreshWebResearch(
        freshRecord({ at: new Date(NOW - WEB_RESEARCH_TTL_MS + 1000).toISOString() }),
        hash,
        NOW,
      ),
    ).toBe(true);
  });

  it("stale: older than 24h", () => {
    const old = freshRecord({ at: new Date(NOW - WEB_RESEARCH_TTL_MS - 1000).toISOString() });
    expect(isFreshWebResearch(old, hash, NOW)).toBe(false);
  });

  it("stale: positioning changed", () => {
    expect(isFreshWebResearch(freshRecord(), positioningHash({ ...POS, industry: "beauty" }), NOW)).toBe(false);
  });

  it("stale: empty text, future/garbled timestamps", () => {
    expect(isFreshWebResearch(freshRecord({ text: "" }), hash, NOW)).toBe(false);
    expect(isFreshWebResearch(freshRecord({ at: "not-a-date" }), hash, NOW)).toBe(false);
    expect(isFreshWebResearch(freshRecord({ at: new Date(NOW + 60_000).toISOString() }), hash, NOW)).toBe(false);
  });
});

describe("resolveShopWebResearch", () => {
  it("cache hit: returns cached text without running research", async () => {
    const { io, calls } = makeIO({ record: freshRecord() });
    expect(await resolveShopWebResearch("shop-hit", io)).toBe("cached research text");
    expect(calls.research).toBe(0);
    expect(calls.saved).toHaveLength(0);
  });

  it("cache miss: runs research once and persists it", async () => {
    const { io, calls } = makeIO();
    expect(await resolveShopWebResearch("shop-miss", io)).toBe("fresh research text");
    expect(calls.research).toBe(1);
    expect(calls.saved).toHaveLength(1);
    expect(calls.saved[0]!.positioning_hash).toBe(positioningHash(POS));
    expect(isFreshWebResearch(calls.saved[0]!, positioningHash(POS), NOW)).toBe(true);
  });

  it("hash-mismatched cache re-runs research (positioning changed)", async () => {
    const { io, calls } = makeIO({ record: freshRecord({ positioning_hash: "deadbeef" }) });
    expect(await resolveShopWebResearch("shop-stalehash", io)).toBe("fresh research text");
    expect(calls.research).toBe(1);
  });

  it("single-flight: concurrent callers share ONE research run", async () => {
    let release!: (v: string) => void;
    const gate = new Promise<string>((r) => (release = r));
    const { io, calls } = makeIO({
      runResearch: async () => {
        calls.research += 1;
        return gate;
      },
    });
    const a = resolveShopWebResearch("shop-flight", io);
    const b = resolveShopWebResearch("shop-flight", io);
    release("shared text");
    expect(await a).toBe("shared text");
    expect(await b).toBe("shared text");
    expect(calls.research).toBe(1);
  });

  it("empty research result degrades to '' and is NOT cached", async () => {
    const { io, calls } = makeIO({ runResearch: async () => "" });
    expect(await resolveShopWebResearch("shop-empty", io)).toBe("");
    expect(calls.saved).toHaveLength(0);
  });

  it("a rejected run degrades to '' and does not poison the slot", async () => {
    let attempts = 0;
    const { io } = makeIO({
      runResearch: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("boom");
        return "second try";
      },
    });
    expect(await resolveShopWebResearch("shop-reject", io)).toBe("");
    // The in-flight slot cleared — a later call retries and succeeds.
    expect(await resolveShopWebResearch("shop-reject", io)).toBe("second try");
  });

  it("a failed persist still returns the fresh text", async () => {
    const { io } = makeIO({
      saveResearch: async () => {
        throw new Error("db down");
      },
    });
    expect(await resolveShopWebResearch("shop-savefail", io)).toBe("fresh research text");
  });

  it("missing shop row degrades to ''", async () => {
    const { io, calls } = makeIO({ loadShop: async () => null });
    expect(await resolveShopWebResearch("shop-gone", io)).toBe("");
    expect(calls.research).toBe(0);
  });
});
