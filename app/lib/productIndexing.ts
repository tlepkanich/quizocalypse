// G5 widening (logic-tab HANDOFF §13.3) — the SHARED derivations for
// IndexedProduct's narrowing-source fields. Publish (quizPublish.ts) and the
// builder loader (quizEditorIO.server.ts) both call these, so draft-time
// menus and published matching can never disagree. Pure; no prisma.

/** Logic-step handoff §7 bug 4 / §10a — the "not a real value" family. A
 *  value matching this is dropped at index time: it pollutes the attribute
 *  read-out and the value picker, and can never be a meaningful match. */
export const NOT_A_VALUE_RE = /^\s*(n\/?a\.?|none|null|-|—)\s*$/i;

/** Flatten catalog-sync metafields ({ "ns.key": { value, type } }) into a
 *  simple key→string map. (Publish's inline version, extracted.)
 *
 *  Logic-step handoff §7 bug 1 — LIST-typed metafields (`type` starts with
 *  "list.", value is a JSON array string) used to flatten to one opaque JSON
 *  blob, so a multi-value metafield could never be offered as separate
 *  values or matched. They now flatten to their values joined ", " —
 *  matching (filterMatching) and the attribute read-out split on comma.
 *  Bug 4 — N/A-family values are dropped here (a metafield whose only
 *  content is "N/A" is absent, not a value). */
export function flattenMetafields(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const isObj = v && typeof v === "object";
    const val = isObj && "value" in (v as object) ? (v as { value?: unknown }).value : v;
    if (val == null) continue;
    const type = isObj ? (v as { type?: unknown }).type : undefined;
    let text = String(val);
    if (typeof type === "string" && type.startsWith("list.")) {
      try {
        const arr: unknown = JSON.parse(text);
        if (Array.isArray(arr)) {
          text = arr
            .map((x) => String(x).trim())
            .filter((x) => x && !NOT_A_VALUE_RE.test(x))
            .join(", ");
        }
      } catch {
        // Not JSON after all — keep the raw string.
      }
    }
    if (!text.trim() || NOT_A_VALUE_RE.test(text)) continue;
    out[k] = text;
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
