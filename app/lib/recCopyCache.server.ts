// LOGIC v2 L2-12b — a process-local cache + single-flight for the runtime
// rec-copy endpoint. Keyed `quizId:sessionId:targetId`, TTL ~30min. Same
// single-machine justification as the rate limiters (Fly runs one machine with
// min_machines_running=1): a per-process Map is sufficient — a shopper re-POSTs
// (interstitial re-race on reload) hit the cache instead of paying twice, and
// concurrent duplicate POSTs share ONE in-flight generation. Clock-injected so
// tests are deterministic (Date.now() is unavailable in some pure contexts).

const TTL_MS = 30 * 60_000; // 30 minutes
const MAX_ENTRIES = 5000; // runaway guard; evicted oldest-first on overflow

interface Entry {
  copy: string;
  at: number;
}

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string>>();

function sweep(now: number): void {
  for (const [k, e] of cache) {
    if (now - e.at > TTL_MS) cache.delete(k);
  }
  // Hard cap after TTL sweep — evict oldest insertion-order entries.
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function recCopyCacheKey(quizId: string, sessionId: string, targetId: string): string {
  return `${quizId}:${sessionId}:${targetId}`;
}

/** Return a cached copy for the key if it's still fresh, else null. */
export function getCachedRecCopy(key: string, now: number): string | null {
  const e = cache.get(key);
  if (!e) return null;
  if (now - e.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.copy;
}

/**
 * Resolve the rec-copy for `key`, generating via `produce()` only when there is
 * no fresh cache entry AND no identical generation already in flight. The
 * generated string is cached. `produce` rejections propagate (nothing cached)
 * and clear the in-flight slot so a later retry can regenerate.
 */
export async function resolveRecCopy(
  key: string,
  now: number,
  produce: () => Promise<string>,
): Promise<{ copy: string; cached: boolean }> {
  const hit = getCachedRecCopy(key, now);
  if (hit !== null) return { copy: hit, cached: true };

  const pending = inflight.get(key);
  if (pending) return { copy: await pending, cached: true };

  const p = produce();
  inflight.set(key, p);
  try {
    const copy = await p;
    sweep(now);
    cache.set(key, { copy, at: now });
    return { copy, cached: false };
  } finally {
    inflight.delete(key);
  }
}

/** Test-only reset. */
export function __resetRecCopyCache(): void {
  cache.clear();
  inflight.clear();
}
