// SSR-safe date/time formatting.
//
// `Date.prototype.toLocaleDateString` / `toLocaleString` format using the
// runtime's timezone + locale. On Fly the server runs in UTC; the merchant's
// browser runs in their own zone — so the two produce DIFFERENT strings for the
// same timestamp (always, when a time-of-day is shown — the offset shifts it;
// intermittently, at day boundaries, for date-only). React then reports a #425
// "text content does not match server-rendered HTML" hydration mismatch and
// discards the whole server-rendered subtree (#418), which also breaks the
// streamed manifest patches.
//
// These helpers format from the timestamp's UTC parts, so the server and the
// client always render the identical string. (Generalizes the inline
// `fmtEnrichedDate` that fixed the same class of bug in ReviewEnrichPanel.)

function toDate(input: string | number | Date | null | undefined): Date | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `M/D/YYYY` in UTC — stable across server/client timezones. */
export function formatDate(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "";
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

/** `M/D/YYYY, h:mm AM/PM` in UTC — stable across server/client timezones. */
export function formatDateTime(input: string | number | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return "";
  const h24 = d.getUTCHours();
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDate(d)}, ${h12}:${mm} ${period}`;
}
