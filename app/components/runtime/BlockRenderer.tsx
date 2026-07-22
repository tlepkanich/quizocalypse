import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ContentBlock, QuizNode } from "../../lib/quizSchema";
import { blockStyleToCss, isEmptyBlockStyle, nodeScopeClass, scopeNodeCss } from "./blockStyle";

// build-tab §5 — the star row shared by testimonial + review_stars: filled
// stars in the brand primary (or the block's color), the remainder dimmed.
// Fractional ratings round to the nearest whole star (no half-star glyphs).
function StarRow({ rating, size, color }: { rating: number; size: number; color?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const on = color ?? "var(--qz-color-primary)";
  return (
    <span
      aria-label={`${rating} out of 5 stars`}
      style={{ display: "inline-flex", gap: 2, fontSize: size, lineHeight: 1 }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} aria-hidden style={{ color: i < filled ? on : "color-mix(in srgb, currentColor 22%, transparent)" }}>
          ★
        </span>
      ))}
    </span>
  );
}

// §5 coupon — the copy affordance. Static block content, clipboard-only.
function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(code).then(
          () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          },
          () => {},
        );
      }}
      style={{
        border: "1px solid color-mix(in srgb, currentColor 30%, transparent)",
        background: "transparent",
        color: "inherit",
        borderRadius: 7,
        padding: "3px 9px",
        fontSize: "0.7em",
        fontFamily: "var(--qz-font-body)",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

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
  variant: "primary" | "outline" | "soft" | "ghost",
  base: CSSProperties,
): CSSProperties {
  // build-tab §2 — a NON-EDITABLE 44px tap floor on every button block
  // (WCAG 2.5.5 / Apple 44 / Material 48): no styling value can make the
  // button un-tappable.
  const floored = { ...base, minHeight: 44 };
  if (variant === "outline") {
    return {
      ...floored,
      background: "transparent",
      border: "2px solid var(--qz-color-primary)",
      color: "var(--qz-color-primary)",
      boxShadow: "none",
    };
  }
  if (variant === "soft") {
    // §2 — the tinted fill between filled and ghost.
    return {
      ...floored,
      background: "color-mix(in srgb, var(--qz-color-primary) 14%, transparent)",
      color: "var(--qz-color-primary)",
      boxShadow: "none",
    };
  }
  if (variant === "ghost") {
    return { ...floored, background: "transparent", boxShadow: "none" };
  }
  return floored;
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
            // build-tab §2 — focal point on cover. Absent → browser default.
            ...(block.focal_x !== undefined || block.focal_y !== undefined
              ? { objectPosition: `${block.focal_x ?? 50}% ${block.focal_y ?? 50}%` }
              : {}),
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
                // §2 — dashed bar line. Absent line → today's solid fill.
                ...(block.line === "dashed"
                  ? {
                      backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 8px, transparent 8px 14px)`,
                    }
                  : { background: color }),
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
    // ── build-tab §5 — the Social-proof inventory ───────────────────────────
    case "testimonial": {
      if (!block.quote.trim()) return null;
      const stars = block.stars > 0 ? <StarRow rating={block.stars} size={13} /> : null;
      const attribution =
        block.author || block.role ? (
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 10 }}>
            {block.avatar_url ? (
              <img
                src={block.avatar_url}
                alt=""
                style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : null}
            <span style={{ display: "flex", flexDirection: "column" }}>
              <strong style={{ fontSize: "0.85em" }}>{block.author}</strong>
              {block.role ? (
                <span style={{ ...styles.muted, fontSize: "0.75em" }}>{block.role}</span>
              ) : null}
            </span>
          </div>
        ) : null;
      if (block.variant === "big_quote") {
        return (
          <figure style={{ margin: 0, textAlign: "center" }}>
            <blockquote
              style={{
                margin: 0,
                fontFamily: "var(--qz-font-heading)",
                fontSize: "1.35em",
                lineHeight: 1.35,
              }}
            >
              &ldquo;{block.quote}&rdquo;
            </blockquote>
            {stars ? <div style={{ marginTop: 8 }}>{stars}</div> : null}
            <figcaption style={{ display: "inline-block" }}>{attribution}</figcaption>
          </figure>
        );
      }
      const chrome: CSSProperties =
        block.variant === "card"
          ? {
              background: "var(--qz-color-surface)",
              borderRadius: "var(--qz-radius)",
              padding: "var(--qz-pad)",
            }
          : {};
      return (
        <figure style={{ margin: 0, ...chrome }}>
          {stars}
          <blockquote style={{ margin: stars ? "8px 0 0" : 0, fontSize: "0.95em", lineHeight: 1.5 }}>
            &ldquo;{block.quote}&rdquo;
          </blockquote>
          <figcaption>{attribution}</figcaption>
        </figure>
      );
    }
    case "review_stars": {
      return (
        <div style={{ textAlign: block.align }}>
          <StarRow rating={block.rating} size={block.size} color={block.color} />
          {block.count_text ? (
            <div style={{ ...styles.muted, fontSize: "0.8em", marginTop: 3 }}>{block.count_text}</div>
          ) : null}
        </div>
      );
    }
    case "trust_badges": {
      const items = block.items.filter((it) => it.label || it.icon);
      if (items.length === 0) return null;
      return (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${block.columns}, minmax(0, 1fr))`,
            gap: 10,
          }}
        >
          {items.map((it, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, textAlign: "center" }}>
              <span aria-hidden style={{ fontSize: block.icon_size, lineHeight: 1, color: block.color ?? "var(--qz-color-primary)" }}>
                {it.icon}
              </span>
              <span style={{ fontSize: "0.78em", fontWeight: 600 }}>{it.label}</span>
            </div>
          ))}
        </div>
      );
    }
    case "coupon": {
      if (!block.code.trim()) return null;
      const frame: CSSProperties =
        block.frame === "solid"
          ? { background: "var(--qz-color-primary)", color: "#fff" }
          : block.frame === "soft"
            ? { background: "var(--qz-color-surface)" }
            : {
                background: "var(--qz-color-bg)",
                border: "1.5px dashed var(--qz-color-primary)",
              };
      return (
        <div
          style={{
            ...frame,
            borderRadius: "var(--qz-radius)",
            padding: "calc(var(--qz-pad) * 0.9)",
            textAlign: "center",
          }}
        >
          {block.headline ? (
            <div style={{ fontWeight: 700, fontSize: "0.9em" }}>{block.headline}</div>
          ) : null}
          {block.subtext ? (
            <div style={{ fontSize: "0.8em", opacity: 0.75, marginTop: 2 }}>{block.subtext}</div>
          ) : null}
          <div
            style={{
              marginTop: block.headline || block.subtext ? 8 : 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 700,
              fontSize: "1.05em",
              letterSpacing: "0.06em",
            }}
          >
            {block.code}
            {block.show_copy ? <CopyCodeButton code={block.code} /> : null}
          </div>
        </div>
      );
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
