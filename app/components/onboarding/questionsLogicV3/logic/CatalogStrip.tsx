import { useMemo } from "react";
import type { IndexedProduct } from "../../../../lib/recommendationEngine";

// ════════════════════════════════════════════════════════════════════════════
// Logic-step module 02 — the Catalog strip ("Always · top of the workspace",
// directly ABOVE the style bar). Mock .strip/.lbl/.flag through the token
// map. What it says:
//   · "{n} products" — productIndex.length;
//   · attributes style only: "{n} attributes split them well" (the chooser
//     scan's strongCount — irrelevant in Rules only, so omitted there);
//   · the status flag — "⚠ {n} not live" when any indexed product carries a
//     non-active status, else "✓ all live". Products WITHOUT a status field
//     count as live (older bakes predate the baked status column);
//   · Rules only appends the muted "Nothing here is read from your product
//     data." sentence.
// ════════════════════════════════════════════════════════════════════════════

export function CatalogStrip({
  productIndex,
  attributeCount,
  rulesOnly,
}: {
  productIndex: readonly IndexedProduct[];
  /** The chooser scan's strongCount (Step3Shell's existing memo). */
  attributeCount: number;
  rulesOnly: boolean;
}) {
  const notLive = useMemo(
    () =>
      productIndex.filter(
        (p) => p.status !== undefined && p.status.toLowerCase() !== "active",
      ).length,
    [productIndex],
  );
  return (
    <div className="qz-lcs" data-testid="logic-catalog-strip">
      <span className="qz-lcs-lbl">Catalog</span>
      <span className="qz-lcs-item">
        <span className="qz-lcs-s is-cat">{productIndex.length}</span> products
      </span>
      {!rulesOnly ? (
        <span className="qz-lcs-item">
          <span className="qz-lcs-s is-comp">{attributeCount}</span> attributes
          split them well
        </span>
      ) : null}
      {notLive > 0 ? (
        <span className="qz-lcs-flag is-warn">
          ⚠ <span className="qz-lcs-s is-comp">{notLive}</span> not live
        </span>
      ) : (
        <span className="qz-lcs-flag is-good">✓ all live</span>
      )}
      {rulesOnly ? (
        <span className="qz-lcs-muted">
          Nothing here is read from your product data.
        </span>
      ) : null}
    </div>
  );
}
