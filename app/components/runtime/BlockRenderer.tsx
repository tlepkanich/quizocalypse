import type { CSSProperties, ReactNode } from "react";
import type { ContentBlock, QuizNode } from "../../lib/quizSchema";
import { blockStyleToCss, isEmptyBlockStyle, nodeScopeClass, scopeNodeCss } from "./blockStyle";

// ───────────────────────────────────────────────────────────────────────────
// BlockRenderer (Phase 2) — the ONE shared renderer for a node's content-block
// stack, used by both the storefront runtime and the builder preview. It owns
// the card wrapper, literal blocks (heading/text/image/spacer/divider/button),
// per-block style, and scoped per-node CSS. The interactive "smart" regions
// (answers/recommendations/email_input/ai_chat/product_grid) are injected by
// the host via `renderSmart`, so this module stays free of runtime state and
// circular imports. No-layout nodes never reach here — the host renders their
// fixed template directly, keeping existing quizzes byte-identical.
// ───────────────────────────────────────────────────────────────────────────

// The subset of stylesFor(tokens) the literal blocks reuse so they line up
// with the fixed templates.
export interface BlockRenderStyles {
  card: CSSProperties;
  h1: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
  primaryBtn: CSSProperties;
}

export type SmartBlockType =
  | "answers"
  | "recommendations"
  | "email_input"
  | "ai_chat"
  | "product_grid";

export interface BlockRenderCtx {
  styles: BlockRenderStyles;
  // Raw merchant CSS for this node (scoped + injected here). Optional.
  nodeCss?: string | null;
  // Resolves a literal/bound text value (e.g. message merge tags). The runtime
  // wires this from the visited path; the builder returns the text as-is.
  resolveText?: (text: string, supportsMergeTags: boolean) => string;
  // Invoked when a literal `button` block is activated (typically advance).
  onPrimary?: (block: Extract<ContentBlock, { type: "button" }>, node: QuizNode) => void;
  // The host renders the interactive (runtime) or preview (builder) region for
  // a smart block.
  renderSmart: (block: ContentBlock, node: QuizNode) => ReactNode;
}

const SMART: Record<SmartBlockType, true> = {
  answers: true,
  recommendations: true,
  email_input: true,
  ai_chat: true,
  product_grid: true,
};

function isSmart(block: ContentBlock): boolean {
  return (SMART as Record<string, true | undefined>)[block.type] === true;
}

// Read a string field off the node's data (for `bind`), falling back to the
// block's own literal when the field is absent/empty.
function dataField(node: QuizNode, key: string): string | undefined {
  const data = node.data as Record<string, unknown>;
  const v = data[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function resolveBind(node: QuizNode, bind: string, literal: string): string {
  if (bind === "none") return literal;
  return dataField(node, bind) ?? literal;
}

function buttonVariantStyle(
  variant: "primary" | "outline" | "ghost",
  base: CSSProperties,
): CSSProperties {
  if (variant === "outline") {
    return {
      ...base,
      background: "transparent",
      border: "2px solid var(--qz-color-primary)",
      color: "var(--qz-color-primary)",
      boxShadow: "none",
    };
  }
  if (variant === "ghost") {
    return { ...base, background: "transparent", boxShadow: "none" };
  }
  return base;
}

function LiteralBlock({
  block,
  node,
  ctx,
}: {
  block: ContentBlock;
  node: QuizNode;
  ctx: BlockRenderCtx;
}): ReactNode {
  const { styles } = ctx;
  switch (block.type) {
    case "heading": {
      const text = resolveBind(node, block.bind, block.text);
      if (!text) return null;
      const base = block.level === "h1" ? styles.h1 : styles.h2;
      return block.level === "h1" ? <h1 style={base}>{text}</h1> : <h2 style={base}>{text}</h2>;
    }
    case "text": {
      const raw = resolveBind(node, block.bind, block.text);
      if (!raw) return null;
      const resolved = ctx.resolveText
        ? ctx.resolveText(raw, block.supports_merge_tags)
        : raw;
      return <p style={{ ...styles.muted, whiteSpace: "pre-wrap" }}>{resolved}</p>;
    }
    case "image": {
      const url =
        block.bind === "hero_image_url" ? dataField(node, "hero_image_url") : block.url;
      if (!url) return null;
      const aspect =
        block.aspect === "auto" ? undefined : block.aspect.replace("/", " / ");
      return (
        <img
          src={url}
          alt={block.alt}
          style={{
            width: "100%",
            objectFit: block.fit,
            borderRadius: "var(--qz-radius)",
            ...(aspect ? { aspectRatio: aspect } : {}),
          }}
        />
      );
    }
    case "spacer":
      return <div style={{ height: block.size }} aria-hidden />;
    case "divider":
      return (
        <hr
          style={{
            border: "none",
            borderTop: `${block.thickness}px solid ${block.color ?? "#00000018"}`,
            margin: 0,
            width: "100%",
          }}
        />
      );
    case "button": {
      const label = resolveBind(node, block.bind, block.label);
      const style = buttonVariantStyle(block.variant, styles.primaryBtn);
      // The only fixed-template link case: an `end` node's CTA opens its url.
      if (node.type === "end" && block.bind === "cta_label") {
        const href = dataField(node, "cta_url");
        if (href) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{
                ...style,
                display: "inline-block",
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {label}
            </a>
          );
        }
        return null;
      }
      return (
        <button style={style} onClick={() => ctx.onPrimary?.(block, node)}>
          {label}
        </button>
      );
    }
    default:
      return null;
  }
}

function BlockFrame({
  block,
  node,
  ctx,
}: {
  block: ContentBlock;
  node: QuizNode;
  ctx: BlockRenderCtx;
}): ReactNode {
  const inner = isSmart(block)
    ? ctx.renderSmart(block, node)
    : <LiteralBlock block={block} node={node} ctx={ctx} />;
  // Byte-identical guarantee: when a block carries no style + no class_name,
  // emit the bare element (no wrapper div) so synthesized layouts match the
  // fixed template's DOM box model.
  const hasStyle = !isEmptyBlockStyle(block.style);
  if (!hasStyle && !block.class_name) return inner;
  const className = ["qz-block", block.class_name].filter(Boolean).join(" ");
  return (
    <div className={className} data-qz-block={block.id} style={blockStyleToCss(block.style)}>
      {inner}
    </div>
  );
}

export function BlockRenderer({
  node,
  blocks,
  ctx,
}: {
  node: QuizNode;
  blocks: ContentBlock[];
  ctx: BlockRenderCtx;
}): ReactNode {
  const scope = nodeScopeClass(node.id);
  const scopedCss = ctx.nodeCss ? scopeNodeCss(node.id, ctx.nodeCss) : null;
  return (
    <div
      className={scope}
      style={{ ...ctx.styles.card, display: "flex", flexDirection: "column", gap: 16 }}
    >
      {scopedCss ? <style>{scopedCss}</style> : null}
      {/* QZY-7 — Layers hide/show: hidden blocks are kept in the layout but
          never rendered (absent = shown, so existing docs are unchanged). */}
      {blocks
        .filter((block) => block.hidden !== true)
        .map((block) => (
          <BlockFrame key={block.id} block={block} node={node} ctx={ctx} />
        ))}
    </div>
  );
}
