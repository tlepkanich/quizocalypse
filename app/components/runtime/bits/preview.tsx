import { useContext, useState } from "react";
import type { RecommendedProduct } from "../../../lib/recommendationEngine";
import { cartPermalink, numericId } from "../../../lib/cartLink";
import { productHref } from "../../../lib/productHref";
import { formatMoney } from "../../../lib/formatMoney";
import { useChrome } from "../chromeStrings";
import {
  RuntimeCurrencyContext,
  RuntimeLocaleContext,
  RuntimePlatformContext,
  RuntimePreviewContext,
} from "../runtimeContexts";
import { addToCartFromQuiz } from "../addToCart";

export function PreviewRail({
  recs,
  shopDomain,
  onClick,
  onAdd,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
  onAdd?: (product: RecommendedProduct, position: number) => void;
}) {
  return (
    <aside
      style={{
        background: "var(--qz-color-bg)",
        borderRadius: "var(--qz-radius)",
        padding: 20,
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--qz-font-body)",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--qz-color-muted)",
          marginBottom: 4,
        }}
      >
        Picks for you
      </div>
      <div
        style={{
          fontFamily: "var(--qz-font-heading)",
          fontSize: 20,
          marginBottom: 14,
          color: "var(--qz-color-text)",
        }}
      >
        Updating as you answer
      </div>
      <PreviewList recs={recs} shopDomain={shopDomain} onClick={onClick} onAdd={onAdd} />
    </aside>
  );
}

export function PreviewChip({
  recs,
  shopDomain,
  onClick,
  onAdd,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
  onAdd?: (product: RecommendedProduct, position: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="qz-preview-chip"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 50,
          padding: "8px 14px",
          background: "var(--qz-color-text)",
          color: "var(--qz-color-bg)",
          border: "none",
          borderRadius: 100,
          fontSize: 13,
          fontFamily: "var(--qz-font-body)",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        }}
      >
        Picks for you ({recs.length}) {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.4)",
              zIndex: 49,
            }}
          />
          <div
            style={{
              position: "fixed",
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 50,
              background: "var(--qz-color-bg)",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: 20,
              maxHeight: "70vh",
              overflowY: "auto",
              boxShadow: "0 -8px 32px rgba(0,0,0,0.2)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--qz-font-heading)",
                fontSize: 22,
                marginBottom: 12,
                color: "var(--qz-color-text)",
              }}
            >
              Picks for you
            </div>
            <PreviewList recs={recs} shopDomain={shopDomain} onClick={onClick} onAdd={onAdd} />
          </div>
        </>
      )}
    </>
  );
}

function PreviewList({
  recs,
  shopDomain,
  onClick,
  onAdd,
}: {
  recs: RecommendedProduct[];
  shopDomain: string;
  onClick: (product: RecommendedProduct, position: number) => void;
  onAdd?: (product: RecommendedProduct, position: number) => void;
}) {
  const tc = useChrome();
  const isPreviewMode = useContext(RuntimePreviewContext);
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  if (recs.length === 0) {
    return (
      <p
        style={{
          color: "var(--qz-color-muted)",
          fontSize: 13,
          margin: 0,
        }}
      >
        {tc("pick_more_answers")}
      </p>
    );
  }
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {recs.map((r, idx) => {
        const href = productHref(r, shopDomain, platform);
        const inner = (
          <>
            {r.image_url ? (
              <img
                src={r.image_url}
                alt=""
                style={{
                  width: 56,
                  height: 56,
                  objectFit: "cover",
                  borderRadius: "var(--qz-radius)",
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  background: "#00000010",
                  borderRadius: "var(--qz-radius)",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 500,
                  fontSize: 14,
                  color: "var(--qz-color-text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.title}
              </div>
              {r.price && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--qz-color-muted)",
                    marginTop: 2,
                  }}
                >
                  {formatMoney(r.price, currency, locale)}
                </div>
              )}
            </div>
          </>
        );
        const cardStyle: React.CSSProperties = {
          display: "flex",
          gap: 10,
          alignItems: "center",
          padding: 8,
          borderRadius: "var(--qz-radius)",
          border: "1px solid #00000012",
          textDecoration: "none",
          color: "inherit",
          background: "var(--qz-color-bg)",
        };
        // QD-7 — standalone has no Shopify cart; the mid-quiz "Add" chip is
        // gated off (the card still links to the merchant PDP via `href`).
        // Also gate off when sold out: a /cart permalink for an OOS variant adds
        // nothing under Shopify's default continue-selling=off.
        const cartUrl =
          platform === "standalone" || r.inventory_in_stock === false
            ? null
            : cartPermalink(shopDomain, r.default_variant_id, 1);
        const infoFlex: React.CSSProperties = {
          display: "flex",
          gap: 10,
          alignItems: "center",
          flex: 1,
          minWidth: 0,
          textDecoration: "none",
          color: "inherit",
        };
        return (
          <div key={r.product_id} style={cardStyle}>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" onClick={() => onClick(r, idx)} style={infoFlex}>
                {inner}
              </a>
            ) : (
              <div style={infoFlex}>{inner}</div>
            )}
            {cartUrl && onAdd ? (
              <button
                type="button"
                onClick={() => {
                  onAdd(r, idx);
                  if (isPreviewMode) return; // preview: no cart navigation
                  addToCartFromQuiz(cartUrl, numericId(r.default_variant_id), false);
                }}
                style={{
                  flexShrink: 0,
                  border: "1px solid var(--qz-color-primary)",
                  color: "var(--qz-color-primary)",
                  background: "transparent",
                  borderRadius: "var(--qz-radius)",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                Add
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
