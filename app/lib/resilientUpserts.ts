// HII-3 — per-row resilience for the detached catalog sync loops.
//
// The Shopify catalog sync upserts collections + products in bare loops; before
// this, ONE bad row's upsert throw propagated out and aborted the WHOLE detached
// job (recorded as a hard error, no partial catalog landed, and — being detached
// — nothing surfaced the cause cleanly). This runs each row's upsert inside a
// try/catch: a single failure is logged + counted + SKIPPED so the rest of the
// batch still lands, and the caller gets an `errors` count to surface.
//
// The one guard against silently shipping a corrupt catalog: if a LARGE fraction
// of a MEANINGFUL sample fails (a systemic error — a schema mismatch, a bad
// shopId — that breaks every row), throw so the caller records an error instead
// of a half-empty catalog as a clean sync. The `minAbortSample` floor means a
// tiny catalog's single transient failure can NEVER nuke the whole run.

export interface ResilientUpsertResult {
  /** Rows that upserted successfully. */
  count: number;
  /** Rows whose upsert threw (logged + skipped). */
  errors: number;
}

export interface ResilientUpsertOptions<T> {
  /** A short noun for logs ("collection", "product"). */
  label: string;
  /** Identifies the row in the error log. */
  idOf: (item: T) => string;
  /** Abort the batch when more than this fraction fails (default 0.2 = 20%). */
  abortRatio?: number;
  /** ...but only once at least this many rows were attempted (default 10), so a
   *  small catalog's single failure can't trip the abort. */
  minAbortSample?: number;
}

export async function runResilientUpserts<T>(
  items: T[],
  upsertOne: (item: T) => Promise<void>,
  opts: ResilientUpsertOptions<T>,
): Promise<ResilientUpsertResult> {
  const abortRatio = opts.abortRatio ?? 0.2;
  const minAbortSample = opts.minAbortSample ?? 10;
  let count = 0;
  let errors = 0;

  for (const item of items) {
    try {
      await upsertOne(item);
      count++;
    } catch (err) {
      errors++;
      console.error(
        `[catalogSync] ${opts.label} upsert failed for ${opts.idOf(item)}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const attempted = items.length;
  // Abort (→ caller records an error + the next sync retries) when the failure is
  // SYSTEMIC, not a stray transient row:
  //  - ALL rows failed (any size) — a sync that wrote ZERO rows when there was
  //    data is wholly broken, not transient, so it must never read as a clean
  //    "ok" sync (even for a 1-row catalog); OR
  //  - a large fraction of a MEANINGFUL sample failed (the minAbortSample floor
  //    keeps a tiny catalog's PARTIAL transient failure from nuking the run).
  const allFailed = attempted > 0 && errors === attempted;
  const systemicRatio = attempted >= minAbortSample && errors / attempted > abortRatio;
  if (allFailed || systemicRatio) {
    throw new Error(
      `catalog sync aborted: ${errors}/${attempted} ${opts.label} upserts failed ` +
        `(${allFailed ? "all rows failed" : `> ${Math.round(abortRatio * 100)}%`} — ` +
        `likely systemic, not shipping a partial catalog)`,
    );
  }

  return { count, errors };
}

export interface SyncStatusWrite {
  lastSyncStatus: "ok" | "partial";
  lastSyncError: string | null;
}

/**
 * HIII-2 — map a COMPLETED (non-throwing) catalog sync's skipped-row count to the
 * Shop row's persisted status. errorCount===0 → the unchanged "ok"/null write
 * (BYTE-STABLE: identical to the pre-HIII-2 write); errorCount>0 → a soft
 * "partial" + a human note in lastSyncError, so a merchant sees their catalog
 * landed INCOMPLETE instead of a falsely-green "ok" while N products are missing.
 * The SYSTEMIC-abort throw path keeps writing "error" in the caller's catch —
 * this only covers the success return where some rows were skipped but the batch
 * still landed (the runResilientUpserts partial-success class).
 */
export function deriveSyncStatus(errorCount: number): SyncStatusWrite {
  if (errorCount > 0) {
    return {
      lastSyncStatus: "partial",
      lastSyncError: `${errorCount} product/collection row(s) skipped during sync — re-sync to retry`,
    };
  }
  return { lastSyncStatus: "ok", lastSyncError: null };
}
