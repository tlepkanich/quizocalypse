// ════════════════════════════════════════════════════════════════════════════
// LOGIC v2 (L2-11) — why-copy generation provenance. When the merchant drafts
// grounded copy with ✦ AI generate, the doc stores WHEN and against WHICH
// bucket membership (a short hash), so the panel can flag STALE copy after
// the products change. CLIENT-SAFE pure TS (the panel recomputes the current
// hash from BuilderCategory.productIds) — no node:crypto.
// ════════════════════════════════════════════════════════════════════════════

/** Scope key for the why_copy_meta record: a Category id, or the global slot. */
export const GLOBAL_WHY_COPY_KEY = "__global__";

/** Order-insensitive FNV-1a hash over the product-id set, hex-encoded. Both
 *  the generate route and the panel derive it from the same canonical inputs
 *  (see whyCopyMemberIds) so staleness compares apples to apples. */
export function membershipHash(productIds: readonly string[]): string {
  const canonical = [...productIds].sort().join("\n");
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The canonical product-id set copy for a scope is grounded in: the target
 *  category's members, or every category's members for the global slot. */
export function whyCopyMemberIds(
  categories: readonly { id: string; productIds: readonly string[] }[],
  targetId: string | null,
): string[] {
  if (targetId) {
    return [...(categories.find((c) => c.id === targetId)?.productIds ?? [])];
  }
  return categories.flatMap((c) => [...c.productIds]);
}

/** Stale = provenance exists but the membership hash no longer matches. No
 *  provenance (hand-written or never-generated copy) is never "stale". */
export function isWhyCopyStale(
  meta: { members: string } | undefined,
  currentHash: string,
): boolean {
  return Boolean(meta) && meta!.members !== currentHash;
}
