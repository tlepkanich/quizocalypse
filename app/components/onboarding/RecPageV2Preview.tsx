import { useMemo } from "react";
import type { Quiz as QuizDoc } from "../../lib/quizSchema";
import type { BuilderCategory } from "../builder/stepProps";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import { settingsForTarget, targetProducts } from "../../lib/recommendDecider";

// rec-page-spec-V2 §11.1 — the client-side live preview for DECIDER docs.
// Renders straight from in-memory settings through the REAL v2 engine
// (settingsForTarget + targetProducts) — no debounce, re-renders per change.
// Draft-time membership comes from the Step-1 Category rows (the publish bake
// later swaps in the merchant's true Shopify collection order); the preview
// says so. Previews BOTH target shapes: individual product = hero only,
// collection/tag = hero + grid. Lightweight mock, NOT the runtime (the true
// capture → loading → reveal ships at L2-9).
export function RecPageV2Preview({
  doc,
  categories,
  productIndex,
  targetId,
}: {
  doc: QuizDoc;
  categories: BuilderCategory[];
  productIndex: IndexedProduct[];
  /** The previewed target — null falls back to the first bucket. */
  targetId: string | null;
}) {
  const target = (targetId && categories.find((c) => c.id === targetId)) || categories[0] || null;

  const view = useMemo(() => {
    if (!target) return null;
    const config = settingsForTarget(doc.rec_page_settings, target.id);
    const shape = target.source === "product" ? ("product" as const) : ("collection" as const);
    const products = targetProducts({
      targetId: target.id,
      targetShape: shape,
      config,
      productIndex,
      targetProductIdsMap: { [target.id]: target.productIds },
    });
    return { config, shape, products };
  }, [doc.rec_page_settings, target, productIndex]);

  if (!target || !view) {
    return <p className="qz-dim">No result targets yet — pick recommendations in Step 1.</p>;
  }
  const { config, shape, products } = view;

  const incentive =
    config.incentiveOn && config.incentiveCode ? (
      <div className="qz-rp2p-incentive">
        🎉 Use code <strong>{config.incentiveCode}</strong>
        {config.incentiveAutoApply ? " — applied automatically at checkout" : " at checkout"}
      </div>
    ) : null;

  const card = (p: IndexedProduct, hero: boolean) => (
    <div key={p.product_id} className={`qz-rp2p-card${hero ? " is-hero" : ""}`}>
      {p.image_url ? (
        <img src={p.image_url} alt="" width={hero ? 220 : 120} height={hero ? 160 : 90} />
      ) : (
        <div className="qz-rp2p-noimg" aria-hidden />
      )}
      <div className="qz-rp2p-card-body">
        <div className="qz-rp2p-title">{p.title}</div>
        {p.price != null && Number.isFinite(Number(p.price)) ? (
          <div className="qz-rp2p-price">${Number(p.price).toFixed(2)}</div>
        ) : null}
        {hero && config.showDesc && p.description ? (
          <p className="qz-rp2p-desc">{p.description.slice(0, 140)}</p>
        ) : null}
        {p.inventory_in_stock === false ? (
          <span className="qz-rp2p-oos">Out of stock</span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="qz-rp2p" data-target-shape={shape}>
      <div className="qz-rp2p-frame-note">
        Previewing <strong>{target.name}</strong> ({shape === "product" ? "single product — hero only" : "collection/tag — hero + grid"}).
        Draft order comes from your recommendation; publishing bakes your real Shopify collection order.
        {doc.rec_page_settings?.overrides?.[target.id]
          ? " This result has its own overrides — global edits may not show here."
          : ""}
      </div>

      {config.incentivePos === "banner" ? incentive : null}
      <h2 className="qz-rp2p-headline">{config.headline}</h2>
      {config.incentivePos === "below-headline" ? incentive : null}

      {config.whyOn ? <div className="qz-rp2p-why">{config.whyCopy}</div> : null}

      {products.poolSize === 0 ? (
        <div className="qz-rp2p-empty">
          {config.emptyFallback === "collection"
            ? `Empty result → the fallback collection${config.emptyFallbackCol ? "" : " (pick one in settings)"} renders here.`
            : "Empty result → a graceful “nothing to show” message renders here."}
          {config.safetyNetCol ? " Safety-net collection is armed." : ""}
        </div>
      ) : (
        <>
          {products.hero ? card(products.hero, true) : null}
          {shape !== "product" && products.grid.length > 0 ? (
            <div className="qz-rp2p-grid">{products.grid.map((p) => card(p, false))}</div>
          ) : null}
          {products.allOutOfStock ? (
            <p className="qz-dim" style={{ fontSize: 12 }}>
              Everything here is out of stock — badges shown, add-to-cart disabled (§5).
            </p>
          ) : null}
        </>
      )}

      {config.incentivePos === "bottom" ? incentive : null}
    </div>
  );
}
