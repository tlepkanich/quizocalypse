import { QzBadge, QzBanner } from "../qz";
import type { StepProps } from "./stepProps";

// Step 1 — "Add recommendation buckets". Group products into outcome buckets;
// each bucket becomes a result page. (Phase 1 enriches this with the drag-drop
// bucket builder + grouping sources; this baseline shows the current buckets
// and binds them on Next via the shell's reconcile.)

const GROUP_SOURCES = [
  "Manual groups",
  "Shopify Collections",
  "Smart Collections",
  "Existing tags",
  "Product type",
  "Metafields",
  "AI-assisted",
];

export function Step1Products({ doc, categories }: StepProps) {
  const resultNodes = doc.nodes.filter((n) => n.type === "result");
  const catById = new Map(categories.map((c) => [c.id, c]));

  // A "bucket" view = each result node's bound category (or the node itself).
  const buckets = resultNodes.map((n) => {
    const catId = n.type === "result" ? n.data.category_id : undefined;
    const cat = catId ? catById.get(catId) : undefined;
    return {
      nodeId: n.id,
      name: n.type === "result" ? n.data.headline : n.id,
      count: cat?.productIds.length ?? 0,
      bound: Boolean(cat),
    };
  });
  // Unbound quiz categories not yet mirrored as result nodes.
  const boundCatIds = new Set(
    resultNodes.map((n) => (n.type === "result" ? n.data.category_id : undefined)).filter(Boolean),
  );
  const looseBuckets = categories.filter((c) => !boundCatIds.has(c.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 className="qz-h1" style={{ margin: 0 }}>
          Group your products into outcome buckets
        </h2>
        <p className="qz-dim" style={{ marginTop: 6 }}>
          Each bucket becomes a quiz result page. Group manually, or from Shopify Collections, tags,
          product type, metafields, or let AI propose buckets.
        </p>
      </div>

      <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
        {GROUP_SOURCES.map((s) => (
          <span
            key={s}
            className="qz-badge qz-draft"
            style={{ fontSize: 11 }}
            title="Grouping source"
          >
            {s}
          </span>
        ))}
      </div>

      {buckets.length === 0 && looseBuckets.length === 0 ? (
        <QzBanner tone="warn" title="No buckets yet">
          Create at least one outcome bucket to continue. Use the product grouping tools to organize
          your catalog into result pages.
        </QzBanner>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {buckets.map((b) => (
            <div key={b.nodeId} className="qz-card" style={{ padding: 14 }}>
              <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
                <strong style={{ fontSize: 14 }}>{b.name}</strong>
                {b.bound ? <QzBadge tone="ok">bound</QzBadge> : <QzBadge tone="warn">unbound</QzBadge>}
              </div>
              <div className="qz-dim" style={{ fontSize: 12, marginTop: 6 }}>
                {b.count} product{b.count === 1 ? "" : "s"}
              </div>
            </div>
          ))}
          {looseBuckets.map((c) => (
            <div key={c.id} className="qz-card qz-dash" style={{ padding: 14 }}>
              <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
                <strong style={{ fontSize: 14 }}>{c.name}</strong>
                <QzBadge tone="draft">new</QzBadge>
              </div>
              <div className="qz-dim" style={{ fontSize: 12, marginTop: 6 }}>
                {c.productIds.length} products · becomes a result on Next
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="qz-dim" style={{ fontSize: 12 }}>
        Group your products to continue · Step 1 of 5
      </p>
    </div>
  );
}
