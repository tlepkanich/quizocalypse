// BIC-2 B2a — bounded analytics event fetches. The dashboards used to fetch
// EVERY Event row for a quiz; a high-traffic quiz would time out the loader.
// Loaders now fetch a most-recent window (`orderBy: { ts: "desc" }, take:
// cap + 1`) and pass the rows through windowRows(), which slices to the cap
// and reports whether older rows were left behind so the UI can say so.
// Every aggregation consumer (funnel stages, drop-off, hotspots, revenue
// dedupe, product leaderboard, A/B funnels) counts distinct sessions via
// Sets/Maps — none assume chronological order, so a desc-ordered window is
// safe; metrics simply become "most recent N events" on very large quizzes.

/** Most-recent rows an analytics loader will aggregate over. */
export const ANALYTICS_EVENT_WINDOW = 5000;

export interface WindowedRows<T> {
  rows: T[];
  /** True when the source had more rows than the cap (fetch cap+1 to detect). */
  truncated: boolean;
}

/**
 * Slice `rows` to `cap`, flagging truncation. Pure: pass the result of a
 * `take: cap + 1` fetch — one extra row is the cheapest existence proof that
 * the window clipped something.
 */
export function windowRows<T>(
  rows: T[],
  cap: number = ANALYTICS_EVENT_WINDOW,
): WindowedRows<T> {
  if (rows.length > cap) return { rows: rows.slice(0, cap), truncated: true };
  return { rows, truncated: false };
}
