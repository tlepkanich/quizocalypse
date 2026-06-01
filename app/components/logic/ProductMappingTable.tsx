import { useMemo, useState } from "react";
import { QzBadge, QzInput } from "../qz";
import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import type { BuilderCategory } from "../builder/stepProps";
import { buildMappingMatrix } from "../../lib/productMapping";

// FOCUS #2, HALF 2 — the Product Mapping table. Rows = catalog products,
// columns = result pages bound to a bucket. A cell toggles whether the product
// belongs to that page's bucket. "Working backwards from the rec page": read a
// column to see (and edit) what feeds it. Edits flow up via onToggle; LogicView
// owns persistence (id-stable /api/categories/set-members) and re-publish hints.

const PAGE_SIZE = 25;

type SaveState = "idle" | "saving" | "saved" | "error";

export function ProductMappingTable({
  productIndex,
  categories,
  resultNodes,
  selectedCategoryId,
  onToggle,
  saveState,
  dirty,
}: {
  productIndex: IndexedProduct[];
  categories: BuilderCategory[];
  resultNodes: QuizDoc["nodes"];
  selectedCategoryId: string | null;
  onToggle: (categoryId: string, productId: string) => void;
  saveState: SaveState;
  dirty: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showUnmapped, setShowUnmapped] = useState(false);
  const [page, setPage] = useState(0);

  const matrix = useMemo(
    () => buildMappingMatrix(productIndex, categories, resultNodes),
    [productIndex, categories, resultNodes],
  );

  const multiMapped = useMemo(
    () => new Set(matrix.multiMappedProductIds),
    [matrix.multiMappedProductIds],
  );
  const unmapped = useMemo(
    () => new Set(matrix.unmappedProductIds),
    [matrix.unmappedProductIds],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matrix.rows.filter((r) => {
      if (showUnmapped && !unmapped.has(r.productId)) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [matrix.rows, query, showUnmapped, unmapped]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (matrix.columns.length === 0) {
    return (
      <div className="qz-card" style={{ padding: 16 }}>
        <strong style={{ fontSize: 14 }}>No bucket-bound pages yet</strong>
        <p className="qz-dim" style={{ marginTop: 6, fontSize: 13 }}>
          Group products into buckets in Step 1 — each bucket becomes a column you can map products into here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>Product mapping</h3>
          <div className="qz-dim" style={{ fontSize: 12 }}>
            {matrix.rows.length} products · {unmapped.size} unmapped · {multiMapped.size} on multiple pages
          </div>
          <div className="qz-dim" style={{ fontSize: 11.5, marginTop: 2 }}>
            Toggling a cell edits the <strong>same buckets as Step&nbsp;1 — Products</strong> (one source
            of truth). Changes go live on the next publish.
          </div>
        </div>
        <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
          {dirty || saveState === "saving" ? (
            <span className="qz-dim" style={{ fontSize: 12 }}>
              {saveState === "saving" ? "Saving…" : "Unsaved"}
            </span>
          ) : saveState === "saved" ? (
            <QzBadge tone="ok">Saved · re-publish</QzBadge>
          ) : saveState === "error" ? (
            <QzBadge tone="warn">Save failed</QzBadge>
          ) : null}
        </div>
      </div>

      <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 220 }}>
          <QzInput
            placeholder="Search products…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showUnmapped}
            onChange={(e) => {
              setShowUnmapped(e.target.checked);
              setPage(0);
            }}
          />
          Unmapped only
        </label>
      </div>

      <div
        className="qz-card"
        style={{ padding: 0, overflow: "auto", maxHeight: "60vh", minWidth: 0 }}
      >
        <table className="qz-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  top: 0,
                  background: "#fff",
                  zIndex: 2,
                  textAlign: "left",
                  padding: "10px 12px",
                  minWidth: 200,
                }}
              >
                Product
              </th>
              {matrix.columns.map((col) => (
                <th
                  key={col.nodeId}
                  title={`${col.bucketName} · ${col.productCount} products`}
                  style={{
                    position: "sticky",
                    top: 0,
                    background: col.categoryId === selectedCategoryId ? "#eef4ff" : "#fff",
                    zIndex: 1,
                    padding: "10px 8px",
                    textAlign: "center",
                    minWidth: 92,
                    maxWidth: 140,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col.label}
                  </div>
                  <div className="qz-dim" style={{ fontSize: 10.5 }}>{col.productCount}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const inSet = new Set(row.categoryIds);
              return (
                <tr key={row.productId}>
                  <td
                    style={{
                      position: "sticky",
                      left: 0,
                      background: "#fff",
                      padding: "8px 12px",
                      borderTop: "1px solid var(--qz-rule, #00000010)",
                    }}
                  >
                    <div className="qz-row" style={{ gap: 8, alignItems: "center", minWidth: 0 }}>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          flex: "0 0 auto",
                          background: row.imageUrl ? `center/cover url(${row.imageUrl})` : "#0000000d",
                        }}
                      />
                      <span
                        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={row.title}
                      >
                        {row.title}
                      </span>
                      {row.mappedCount === 0 ? (
                        <QzBadge tone="warn">unmapped</QzBadge>
                      ) : row.mappedCount > 1 ? (
                        <QzBadge tone="draft">×{row.mappedCount}</QzBadge>
                      ) : null}
                    </div>
                  </td>
                  {matrix.columns.map((col) => (
                    <td
                      key={col.nodeId}
                      style={{
                        textAlign: "center",
                        padding: "8px",
                        borderTop: "1px solid var(--qz-rule, #00000010)",
                        background: col.categoryId === selectedCategoryId ? "#f5f9ff" : undefined,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={inSet.has(col.categoryId)}
                        onChange={() => onToggle(col.categoryId, row.productId)}
                        aria-label={`${row.title} in ${col.label}`}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={matrix.columns.length + 1} style={{ padding: 16 }} className="qz-dim">
                  No products match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
          <button
            className="qz-btn qz-btn-ghost qz-btn-sm"
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span className="qz-dim" style={{ fontSize: 12 }}>
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            className="qz-btn qz-btn-ghost qz-btn-sm"
            disabled={safePage >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}
