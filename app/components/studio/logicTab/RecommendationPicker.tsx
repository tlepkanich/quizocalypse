import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BuilderCategory } from "../../builder/stepProps";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { QzPopover } from "../../qz-overlays";

const kinds = [
  "All",
  "Collections",
  "Single products",
  "Tag buckets",
  "Custom groups",
] as const;
function kind(c: BuilderCategory): (typeof kinds)[number] {
  if ((c.source === "collection" || c.source === "smart_collection")) return "Collections";
  if (c.source === "product") return "Single products";
  if (c.source === "tag") return "Tag buckets";
  return "Custom groups";
}
function Thumbnail({
  category,
  products,
}: {
  category: BuilderCategory;
  products: IndexedProduct[];
}) {
  const image = products.find(
    (p) => category.productIds.includes(p.product_id) && p.image_url,
  )?.image_url;
  return image ? (
    <img src={image} alt="" className="qz-qwidget-thumb" />
  ) : (
    <span className="qz-qwidget-thumb" aria-hidden>
      ▧
    </span>
  );
}

export function RecommendationPicker({
  trigger,
  categories,
  products,
  selectedId,
  onPick,
}: {
  trigger: ReactNode;
  categories: BuilderCategory[];
  products: IndexedProduct[];
  selectedId?: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof kinds)[number]>("All");
  const [detail, setDetail] = useState<BuilderCategory | null>(null);
  const selected = categories.find((c) => c.id === selectedId);
  return (
    <QzPopover
      fitViewport
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          setFilter("All");
          setDetail(null);
        }
      }}
      maxWidth={400}
      trigger={trigger}
      content={
        <div className="qz-lw-vp qz-qwidget-picker">
          {detail ? (
            <>
              <button
                type="button"
                className="qz-btn qz-btn-sm"
                onClick={() => setDetail(null)}
              >
                Back to recommendations
              </button>
              <h4>{detail.name}</h4>
              <div className="qz-lw-vp-list">
                {detail.productIds.map((id) => {
                  const p = products.find((item) => item.product_id === id);
                  return (
                    <div key={id} className="qz-qwidget-product">
                      {p?.image_url ? <img src={p.image_url} alt="" /> : null}
                      <span>{p?.title ?? "Product details unavailable"}</span>
                    </div>
                  );
                })}
                {!detail.productIds.length ? (
                  <p>No products in this recommendation.</p>
                ) : null}
              </div>
              <button
                type="button"
                className="qz-btn qz-btn-primary"
                onClick={() => {
                  onPick(detail.id);
                  setOpen(false);
                }}
              >
                Choose {detail.name}
              </button>
            </>
          ) : (
            <>
              <input
                aria-label="Search recommendations"
                className="qz-lw-vp-srch"
                type="search"
                placeholder="Search recommendations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="qz-lw-vp-tfilt">
                {kinds.map((k) => (
                  <button
                    type="button"
                    key={k}
                    className={`qz-lw-vp-tf${filter === k ? " is-on" : ""}`}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div
                className="qz-lw-vp-list"
                role="radiogroup"
                aria-label="Recommendations"
              >
                {categories
                  .filter(
                    (c) =>
                      (filter === "All" || kind(c) === filter) &&
                      c.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((c) => (
                    <div key={c.id} className="qz-qwidget-pickrow">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={c.id === selectedId}
                        className={`qz-lw-vp-opt${c.id === selectedId ? " is-on" : ""}`}
                        onClick={() => {
                          onPick(c.id);
                          setOpen(false);
                        }}
                      >
                        <Thumbnail category={c} products={products} />
                        <span>{c.name}</span>
                        <span>{c.id === selectedId ? "✓" : ""}</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`View products in ${c.name}`}
                        onClick={() => setDetail(c)}
                      >
                        ›
                      </button>
                    </div>
                  ))}
                {!categories.some(
                  (c) =>
                    (filter === "All" || kind(c) === filter) &&
                    c.name.toLowerCase().includes(search.toLowerCase()),
                ) ? (
                  <p className="qz-lw-vp-none">
                    No recommendations match. Review your selections in step 1.
                  </p>
                ) : null}
              </div>
              <div className="qz-lw-vp-foot">
                {selected
                  ? `${selected.name}: ${selected.productIds.length} products`
                  : "Choose one recommendation"}
                <button
                  type="button"
                  className="qz-btn qz-btn-sm"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      }
    />
  );
}

/** Measure actual card wrapping, including the overflow tile, at every width. */
export function RecommendationTray({
  categories,
  products,
  armed,
  onArm,
}: {
  categories: BuilderCategory[];
  products: IndexedProduct[];
  armed: string | null;
  onArm?: (id: string | null) => void;
}) {
  const measure = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(categories.length);
  useLayoutEffect(() => {
    const root = measure.current;
    if (!root) return;
    const layout = () => {
      const cards = Array.from(root.children) as HTMLElement[];
      const more = cards.pop();
      if (!more) return;
      cards.forEach((c) => {
        c.hidden = false;
      });
      more.hidden = true;
      const tops = [...new Set(cards.map((c) => c.offsetTop))];
      let n = cards.findIndex((c) => c.offsetTop > (tops[1] ?? tops[0] ?? 0));
      if (n < 0) n = cards.length;
      if (n < cards.length) {
        cards.forEach((c, i) => {
          c.hidden = i >= n;
        });
        more.hidden = false;
        more.textContent = `See ${cards.length - n} more`;
        while (n > 0 && more.offsetTop > (tops[1] ?? tops[0] ?? 0)) {
          cards[--n]!.hidden = true;
          more.textContent = `See ${cards.length - n} more`;
        }
      }
      setVisible(n);
    };
    const observer = new ResizeObserver(layout);
    observer.observe(root);
    layout();
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) layout();
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [categories]);
  const selected = categories.find((c) => c.id === armed);
  return (
    <section
      className="qz-qwidget-tray"
      aria-label="Recommendations from step 1"
    >
      <div className="qz-qwidget-trayhead">
        <span>Recommendations from step 1</span>
        {onArm ? (
          <RecommendationPicker
            trigger={
              <button type="button" className="qz-btn qz-btn-sm">
                Browse all
              </button>
            }
            categories={categories}
            products={products}
            selectedId={armed ?? undefined}
            onPick={onArm}
          />
        ) : null}
      </div>
      <div className="qz-qwidget-measure" aria-hidden ref={measure}>
        {categories.map((c) => (
          <span key={c.id} className="qz-qwidget-card">
            <Thumbnail category={c} products={products} />
            <span>{c.name}</span>
          </span>
        ))}
        <span className="qz-qwidget-card">See {categories.length} more</span>
      </div>
      <div className="qz-qwidget-cards">
        {categories.slice(0, visible).map((c) => (
          <button
            type="button"
            key={c.id}
            disabled={!onArm}
            className={`qz-qwidget-card${armed === c.id ? " is-armed" : ""}`}
            aria-pressed={armed === c.id}
            onClick={() => onArm?.(armed === c.id ? null : c.id)}
          >
            <Thumbnail category={c} products={products} />
            <span>{c.name}</span>
          </button>
        ))}
        {visible < categories.length && onArm ? (
          <RecommendationPicker
            trigger={
              <button type="button" className="qz-qwidget-card">
                See {categories.length - visible} more
              </button>
            }
            categories={categories}
            products={products}
            selectedId={armed ?? undefined}
            onPick={onArm}
          />
        ) : null}
      </div>
      {selected ? (
        <div className="qz-qwidget-armed">
          <span>{selected.name}: choose an answer to place it.</span>
          <RecommendationPicker
            trigger={
              <button type="button" className="qz-btn qz-btn-sm">
                View {selected.productIds.length} products
              </button>
            }
            categories={[selected]}
            products={products}
            selectedId={selected.id}
            onPick={() => onArm?.(selected.id)}
          />
          <button
            type="button"
            className="qz-btn qz-btn-sm"
            onClick={() => onArm?.(null)}
          >
            Cancel placement
          </button>
        </div>
      ) : null}
      {!categories.length ? (
        <p>Add recommendations in step 1 to map your answers.</p>
      ) : null}
    </section>
  );
}
