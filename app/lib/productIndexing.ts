// G5 widening (logic-tab HANDOFF §13.3) — the SHARED derivations for
// IndexedProduct's narrowing-source fields. Publish (quizPublish.ts) and the
// builder loader (quizEditorIO.server.ts) both call these, so draft-time
// menus and published matching can never disagree. Pure; no prisma.

/** Flatten catalog-sync metafields ({ "ns.key": { value, type } }) into a
 *  simple key→string map. (Publish's inline version, extracted.) */
export function flattenMetafields(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const val =
      v && typeof v === "object" && "value" in (v as object)
        ? (v as { value?: unknown }).value
        : v;
    if (val != null) out[k] = String(val);
  }
  return out;
}

/** Variant options ({ name, value } pairs on each synced variant —
 *  catalogSync.ts:393) → option name → distinct values, first-seen order. */
export function variantOptionsOf(variants: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!Array.isArray(variants)) return out;
  for (const v of variants) {
    const options = (v as { options?: unknown })?.options;
    if (!Array.isArray(options)) continue;
    for (const o of options) {
      const name = (o as { name?: unknown })?.name;
      const value = (o as { value?: unknown })?.value;
      if (typeof name !== "string" || !name || typeof value !== "string" || !value)
        continue;
      // Shopify's placeholder option on single-variant products.
      if (name === "Title" && value === "Default Title") continue;
      const arr = out[name] ?? (out[name] = []);
      if (!arr.includes(value)) arr.push(value);
    }
  }
  return out;
}
