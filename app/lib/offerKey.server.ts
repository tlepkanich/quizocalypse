import { createHash } from "node:crypto";
import type { DiscountConfig } from "./quizSchema";

// Results handoff §12.2 — which Shopify discount a shopper's code belongs to.
// A redeem code carries only its string: expiry, items, minimum, limits,
// purchase type and combinations all live on the parent discount, shared by
// every code under it. So ONE discount per key:
//   the quiz + a hash of every shared setting
//   + the result's product set when it applies to "what we recommend"
//   + an hourly bucket when expiry is relative.
// A settings change is a new hash, so a new discount — a discount is never
// edited once codes are out. Pure + unit-tested (server-only: node:crypto).

const HOUR_MS = 60 * 60 * 1000;

// Every setting that changes what the Shopify discount IS. Not here on
// purpose: enabled/configured (switches), code/static_code/existing_code
// (per-code strings), code_prefix (the code's spelling only).
const SHARED_KEYS = [
  "kind",
  "value",
  "applies_to",
  "applies_collection_ids",
  "applies_product_ids",
  "applies_on_each_item",
  "once_per_customer",
  "minimum_subtotal",
  "minimum_quantity",
  "expiry_mode",
  "expiry_hours",
  "ends_at",
  "combines",
  "purchase",
  "recurring_limit",
  "max_shipping_price",
  "shipping_countries",
  "title",
] as const satisfies readonly (keyof DiscountConfig)[];

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${[...value].map(stable).sort().join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);

/** A hash of every setting the discount's codes share. */
export function settingsHash(cfg: DiscountConfig): string {
  const picked: Record<string, unknown> = {};
  for (const k of SHARED_KEYS) picked[k] = cfg[k];
  return sha(stable(picked));
}

export interface OfferBucket {
  /** When every code under this discount stops working; null = never. */
  endsAt: Date | null;
  /** The bucket's label inside the key ("" when expiry is not relative). */
  label: string;
}

/**
 * Relative expiry means hourly buckets: a bucket's discount ends at the END
 * of its hour plus N hours, so a "24 hour" code lasts 24 to 25 hours — the
 * exact time is what the shopper is shown.
 */
export function offerBucket(cfg: DiscountConfig, now: Date): OfferBucket {
  if (cfg.expiry_mode === "hours") {
    const hours = cfg.expiry_hours ?? 24;
    const hourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
    return { endsAt: new Date(hourStart + HOUR_MS + hours * HOUR_MS), label: String(hourStart / HOUR_MS) };
  }
  if (cfg.expiry_mode === "date" && cfg.ends_at) return { endsAt: new Date(cfg.ends_at), label: "" };
  return { endsAt: null, label: "" };
}

/** The products a "what we recommend" discount covers (Shopify caps the
 *  list at 100). Sorted, so one result maps to one discount. */
export function recommendedScope(cfg: DiscountConfig, matchedProductIds: readonly string[]): string[] | null {
  if (cfg.applies_to !== "recommended") return null;
  return [...new Set(matchedProductIds)].sort().slice(0, 100);
}

export function offerKeyHash(
  cfg: DiscountConfig,
  bucket: OfferBucket,
  scope: readonly string[] | null,
): string {
  return sha(`${settingsHash(cfg)}|${scope ? scope.join(",") : ""}|${bucket.label}`);
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous characters

/** A per-shopper code: the merchant's prefix + 8 unambiguous characters. */
export function newOfferCode(prefix: string | undefined, randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(8);
  let suffix = "";
  for (const b of bytes) suffix += CODE_ALPHABET[b % CODE_ALPHABET.length];
  const clean = (prefix ?? "QUIZ-").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
  return `${clean}${suffix}`;
}
