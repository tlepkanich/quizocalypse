// Locale- + currency-aware money formatting for the shopper runtime.
//
// The published quiz doc bakes a top-level `currency` (the shop's Shopify
// currencyCode) at publish time; every price + discount amount in the runtime
// is formatted through here so a ¥886 product renders as "¥886" — not "$886".
//
// Using Intl.NumberFormat (style: "currency") also fixes zero-decimal
// currencies for free: JPY → "¥886" (no ".00"), USD → "$886.00".
//
// Currency falls back to USD when the doc/product carries none — pre-existing
// quizzes published before `currency` existed keep rendering dollars until they
// are re-published. Currency code and locale are both validated defensively so
// a bad value never throws mid-render.

const DEFAULT_LOCALE = "en";
const FALLBACK_CURRENCY = "USD";

/**
 * Format a monetary amount in the given ISO 4217 currency.
 *
 * @param amount   The numeric amount (number, or a numeric string like "886").
 *                 `null`/`undefined`/empty/non-numeric → "" (caller hides it).
 * @param currency ISO 4217 code (e.g. "USD", "JPY"). Missing/invalid → USD.
 * @param locale   BCP 47 locale for grouping/symbol placement. Default "en".
 */
export function formatMoney(
  amount: number | string | null | undefined,
  currency?: string | null,
  locale?: string,
): string {
  if (amount == null || amount === "") return "";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return "";
  return moneyFormatter(currency, locale).format(n);
}

/**
 * Build a reusable Intl.NumberFormat for a currency/locale, falling back to USD
 * (and the default locale) on an unknown code so it never throws at render.
 */
export function moneyFormatter(
  currency?: string | null,
  locale?: string,
): Intl.NumberFormat {
  const loc = locale || DEFAULT_LOCALE;
  const cur = currency || FALLBACK_CURRENCY;
  try {
    return new Intl.NumberFormat(loc, { style: "currency", currency: cur });
  } catch {
    // Invalid ISO 4217 code (Intl throws a RangeError) → never break the page.
    return new Intl.NumberFormat(loc, {
      style: "currency",
      currency: FALLBACK_CURRENCY,
    });
  }
}
