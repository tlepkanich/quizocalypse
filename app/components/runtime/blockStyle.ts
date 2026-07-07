import type { CSSProperties } from "react";
import type { BlockStyle } from "../../lib/quizSchema";

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers for the content-block renderer (Phase 2). No React, no DOM —
// safe to unit test in the node environment and to import from both the
// storefront runtime and the builder preview.
// ───────────────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{3,8}$/;

// Colors flow into inline `style` (React-escaped, so no XSS) or into the
// generated <style>. We still constrain to hex so a stray value can't smuggle
// `url()` / `expression()` into a CSS value. Returns undefined when invalid.
export function sanitizeHexColor(v: string | undefined | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return HEX.test(t) ? t : undefined;
}

function radiusToPx(r: NonNullable<BlockStyle["radius"]>): string {
  return r === "square" ? "0px" : r === "pill" ? "999px" : "10px";
}

// Map the small, sanitized BlockStyle overlay onto inline CSS. Mirrors the
// token cascade's radius mapping (designTokens.ts) so blocks line up with the
// surrounding theme.
export function blockStyleToCss(s: BlockStyle | undefined | null): CSSProperties {
  const out: CSSProperties = {};
  if (!s) return out;
  if (s.align) out.textAlign = s.align;
  if (typeof s.margin_top === "number") out.marginTop = s.margin_top;
  if (typeof s.margin_bottom === "number") out.marginBottom = s.margin_bottom;
  if (typeof s.padding === "number") out.padding = s.padding;
  if (typeof s.max_width === "number") {
    out.maxWidth = s.max_width;
    // A max-width only reads as "centered" when the box can shrink; pair it
    // with auto side-margins unless the merchant set explicit margins.
    if (s.margin_top === undefined && s.margin_bottom === undefined) {
      out.marginLeft = "auto";
      out.marginRight = "auto";
    }
  }
  const color = sanitizeHexColor(s.text_color);
  if (color) out.color = color;
  const bg = sanitizeHexColor(s.background);
  if (bg) out.background = bg;
  if (typeof s.font_size === "number") out.fontSize = s.font_size;
  if (typeof s.font_weight === "number") out.fontWeight = s.font_weight;
  if (s.radius) out.borderRadius = radiusToPx(s.radius);
  // QZY-10 §7 — letter spacing (px).
  if (typeof s.letter_spacing === "number") out.letterSpacing = s.letter_spacing;
  return out;
}

// Returns true when the overlay has no visible effect — lets the renderer skip
// the wrapper element entirely so synthesized layouts stay byte-identical to
// the fixed template (a bare element, no extra <div>).
export function isEmptyBlockStyle(s: BlockStyle | undefined | null): boolean {
  if (!s) return true;
  return Object.keys(blockStyleToCss(s)).length === 0;
}

// ── Per-node CSS scoping (the "paid" CSS editor) ────────────────────────────
//
// The only real break-out vector from a <style> element is the literal
// `</style>` sequence (a `<` character). CSS values can't execute JS in modern
// browsers, but we still strip the historical IE vectors. The `>` child
// combinator is LEGAL CSS and is allowed; only `<` is forbidden.

const MAX_CSS_LEN = 20000;
const FORBIDDEN = [
  /</, // neutralizes `</style>` break-out
  /expression\s*\(/i,
  /javascript:/i,
  /vbscript:/i,
  /@import/i,
  /@charset/i,
  /behaviou?r\s*:/i,
  /-moz-binding/i,
];

// Every url(...) must point at https: or an inline data:image. Anything else
// (http:, relative, javascript:, data:text/html…) rejects the whole sheet.
function urlsAreSafe(css: string): boolean {
  const re = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const v = (m[2] ?? "").trim().toLowerCase();
    if (!(v.startsWith("https://") || v.startsWith("data:image/"))) return false;
  }
  return true;
}

// Stable, collision-free, valid CSS identifier derived from the node id. We
// never put the raw node id in markup (ids can contain characters invalid in a
// class). Deterministic (no Math.random) so SSR and client agree.
export function nodeScopeClass(nodeId: string): string {
  let h = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    h ^= nodeId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `qz-node-${(h >>> 0).toString(36)}`;
}

function scopeSelectorList(selectors: string, scope: string): string {
  const cls = `.${scope}`;
  return selectors
    .split(",")
    .map((sel) => {
      const s = sel.trim();
      if (!s) return "";
      // Re-scope document-level selectors to the node root so they can't leak.
      for (const root of [":root", "html", "body"]) {
        if (s === root) return cls;
        if (s.startsWith(root + " ") || s.startsWith(root + ">") || s.startsWith(root + ":")) {
          return cls + s.slice(root.length);
        }
      }
      if (s === "*") return cls;
      if (s.startsWith("&")) return cls + s.slice(1); // & = the node root itself
      return `${cls} ${s}`;
    })
    .filter(Boolean)
    .join(", ");
}

function scopeBlock(css: string, scope: string): string {
  let out = "";
  let i = 0;
  const n = css.length;
  while (i < n) {
    const start = i;
    while (i < n && css[i] !== "{" && css[i] !== ";" && css[i] !== "}") i++;
    if (i >= n) break;
    const ch = css[i];
    const prelude = css.slice(start, i).trim();
    if (ch === ";" || ch === "}") {
      // A bare at-statement (e.g. a stray `@import`) or stray brace — drop it.
      i++;
      continue;
    }
    // ch === "{": find the matching close brace (depth-aware for nesting).
    const bodyStart = i + 1;
    let depth = 1;
    i = bodyStart;
    while (i < n && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
      i++;
    }
    const body = css.slice(bodyStart, i);
    i++; // consume closing brace
    if (!prelude) continue;
    if (prelude.startsWith("@")) {
      const lower = prelude.toLowerCase();
      if (lower.startsWith("@media") || lower.startsWith("@supports")) {
        out += `${prelude}{${scopeBlock(body, scope)}}`;
      }
      // else drop @font-face / @keyframes / unknown at-rules for safety.
    } else {
      out += `${scopeSelectorList(prelude, scope)}{${body}}`;
    }
  }
  return out;
}

// Scope merchant CSS to a single node. Two modes:
//  - declaration-only (no `{` present): treated as a declaration block applied
//    to the node root — `.qz-node-x{ <decls> }`.
//  - full rules (contains `{`): every selector is prefixed with the node scope
//    class; only @media/@supports at-rules survive.
// Returns the scoped CSS, or null when the input is rejected (caller renders
// nothing + can surface a warning). `css` empty/whitespace → null (no-op).
export function scopeNodeCss(nodeId: string, css: string | undefined | null): string | null {
  if (typeof css !== "string") return null;
  const trimmed = css.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_CSS_LEN) return null;
  if (FORBIDDEN.some((re) => re.test(trimmed))) return null;
  if (!urlsAreSafe(trimmed)) return null;
  const scope = nodeScopeClass(nodeId);
  if (!trimmed.includes("{")) {
    // Declaration-only mode — strip any stray closing braces defensively.
    const decls = trimmed.replace(/}/g, "");
    return `.${scope}{${decls}}`;
  }
  const scoped = scopeBlock(trimmed, scope);
  return scoped || null;
}
