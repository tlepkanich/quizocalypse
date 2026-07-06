import { useContext } from "react";
import type { Quiz } from "../../../lib/quizSchema";
import type { IndexedProduct } from "../../../lib/recommendationEngine";
import { productHref } from "../../../lib/productHref";
import { formatMoney } from "../../../lib/formatMoney";
import type { stylesFor } from "../runtimeStyles";
import { useChrome } from "../chromeStrings";
import {
  RuntimeCurrencyContext,
  RuntimeLocaleContext,
  RuntimePlatformContext,
} from "../runtimeContexts";
import type { InspectPart } from "../inspect";

type QuizDoc = Quiz;

// Visible step that shows merchant-picked products as cards. Distinct from
// Result (scored recommendations on the path) and the mid-quiz preview rail
// (refining list). Products that aren't in product_index render a graceful
// fallback so a deleted SKU doesn't break the step.
export function ProductCardsView({
  node,
  productIndex,
  shopDomain,
  styles,
  onContinue,
  inspect,
}: {
  node: Extract<
    QuizDoc["nodes"][number],
    { type: "product_cards" }
  >;
  productIndex: IndexedProduct[];
  shopDomain: string;
  styles: ReturnType<typeof stylesFor>;
  onContinue: () => void;
  inspect?: (part: InspectPart) => React.HTMLAttributes<HTMLElement>;
}) {
  const tc = useChrome();
  const platform = useContext(RuntimePlatformContext);
  const currency = useContext(RuntimeCurrencyContext);
  const locale = useContext(RuntimeLocaleContext);
  const products = node.data.product_ids
    .map((id) => productIndex.find((p) => p.product_id === id))
    .filter((p): p is IndexedProduct => !!p);

  return (
    <div style={styles.card}>
      <h2 style={styles.h2} {...(inspect?.("pc_headline") ?? {})}>{node.data.headline}</h2>
      {node.data.subtext && (
        <p style={{ ...styles.muted, marginTop: 8 }} {...(inspect?.("pc_subtext") ?? {})}>
          {node.data.subtext}
        </p>
      )}
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${products.length > 2 ? 180 : 240}px, 1fr))`,
          gap: 12,
        }}
      >
        {products.map((p) => (
          <a
            key={p.product_id}
            href={productHref(p, shopDomain, platform) ?? `#${p.handle}`}
            target="_blank"
            rel="noreferrer"
            style={{
              ...styles.productCard,
              flexDirection: "column",
              alignItems: "stretch",
              gap: 8,
            }}
          >
            {p.image_url && (
              <img
                src={p.image_url}
                alt=""
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "cover",
                  borderRadius: "var(--qz-radius)",
                }}
              />
            )}
            <div style={{ fontWeight: 600, fontSize: 14 }}>{p.title}</div>
            {p.price && (
              <div
                style={{
                  color: "var(--qz-color-muted)",
                  fontSize: 12,
                }}
              >
                {formatMoney(p.price, currency, locale)}
              </div>
            )}
            <span
              style={{
                marginTop: 4,
                fontSize: 12,
                color: "var(--qz-color-primary)",
                fontWeight: 600,
              }}
            >
              {node.data.cta_label} →
            </span>
          </a>
        ))}
        {products.length === 0 && (
          <div
            style={{
              padding: 16,
              border: "1px dashed #00000022",
              borderRadius: "var(--qz-radius)",
              color: "var(--qz-color-muted)",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {tc("no_products_configured")}
          </div>
        )}
      </div>
      <button style={{ ...styles.primaryBtn, marginTop: 16 }} onClick={onContinue}>
        {node.data.continue_label}
      </button>
    </div>
  );
}
