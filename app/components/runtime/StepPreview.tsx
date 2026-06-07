import { useMemo, type CSSProperties, type ReactNode } from "react";
import type { ContentBlock, Quiz, QuizNode } from "../../lib/quizSchema";
import { isFreeformType } from "../../lib/quizSchema";
import { resolveForBreakpoint, tokensToCssVars } from "../../lib/designTokens";
import { resolveNodeOverride } from "../../lib/resultLayout";
import type { IndexedProduct } from "../../lib/recommendationEngine";
import { synthesizeLayout } from "../../lib/synthesizeLayout";
import { BlockRenderer, type BlockRenderCtx } from "./BlockRenderer";
import { googleFontsUrl, stylesFor, type RuntimeStyles } from "./runtimeStyles";

type QuizDoc = Quiz;

// ───────────────────────────────────────────────────────────────────────────
// StepPreview — a faithful, NON-interactive preview of a single quiz step,
// used by the Studio builder (flow-view thumbnails + zoom editor). It renders
// through the SAME BlockRenderer the storefront uses, so what the merchant
// previews is what ships. A node WITH a layout renders its blocks; a node
// WITHOUT one renders synthesizeLayout(node) (its fixed template). Smart
// regions render static previews via previewRenderSmart.
// ───────────────────────────────────────────────────────────────────────────

function productById(
  productIndex: IndexedProduct[],
  id: string,
): IndexedProduct | undefined {
  return productIndex.find((p) => p.product_id === id);
}

function ProductRow({
  product,
  styles,
  title,
  price,
}: {
  product?: IndexedProduct;
  styles: RuntimeStyles;
  title?: string;
  price?: string;
}): ReactNode {
  const label = product?.title ?? title ?? "Product";
  const img = product?.image_url;
  return (
    <div style={{ ...styles.productCard, marginTop: 0 }}>
      {/* Real <img> mirrors the runtime (q.$id.tsx). A CSS background-image with
          an UNQUOTED url() silently fails on Shopify CDN URLs (which carry
          ?/&/commas), so the tile would paint blank in the builder preview. */}
      {img ? (
        <img
          src={img}
          alt=""
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            objectFit: "cover",
            flex: "0 0 auto",
            display: "block",
          }}
        />
      ) : (
        <div
          style={{ width: 56, height: 56, borderRadius: 8, background: "#0000000d", flex: "0 0 auto" }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: "calc(var(--qz-base-size) * 0.95)" }}>
          {label}
        </div>
        <div style={{ color: "var(--qz-color-muted)", fontSize: "0.85em" }}>
          {product?.price ?? price ?? ""}
        </div>
      </div>
    </div>
  );
}

// Static previews of the interactive ("smart") regions. Recognizable, not live.
export interface PreviewCategory {
  id: string;
  productIds: string[];
}

// Which products a result page actually resolves to, in ladder-ish order: its
// bound bucket (category_id → that category's productIds), else a bound
// collection, else an explicit conditional rule, else the whole catalog. Pure +
// exported so the preview is deterministic and unit-testable. (The live runtime
// uses the full recommendationEngine; this mirrors its common cases for preview.)
export function resolvePreviewProducts(
  node: QuizNode,
  productIndex: IndexedProduct[],
  categories: PreviewCategory[] | undefined,
): IndexedProduct[] {
  if (node.type !== "result") return productIndex;
  const d = node.data;
  const cat =
    d.category_id && categories ? categories.find((c) => c.id === d.category_id) : undefined;
  if (cat) {
    const set = new Set(cat.productIds);
    const pool = productIndex.filter((p) => set.has(p.product_id));
    if (pool.length) return pool;
  }
  if (d.collection_id) {
    const pool = productIndex.filter((p) => p.collection_ids.includes(d.collection_id as string));
    if (pool.length) return pool;
  }
  const rule = d.conditional_rules.find((r) => r.product_ids.length > 0);
  if (rule) {
    const set = new Set(rule.product_ids);
    const pool = productIndex.filter((p) => set.has(p.product_id));
    if (pool.length) return pool;
  }
  return productIndex;
}

