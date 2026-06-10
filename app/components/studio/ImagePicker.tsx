import { useMemo, useState } from "react";

// Image picker for answer images (editor revamp P3). Two sources, zero new
// infrastructure: browse the already-synced product catalog's images, or paste
// a URL. Inline-expanding (rendered under the answer row by the InspectorPanel).

export interface PickerProduct {
  product_id: string;
  title: string;
  image_url: string | null;
}

export function ImagePicker({
  products,
  value,
  onPick,
}: {
  products: PickerProduct[];
  value?: string;
  onPick: (url: string | undefined) => void;
}) {
  const [tab, setTab] = useState<"products" | "url">("products");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const withImages = useMemo(
    () => products.filter((p): p is PickerProduct & { image_url: string } => !!p.image_url),
    [products],
  );
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? withImages.filter((p) => p.title.toLowerCase().includes(needle))
    : withImages;
  const urlOk = /^https:\/\/.+/.test(url.trim());

  return (
    <div
      style={{
        border: "1px solid #00000018",
        borderRadius: 8,
        padding: 8,
        background: "#fafafa",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="qz-segmented" role="group" aria-label="Image source">
        <button type="button" aria-pressed={tab === "products"} onClick={() => setTab("products")}>
          Your products
        </button>
        <button type="button" aria-pressed={tab === "url"} onClick={() => setTab("url")}>
          URL
        </button>
      </div>

      {tab === "products" ? (
        withImages.length === 0 ? (
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            No product images synced yet — paste a URL instead.
          </p>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              style={{
                font: "inherit",
                fontSize: 12.5,
                padding: "5px 8px",
                borderRadius: 6,
                border: "1px solid #00000022",
              }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 6,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {filtered.slice(0, 48).map((p) => (
                <button
                  key={p.product_id}
                  type="button"
                  title={p.title}
                  onClick={() => onPick(p.image_url)}
                  style={{
                    padding: 0,
                    border:
                      value === p.image_url
                        ? "2px solid var(--qz-accent, #2a6df4)"
                        : "1px solid #00000018",
                    borderRadius: 6,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "#fff",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <img
                    src={p.image_url}
                    alt={p.title}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
            </div>
          </>
        )
      ) : (
        <div className="qz-row" style={{ gap: 6 }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            style={{
              flex: 1,
              font: "inherit",
              fontSize: 12.5,
              padding: "5px 8px",
              borderRadius: 6,
              border: "1px solid #00000022",
            }}
          />
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            disabled={!urlOk}
            onClick={() => onPick(url.trim())}
          >
            Use
          </button>
        </div>
      )}

      {value ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => onPick(undefined)}
        >
          Remove image
        </button>
      ) : null}
    </div>
  );
}
