import prisma from "../db.server";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { runWebResearchForQuizTypes } from "./claude";

// ════════════════════════════════════════════════════════════════════════════
// FAST F1 — shop-level cache + single-flight for the funnel's quiz-strategy
// web research (the ~40s pass at the front of the "typing" job). The research
// inputs are SHOP-LEVEL only (brand-identity positioning — industry / vertical
// / price tier / demographic), never bucket- or quiz-scoped, so one cached
// result serves every draft. Persisted on Shop.webResearch as
// { text, positioning_hash, at }; fresh = hash matches current positioning AND
// age < 24h. Process-local single-flight (the recCopyCache pattern — Fly runs
// one machine) so a loader prefetch and the typing job share ONE research run.
//
// Degradation contract (self-review lens 1): every failure path — shop row
// missing, cache column unreadable (pre-migration), research returning "",
// research throwing, the persist failing — resolves to "" or to the fresh
// text WITHOUT caching a bad value, which is exactly today's inline behavior
// (generateStep2Types treats "" as "no research — use model knowledge").
// ════════════════════════════════════════════════════════════════════════════

export const WEB_RESEARCH_TTL_MS = 24 * 60 * 60_000; // 24h

export interface ResearchPositioning {
  industry: string;
  vertical: string;
  price_tier: string;
  demographic: string[];
}

export interface ShopWebResearchRecord {
  text: string;
  positioning_hash: string;
  at: string; // ISO timestamp of the run
}

/** FNV-1a over the ORDERED positioning fields, hex-encoded. Same algorithm as
 *  whyCopyMeta.membershipHash but deliberately NOT that util: membershipHash
 *  sorts its inputs (set semantics), which would let swapped industry/vertical
 *  values collide — here field order is meaning-bearing. */
