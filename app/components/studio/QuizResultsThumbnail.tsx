import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { QuizCardThumb, QuizCardProduct } from "../../lib/quizLibraryCard";

function ProductImage({ product, fit }: { product: QuizCardProduct; fit: "cover" | "contain" }) {
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A cached/network failure can happen before hydration attaches onError.
    const image = imageRef.current;
    setFailed(Boolean(image?.complete && image.naturalWidth === 0));
  }, [product.imageUrl]);
  return (
    <div className="qz-result-thumb-photo">
      {product.imageUrl && !failed ? (
        <img ref={imageRef} src={product.imageUrl} alt="" loading="lazy" style={{ objectFit: fit }} onError={() => setFailed(true)} />
      ) : <span className="qz-result-thumb-monogram">{product.title.trim().charAt(0) || "—"}</span>}
    </div>
  );
}

/** An image-led sample of the results design; no shopper answers or invented rankings. */
export function QuizResultsThumbnail({ thumb, products }: { thumb: QuizCardThumb; products: QuizCardProduct[] }) {
  const results = thumb.results;
  if (!results) return null;
  const shown = products.slice(0, results.layout === "single_hero" ? 1 : 3);
  return (
    <div className="qz-result-thumb" aria-hidden style={{
      "--result-bg": thumb.bg,
      "--result-ink": thumb.text,
      "--result-accent": thumb.primary,
      ...(thumb.font ? { fontFamily: thumb.font } : {}),
    } as CSSProperties}>
      <div className="qz-result-thumb-page">
        <div className="qz-result-thumb-header">
          {thumb.logoUrl ? <img src={thumb.logoUrl} alt="" loading="lazy" /> : null}
          <span>Results preview</span>
        </div>
        <div className="qz-result-thumb-heading">{results.headline}</div>
        {shown.length ? (
          <div className={`qz-result-thumb-products is-${results.layout}${shown.length === 1 ? " is-single" : ""}`}>
            {shown.map((product) => (
              <div className="qz-result-thumb-product" key={product.id}>
                <ProductImage product={product} fit={results.imgFit} />
                <div className="qz-result-thumb-name">{product.title}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="qz-result-thumb-empty">
            <span className="qz-result-thumb-empty-mark">{(thumb.headline === "New quiz" ? "W" : thumb.headline).charAt(0)}</span>
            <span>Your product collection<br />will appear here</span>
          </div>
        )}
        <div className="qz-result-thumb-footer"><span /> <span /> <span /></div>
      </div>
    </div>
  );
}
