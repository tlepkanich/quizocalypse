import { useContext, useState } from "react";
import type { RecommendedProduct } from "../../../lib/recommendationEngine";
import { cartPermalink, numericId } from "../../../lib/cartLink";
import { formatMoney } from "../../../lib/formatMoney";
import { discountedItemPrice } from "../../../lib/discountMath";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import {
  RuntimeCurrencyContext,
  RuntimeDiscountContext,
  RuntimeLocaleContext,
  RuntimePlatformContext,
  RuntimePreviewContext,
} from "../runtimeContexts";
import { addToCartFromQuiz } from "../addToCart";
import { NotifyMeForm } from "../bits/NotifyMeForm";

export function ProductCard({
  product,
  position,
  ctaLabel,
  href,
  styles,
  onClick,
  shopDomain,
  discountCode,
  discountLabel,
  onAdd,
  vertical = false,
  reasons,
  showVariants = false,
  showDescriptions = false,
  showPrice = true,
  showCta = true,
  imgFit,
  imgAspect,
  imgRadius,
  lowStockQty,
  oosNotify = false,
  quizId,
  sessionId,
  blurb,
  rating,
}: {
  product: RecommendedProduct;
  position: number;
  ctaLabel: string;
  // Spec §3 Mode B — token-resolved "why we recommend this" blurb.
  blurb?: string;
  // Spec §2 product-display toggles. showVariants gates the inline variant
  // picker; showDescriptions renders the baked description; lowStockQty (when a
  // number) renders the live "Only X left" urgency line.
  showVariants?: boolean;
  showDescriptions?: boolean;
  // QZY-5 (results-step4 §2.3/§2.5) — reveal display toggles + the light image
  // controls. Every default equals the pre-QZY rendering: price shown, CTA
  // shown, cover fit, square aspect (vertical), var(--qz-radius) corners.
  showPrice?: boolean;
  showCta?: boolean;
  imgFit?: "cover" | "contain";
  /** CSS aspect-ratio value (e.g. "3 / 4") — vertical cards only. */
  imgAspect?: string;
  /** Corner radius in px; absent = var(--qz-radius). */
  imgRadius?: number;
  lowStockQty?: number | null;
  // Spec §5 — when this card is sold out and the page's OOS behavior is
  // "notify_me", the CTA becomes an inline back-in-stock email capture.
  oosNotify?: boolean;
  quizId?: string;
  sessionId?: string;
  // When set, the info region links to the PDP (new tab). When omitted, it's a
  // click-tracked button.
  href?: string;
  styles: ReturnType<typeof stylesFor>;
  onClick?: () => void;
  // Phase 5 add-to-cart: a cart permalink is built when a shop domain + variant
  // are available; the CTA then becomes "Add to cart".
  shopDomain?: string;
  discountCode?: string;
  discountLabel?: string;
  onAdd?: () => void;
  // BIC P8: vertical card for the 2-column result's right rail — full-width
  // square image, text below, CTA at the bottom. Default horizontal everywhere
  // else, so nothing changes unless the split layout asks for it.
  vertical?: boolean;
  reasons?: string[];
  // Results-page redesign — a REAL baked review rating (productRating()); the
  // card renders a star row above the title only when this is present.
  rating?: { value: number; count?: number } | null;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  const strikethroughPercent = useContext(RuntimeDiscountContext);
  void position;
  // Selectable variant (Dev Spec §5). Defaults to the baked default variant;
  // the shopper can switch before adding to cart.
  const [selectedVariantId, setSelectedVariantId] = useState(
    product.default_variant_id ?? product.variants?.[0]?.id,
  );
  // Sold-out gate for the CURRENTLY-selected variant (recomputed per render so it
  // tracks the variant <select>). A priced OOS product stays VISIBLE under
  // oos_behavior=show_with_badge, but its cart CTA must not fire: a /cart
  // permalink for a sold-out variant adds nothing under Shopify's default
  // continue-selling=off. Per-variant when known, else product-level.
  const selectedVariant = product.variants?.find((v) => v.id === selectedVariantId);
  const soldOut = selectedVariant
    ? selectedVariant.available === false
    : product.inventory_in_stock === false;
  // QD-7 — standalone quizzes have no Shopify cart; gate the permalink off so
  // the CTA below becomes "Shop now" → the merchant's own product URL (`href`).
  const cartUrl =
    platform === "standalone" || soldOut
      ? null
      : cartPermalink(shopDomain, selectedVariantId, 1, discountCode);

  const infoStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: vertical ? "column" : "row",
    gap: 12,
    alignItems: vertical ? "stretch" : "center",
    flex: 1,
    minWidth: 0,
    color: "inherit",
    textDecoration: "none",
    background: "none",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    padding: 0,
    font: "inherit",
  };
  const ctaStyle: React.CSSProperties = {
    background: "var(--qz-color-text)",
    color: "var(--qz-color-bg)",
    border: "none",
    borderRadius: "var(--qz-radius)",
    padding: "8px 16px",
    fontSize: 14,
    flexShrink: 0,
    font: "inherit",
  };

  const info = (
    <>
      {product.image_url ? (
        <img
          src={product.image_url}
          alt=""
          loading="lazy"
          decoding="async"
          width={80}
          height={80}
          style={
            vertical
              ? {
          width: "100%",
          height: "auto",
          aspectRatio: imgAspect ?? "1 / 1",
          objectFit: imgFit ?? "cover",
          borderRadius: imgRadius ?? "var(--qz-radius)",
          // build-tab §4 guardrail — product imagery caps at 300px tall.
          maxHeight: 300,
        }
              : { width: 80, height: 80, objectFit: imgFit ?? "cover", borderRadius: imgRadius ?? "var(--qz-radius)", flexShrink: 0 }
          }
        />
      ) : (
        <div
          style={
            vertical
              ? { width: "100%", aspectRatio: imgAspect ?? "1 / 1", background: "#00000010", borderRadius: imgRadius ?? "var(--qz-radius)" }
              : { width: 80, height: 80, background: "#00000010", borderRadius: imgRadius ?? "var(--qz-radius)", flexShrink: 0 }
          }
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        {rating ? (
          <div
            style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 3, fontSize: 12 }}
            aria-label={tc("rating_stars", { value: rating.value })}
          >
            <span aria-hidden style={{ color: "#E0A33A", letterSpacing: 1 }}>
              {"★".repeat(Math.round(rating.value)) + "☆".repeat(5 - Math.round(rating.value))}
            </span>
            <span aria-hidden style={{ color: "var(--qz-color-muted)", fontSize: 11 }}>
              {rating.value.toFixed(1)}
              {rating.count != null ? ` (${rating.count})` : ""}
            </span>
          </div>
        ) : null}
        <div style={{ fontWeight: 600 }}>{product.title}</div>
        {blurb && blurb.trim() ? (
          <div style={{ fontSize: 13, color: "var(--qz-color-muted)", marginTop: 3, lineHeight: 1.4 }}>
            {blurb}
          </div>
        ) : null}
        {reasons && reasons.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
            <span style={{ fontSize: "0.7em", color: "var(--qz-color-muted, #888)", fontFamily: "var(--qz-font-body)" }}>
              {tc("because_you_chose")}
            </span>
            {reasons.map((r) => (
              <span
                key={r}
                style={{
                  fontSize: "0.7em",
                  fontFamily: "var(--qz-font-body)",
                  padding: "1px 8px",
                  borderRadius: 999,
                  background: "color-mix(in srgb, var(--qz-color-primary) 10%, transparent)",
                  whiteSpace: "nowrap",
                }}
              >
                {r}
              </span>
            ))}
          </div>
        ) : null}
        {showPrice &&
          product.price &&
          (() => {
            // Per-item struck price only for an unconditional percentage discount
            // that THIS result opts into (discountLabel set) AND that the quiz
            // marks strikethrough-eligible (RuntimeDiscountContext). Otherwise the
            // render is byte-identical to before: just the price + optional badge.
            const discounted =
              discountLabel && strikethroughPercent != null
                ? discountedItemPrice(Number(product.price), strikethroughPercent)
                : null;
            return (
              <div style={{ color: "var(--qz-color-muted)", marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {discounted != null ? (
                  <>
                    <span style={{ textDecoration: "line-through", opacity: 0.65 }}>
                      {formatMoney(product.price, currency, locale)}
                    </span>
                    <span style={{ color: "var(--qz-color-primary)", fontWeight: 700 }}>
                      {formatMoney(discounted, currency, locale)}
                    </span>
                  </>
                ) : (
                  <span>{formatMoney(product.price, currency, locale)}</span>
                )}
                {discountLabel ? (
                  <span style={{ background: "var(--qz-color-primary)", color: "#fff", borderRadius: 999, padding: "1px 8px", fontSize: 11, fontWeight: 600 }}>
                    {discountLabel}
                  </span>
                ) : null}
              </div>
            );
          })()}
        {typeof lowStockQty === "number" && lowStockQty > 0 && product.inventory_in_stock ? (
          <div style={{ color: "#B25E00", marginTop: 4, fontSize: 12, fontWeight: 600 }}>
            <span className="qz-urgency-pulse">{tc("only_x_left", { count: lowStockQty })}</span>
          </div>
        ) : null}
        {showDescriptions && product.description ? (
          <div
            style={{
              color: "var(--qz-color-muted)",
              marginTop: 6,
              fontSize: 13,
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {product.description}
          </div>
        ) : null}
        {!product.inventory_in_stock && (
          <div style={{ color: "#D72C0D", marginTop: 4, fontSize: 12 }}>{tc("out_of_stock")}</div>
        )}
      </div>
    </>
  );

  return (
    <div
      style={{
        ...styles.productCard,
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        gap: 12,
        alignItems: vertical ? "stretch" : "center",
      }}
    >
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" onClick={onClick} style={infoStyle}>
          {info}
        </a>
      ) : (
        <button type="button" onClick={onClick} style={infoStyle}>
          {info}
        </button>
      )}
      {/* QZY-5 §5 — showCta OFF removes the entire action column (the variant
          picker is add-to-cart's input, so it goes with it); the info region
          still links/tracks. Layout reflows via the parent flex. */}
      {!showCta ? null : (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", flexShrink: 0 }}>
        {/* Only show the variant picker on the cart path: selectedVariantId is
            consumed by add-to-cart (cartUrl) only. On standalone there's no
            cart and "Shop now" links to the variant-agnostic PDP, so the picker
            would be a dead, misleading control. */}
        {showVariants && cartUrl && product.variants && product.variants.length > 1 ? (
          <select
            aria-label={tc("aria_choose_variant")}
            value={selectedVariantId ?? ""}
            onChange={(e) => setSelectedVariantId(e.target.value)}
            style={{
              font: "inherit",
              fontSize: 13,
              padding: "6px 8px",
              borderRadius: "var(--qz-radius)",
              border: "1px solid #00000022",
              maxWidth: 180,
            }}
          >
            {product.variants.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.available}>
                {v.title}
                {v.available ? "" : " — sold out"}
              </option>
            ))}
          </select>
        ) : null}
        {cartUrl ? (
          <button
            type="button"
            onClick={() => {
              onAdd?.();
              if (isPreviewMode) return; // preview: no cart navigation / postMessage
              addToCartFromQuiz(cartUrl, numericId(selectedVariantId), Boolean(discountCode));
            }}
            style={{ ...ctaStyle, cursor: "pointer" }}
          >
            {tc("add_to_cart")}
          </button>
        ) : soldOut && oosNotify ? (
          // Spec §5 — sold out + notify_me: capture an email for back-in-stock
          // instead of a dead add-to-cart.
          <NotifyMeForm quizId={quizId} sessionId={sessionId} productId={product.product_id} compact />
        ) : soldOut && platform !== "standalone" ? (
          // Shopify + sold out: the add-to-cart would build a doomed permalink,
          // so show a disabled state instead (the OOS note above already explains).
          <button
            type="button"
            disabled
            style={{ ...ctaStyle, cursor: "not-allowed", opacity: 0.55 }}
          >
            {tc("out_of_stock")}
          </button>
        ) : platform === "standalone" && href ? (
          // QD-7 — standalone: a real "Shop now" link to the merchant's PDP
          // (the index `url`). Preview no-ops navigation like add-to-cart does.
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => {
              if (isPreviewMode) e.preventDefault();
              else onAdd?.();
            }}
            style={{ ...ctaStyle, cursor: "pointer", textDecoration: "none", textAlign: "center" }}
          >
            {tc("shop_now")}
          </a>
        ) : (
          <span style={{ ...ctaStyle, cursor: "default" }}>{ctaLabel}</span>
        )}
      </div>
      )}
    </div>
  );
}