export function positioningHash(p: ResearchPositioning): string {
  const canonical = `${p.industry}|${p.vertical}|${p.price_tier}|${p.demographic.join(",")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Positioning as the research pass reads it — identical field fallbacks to
 *  step2Build's loadStep2Context, so cache keys and research inputs can't
 *  drift from what the inline path used to send. */
export function positioningFromIdentity(brandIdentity: unknown): ResearchPositioning {
  const identity = parseBrandIdentitySafe(brandIdentity);
  return {
    industry: identity?.positioning.industry ?? "",
    vertical: identity?.positioning.vertical ?? "",
    price_tier: identity?.positioning.price_tier ?? "",
    demographic: identity?.positioning.target_demographic ?? [],
  };
}

/** Tolerant reader for the Shop.webResearch JSON column. Anything malformed
 *  (wrong shape, legacy junk) reads as a cache miss, never a throw. */
export function parseWebResearchRecord(raw: unknown): ShopWebResearchRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== "string" || typeof r.positioning_hash !== "string" || typeof r.at !== "string") {
    return null;
  }
  return { text: r.text, positioning_hash: r.positioning_hash, at: r.at };
}

/** Fresh = non-empty text, positioning unchanged, and younger than the TTL.
 *  An unparseable `at` yields NaN age → stale (never fresh-forever). */
export function isFreshWebResearch(
  rec: ShopWebResearchRecord,
  currentHash: string,
  nowMs: number,
): boolean {
  if (!rec.text) return false;
  if (rec.positioning_hash !== currentHash) return false;
  const age = nowMs - new Date(rec.at).getTime();
  return Number.isFinite(age) && age >= 0 && age < WEB_RESEARCH_TTL_MS;
}

// ── IO seam (injected in tests; default wiring below) ───────────────────────

export interface ShopWebResearchIO {
  loadShop(
    shopId: string,
  ): Promise<{ brandIdentity: unknown; webResearch: unknown } | null>;
  saveResearch(shopId: string, rec: ShopWebResearchRecord): Promise<void>;
  runResearch(p: ResearchPositioning): Promise<string>;
  now(): number;
}

// Process-local single-flight, keyed shopId (the recCopyCache pattern): a
// loader prefetch and a typing job started moments later await the SAME
// research promise. The slot always clears in `finally`, so a rejected or
// empty run never poisons later attempts.
const inflight = new Map<string, Promise<string>>();
// Cheap prefetch throttle so the loader's 3s/1.5s polls + action revalidations
// don't even touch the DB/Map more than once a minute per shop.
const lastPrefetchAt = new Map<string, number>();

/** Core resolution with injected IO — exported for tests. Never rejects. */
export async function resolveShopWebResearch(
  shopId: string,
  io: ShopWebResearchIO,
): Promise<string> {
  try {
    const shop = await io.loadShop(shopId);
    if (!shop) return "";
    const positioning = positioningFromIdentity(shop.brandIdentity);
    const hash = positioningHash(positioning);
    const cached = parseWebResearchRecord(shop.webResearch);
    if (cached && isFreshWebResearch(cached, hash, io.now())) return cached.text;

    const pending = inflight.get(shopId);
    if (pending) return await pending;

    const run = (async () => {
      const text = await io.runResearch(positioning);
      if (text) {
        // Persist best-effort: a failed write just means the next merchant
        // pays for research again — never fail the run over it.
        try {
          await io.saveResearch(shopId, {
            text,
            positioning_hash: hash,
            at: new Date(io.now()).toISOString(),
          });
        } catch (err) {
          console.warn(
            "[step2] web research cache write failed (continuing uncached):",
            err instanceof Error ? err.message : err,
          );
        }
      }
      return text;
    })();
    inflight.set(shopId, run);
    try {
      return await run;
    } finally {
      inflight.delete(shopId);
    }
  } catch (err) {
    console.warn(
      "[step2] web research resolution failed, degrading to no-research:",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

const defaultIO: ShopWebResearchIO = {
  async loadShop(shopId) {
    const base = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { brandIdentity: true },
    });
    if (!base) return null;
    let webResearch: unknown = null;
    try {
      const row = await prisma.shop.findUnique({
        where: { id: shopId },
        select: { webResearch: true },
      });
      webResearch = row?.webResearch ?? null;
    } catch {
      // Column unreadable (e.g. code deployed ahead of the migration) —
      // treat as a cache miss; research still runs inline exactly as today.
    }
    return { brandIdentity: base.brandIdentity, webResearch };
  },
  async saveResearch(shopId, rec) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { webResearch: rec as never },
    });
  },
  runResearch(p) {
    // runWebResearchForQuizTypes is itself best-effort (returns "" on any
    // failure) — identical inputs to the retired inline runStep2WebResearch.
    return runWebResearchForQuizTypes({
      industry: p.industry,
      vertical: p.vertical,
      priceTier: p.price_tier,
      demographic: p.demographic,
    });
  },
  now: () => Date.now(),
};

/** The typing job's drop-in for the old inline `runStep2WebResearch`: cached →
 *  instant; in flight (loader prefetch) → awaits the same promise; cold →
 *  runs research inline exactly as today. Never rejects; failures → "". */
export function getOrStartShopWebResearch(shopId: string): Promise<string> {
  return resolveShopWebResearch(shopId, defaultIO);
}

/** Cache-only read (no AI, no single-flight): the fresh cached text, or null.
 *  Used by the typing job to skip the "research" gen_progress checkpoint when
 *  the cache makes research instant. Never rejects. */
export async function peekFreshShopWebResearch(shopId: string): Promise<string | null> {
  try {
    const shop = await defaultIO.loadShop(shopId);
    if (!shop) return null;
    const hash = positioningHash(positioningFromIdentity(shop.brandIdentity));
    const cached = parseWebResearchRecord(shop.webResearch);
    return cached && isFreshWebResearch(cached, hash, Date.now()) ? cached.text : null;
  } catch {
    return null;
  }
}

// Re-check at most once a minute per shop; the single-flight + freshness read
// inside getOrStart make extra calls harmless, this just keeps the loader hot
// path from re-querying on every poll/revalidation.
const PREFETCH_RECHECK_MS = 60_000;

/** Fire-and-forget prefetch for funnel entry (loader, early stages). Safe to
 *  call on every loader pass — throttled, single-flighted, never throws. */
export function prefetchShopWebResearch(shopId: string): void {
  const now = Date.now();
  const last = lastPrefetchAt.get(shopId);
  if (last !== undefined && now - last < PREFETCH_RECHECK_MS) return;
  lastPrefetchAt.set(shopId, now);
  void getOrStartShopWebResearch(shopId).catch(() => {});
}

/** Test-only reset. */
export function __resetShopWebResearch(): void {
  inflight.clear();
  lastPrefetchAt.clear();
}