function previewRenderSmart(
  block: ContentBlock,
  node: QuizNode,
  styles: RuntimeStyles,
  productIndex: IndexedProduct[],
  categories: PreviewCategory[] | undefined,
): ReactNode {
  switch (block.type) {
    case "answers": {
      if (node.type !== "question") return null;
      const qt = node.data.question_type;
      if (isFreeformType(qt)) {
        return (
          <input
            disabled
            placeholder={node.data.input_config?.placeholder || "Type your answer…"}
            style={{ ...styles.answerBtn, cursor: "default" }}
          />
        );
      }
      const grid = qt === "image_tile" || qt === "image_picker";
      return (
        <div
          style={{
            display: grid ? "grid" : "flex",
            flexDirection: grid ? undefined : "column",
            gridTemplateColumns: grid ? "repeat(2, 1fr)" : undefined,
            gap: 10,
          }}
        >
          {node.data.answers.map((a) => (
            <div key={a.id} style={{ ...styles.answerBtn, cursor: "default" }}>
              {/* Real <img>/<video> mirror the runtime (q.$id.tsx:1344/1395). An
                  unquoted CSS background url() silently fails on Shopify CDN
                  URLs (?/&/commas), which is why answer images were blank in
                  the preview while rendering fine in the live quiz. */}
              {a.image_url ? (
                <img
                  src={a.image_url}
                  alt=""
                  style={{
                    width: "100%",
                    height: 64,
                    objectFit: "cover",
                    borderRadius: 8,
                    marginBottom: 8,
                    display: "block",
                  }}
                />
              ) : a.video_url ? (
                <video
                  src={a.video_url}
                  muted
                  playsInline
                  style={{
                    width: "100%",
                    height: 64,
                    objectFit: "cover",
                    borderRadius: 8,
                    marginBottom: 8,
                    display: "block",
                  }}
                />
              ) : null}
              {a.text}
            </div>
          ))}
        </div>
      );
    }
    case "recommendations": {
      const count = node.type === "result" ? (node.data.max_products ?? node.data.slot_count) : 3;
      const pool =
        node.type === "result"
          ? resolvePreviewProducts(node, productIndex, categories)
          : productIndex;
      const sample = pool.slice(0, Math.max(1, Math.min(count, 4)));
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {sample.length > 0
            ? sample.map((p) => <ProductRow key={p.product_id} product={p} styles={styles} />)
            : Array.from({ length: 3 }).map((_, i) => (
                <ProductRow key={i} styles={styles} title="Recommended product" price="$—" />
              ))}
          <button style={{ ...styles.primaryBtn, cursor: "default" }} disabled>
            {node.type === "result" ? node.data.cta_label : "Shop now"}
          </button>
        </div>
      );
    }
    case "email_input": {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input disabled placeholder="you@example.com" style={{ ...styles.answerBtn, cursor: "default" }} />
          <button style={{ ...styles.primaryBtn, cursor: "default" }} disabled>
            Continue
          </button>
        </div>
      );
    }
    case "ai_chat": {
      if (node.type !== "ask_ai") return null;
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 600 }}>{node.data.persona_name}</div>
          <div
            style={{
              ...styles.answerBtn,
              cursor: "default",
              background: "#00000008",
            }}
          >
            {node.data.opening_message}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {node.data.suggested_questions.slice(0, 3).map((q, i) => (
              <span
                key={i}
                style={{
                  border: "1px solid #00000022",
                  borderRadius: 999,
                  padding: "4px 12px",
                  fontSize: "0.85em",
                }}
              >
                {q}
              </span>
            ))}
          </div>
        </div>
      );
    }
    case "product_grid": {
      if (node.type !== "product_cards") return null;
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {node.data.product_ids.map((id) => (
            <ProductRow key={id} product={productById(productIndex, id)} styles={styles} />
          ))}
        </div>
      );
    }
    default:
      return null;
  }
}

function InvisiblePlaceholder({
  node,
  styles,
}: {
  node: QuizNode;
  styles: RuntimeStyles;
}): ReactNode {
  const label =
    node.type === "branch"
      ? "Branch — invisible routing step"
      : "Integration — fires when reached, then continues";
  return (
    <div style={{ ...styles.card, textAlign: "center", color: "var(--qz-color-muted)" }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{node.type === "branch" ? "⑂" : "⇄"}</div>
      <div>{label}</div>
    </div>
  );
}

export function StepPreview({
  doc,
  node,
  productIndex,
  categories,
  breakpoint = "desktop",
  className,
  style,
}: {
  doc: QuizDoc;
  node: QuizNode;
  productIndex: IndexedProduct[];
  categories?: PreviewCategory[];
  breakpoint?: "desktop" | "mobile";
  className?: string;
  style?: CSSProperties;
}): ReactNode {
  const resolved = useMemo(() => {
    const baked = doc.design_tokens ?? null;
    const nodeOverride = resolveNodeOverride(
      node.id,
      node.type,
      doc.result_layout_mode,
      doc.design_overrides,
    );
    const bpLayer = doc.breakpoint_overrides[node.id]?.[breakpoint] ?? null;
    return resolveForBreakpoint(null, baked, nodeOverride, bpLayer);
  }, [doc, node, breakpoint]);

  const styles = useMemo(() => stylesFor(resolved), [resolved]);
  const cssVars = useMemo(
    () => tokensToCssVars(resolved) as CSSProperties,
    [resolved],
  );
  const fontUrl = useMemo(
    () =>
      googleFontsUrl([
        resolved.typography?.heading?.family ?? "",
        resolved.typography?.body?.family ?? "",
      ]),
    [resolved],
  );

  const blocks: ContentBlock[] = useMemo(() => {
    const own = doc.node_layouts[node.id];
    return own && own.length > 0 ? own : synthesizeLayout(node);
  }, [doc.node_layouts, node]);

  const ctx: BlockRenderCtx = {
    styles,
    nodeCss: doc.node_css[node.id] ?? null,
    resolveText: (t) => t,
    onPrimary: () => {},
    renderSmart: (block, n) => previewRenderSmart(block, n, styles, productIndex, categories),
  };

  return (
    <div className={className} style={{ ...cssVars, ...style }}>
      {fontUrl ? <link rel="stylesheet" href={fontUrl} /> : null}
      {blocks.length === 0 ? (
        <InvisiblePlaceholder node={node} styles={styles} />
      ) : (
        <BlockRenderer node={node} blocks={blocks} ctx={ctx} />
      )}
    </div>
  );
}
