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
  // QZY-10 — the shopper's position for the `progress` block. The runtime
  // wires answered/total; the builder preview passes a fixed sample.
  progress?: { index: number; total: number } | null;
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
      const img = (
        <img
          src={url}
          alt={block.alt}
          style={{
            width: "100%",
            objectFit: block.fit,
            borderRadius: block.radius ?? "var(--qz-radius)",
            ...(aspect ? { aspectRatio: aspect } : {}),
            ...(block.height ? { height: block.height, aspectRatio: undefined } : {}),
          }}
        />
      );
      // QZY-10 §7 — optional click-through.
      return block.link ? (
        <a href={block.link} target="_blank" rel="noreferrer" style={{ display: "block" }}>
          {img}
        </a>
      ) : (
        img
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
    // ── QZY-10 §7 — the v1 inventory additions ──────────────────────────────
    case "video": {
      if (!block.url) return null;
      // Autoplay forces muted (browser policy + the spec's rule).
      const muted = block.autoplay ? true : block.muted;
      return (
        <video
          src={block.url}
          poster={block.poster}
          controls={block.controls}
          autoPlay={block.autoplay}
          loop={block.loop}
          muted={muted}
          playsInline
          style={{ width: "100%", borderRadius: "var(--qz-radius)", display: "block" }}
        >
          {/* R7-2 §7.3 — captions track when provided. */}
          {block.captions ? <track kind="captions" src={block.captions} default /> : null}
        </video>
      );
    }
    case "progress": {
      const p = ctx.progress;
      const total = Math.max(1, p?.total ?? 5);
      const index = Math.min(total, Math.max(0, p?.index ?? 2));
      const color = block.color ?? "var(--qz-color-primary)";
      const track = block.track_color ?? "color-mix(in srgb, var(--qz-color-text) 12%, transparent)";
      if (block.bar_style === "steps") {
        return (
          <div style={{ ...styles.muted, fontSize: "0.8em", fontWeight: 600 }}>
            {index} of {total}
          </div>
        );
      }
      // R7-2 §7.1 — radius (absent → the pill 999) + an optional "N of M" count
      // alongside the bar/dots (absent → the bar/dots node exactly as before).
      const body =
        block.bar_style === "dots" ? (
          <div style={{ display: "flex", gap: 6 }} aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                style={{
                  width: block.thickness + 2,
                  height: block.thickness + 2,
                  borderRadius: 999,
                  background: i < index ? color : track,
                }}
              />
            ))}
          </div>
        ) : (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={index}
            style={{
              height: block.thickness,
              borderRadius: block.radius ?? 999,
              background: track,
              overflow: "hidden",
              flex: block.show_count ? 1 : undefined,
            }}
          >
            <div
              style={{
                width: `${Math.round((index / total) * 100)}%`,
                height: "100%",
                background: color,
              }}
            />
          </div>
        );
      if (!block.show_count) return body;
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {body}
          <span style={{ ...styles.muted, fontSize: "0.8em", fontWeight: 600, whiteSpace: "nowrap" }}>
            {index} of {total}
          </span>
        </div>
      );
    }
    case "logo": {
      if (!block.url) return null;
      return (
        <div style={{ textAlign: block.align }}>
          <img
            src={block.url}
            alt=""
            style={{ height: block.size, maxWidth: "100%", display: "inline-block" }}
          />
        </div>
      );
    }
    case "content": {
      if (!block.text.trim()) return null;
      return <RichText text={block.text} muted={styles.muted} />;
    }
    case "button": {
      const label = resolveBind(node, block.bind, block.label);
      const style = {
        ...buttonVariantStyle(block.variant, styles.primaryBtn),
        ...(block.full_width ? { width: "100%" } : {}),
      };
      const withIcon = block.icon ? `${block.icon} ${label}` : label;
      // QZY-10 §7 — explicit on-click actions. "link" opens href; start/next/
      // submit all advance (authoring-intent names for onPrimary). Absent =
      // today's behavior exactly.
      if (block.action === "link" && block.href) {
        return (
          <a
            href={block.href}
            target="_blank"
            rel="noreferrer"
            style={{ ...style, display: "inline-block", textAlign: "center", textDecoration: "none" }}
          >
            {withIcon}
          </a>
        );
      }
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
          {withIcon}
        </button>
      );
    }
    default:
      return null;
  }
}

// QZY-10 §7 — a SAFE minimal rich-text renderer: blank-line paragraphs,
// "- " list items, and [text](https://url) links, built as React nodes
// (never raw HTML).
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

function inlineWithLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a
        key={at}
        href={m[2]}
        target="_blank"
        rel="noreferrer"
        style={{ color: "var(--qz-color-primary)" }}
      >
        {m[1]}
      </a>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function RichText({ text, muted }: { text: string; muted: CSSProperties }) {
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {paragraphs.map((para, i) => {
        const lines = para.split("\n");
        const isList = lines.every((l) => l.trim().startsWith("- ") || l.trim() === "");
        if (isList) {
          return (
            <ul key={i} style={{ ...muted, margin: 0, paddingLeft: 20 }}>
              {lines
                .filter((l) => l.trim().startsWith("- "))
                .map((l, j) => (
                  <li key={j}>{inlineWithLinks(l.trim().slice(2))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ ...muted, margin: 0, whiteSpace: "pre-wrap" }}>
            {inlineWithLinks(para)}
          </p>
        );
      })}
    </div>
  );
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
