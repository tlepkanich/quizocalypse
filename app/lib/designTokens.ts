import type { z } from "zod";
import { DesignTokens } from "./quizSchema";

// Brand design tokens — same shape as DesignTokens in quizSchema.ts (which
// covers quiz-level and node-level overrides). Reusing the schema keeps the
// cascade types consistent end-to-end.
export const BrandTokens = DesignTokens;
export type DesignTokensT = z.infer<typeof DesignTokens>;

export const DEFAULT_TOKENS: DesignTokensT = {
  colors: {
    primary: "#5563DE",
    secondary: "#2C7A4B",
    accent: "#BB6622",
    background: "#FFFFFF",
    text: "#1F1F1F",
    muted: "#666666",
  },
  typography: {
    heading: { family: "Inter", source: "system" },
    body: {
      family: "Inter",
      source: "system",
      base_size: 16,
      scale_ratio: 1.25,
    },
  },
  radius: "rounded",
  button_style: "filled",
  spacing: "normal",
  shadow: "soft",
};

// A #RGB or #RRGGBB hex string (with or without the leading #).
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Normalize a user-entered hex to "#rrggbb", or null if invalid.
 */
export function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (!HEX_RE.test(v)) return null;
  const body = v.startsWith("#") ? v.slice(1) : v;
  const full =
    body.length === 3
      ? body.split("").map((c) => c + c).join("")
      : body;
  return `#${full.toLowerCase()}`;
}

/**
 * Map a shop's Shopify Branding colors (primary/secondary backgrounds) to our
 * color tokens, normalizing hex and dropping invalid/empty values. Pure and
 * Shopify-agnostic so it's unit-testable without the Admin API.
 */
export function brandColorsToTokens(input: {
  primary?: string | null;
  secondary?: string | null;
}): Record<string, string> {
  const out: Record<string, string> = {};
  const p = input.primary ? normalizeHex(input.primary) : null;
  const s = input.secondary ? normalizeHex(input.secondary) : null;
  if (p) out.primary = p;
  if (s) out.secondary = s;
  return out;
}

/**
 * Merge a single merchant-picked brand color into a DesignTokens object as the
 * primary color (used by onboarding's "design from a hex" path). Invalid hex is
 * ignored (returns the tokens unchanged). Pure — returns a new object.
 */
export function mergeHexIntoTokens(
  tokens: DesignTokensT | null | undefined,
  hex: string,
): DesignTokensT {
  const base: DesignTokensT = tokens ? { ...tokens } : {};
  const normalized = normalizeHex(hex);
  if (!normalized) return base;
  return { ...base, colors: { ...(base.colors ?? {}), primary: normalized } };
}

export function resolveDesignTokens(
  ...layers: Array<DesignTokensT | null | undefined>
): DesignTokensT {
  const out: DesignTokensT = JSON.parse(JSON.stringify(DEFAULT_TOKENS));
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.colors) {
      out.colors = { ...out.colors, ...layer.colors };
    }
    if (layer.typography) {
      out.typography = out.typography ?? {};
      if (layer.typography.heading) {
        out.typography.heading = {
          ...out.typography.heading,
          ...layer.typography.heading,
        };
      }
      if (layer.typography.body) {
        out.typography.body = {
          ...out.typography.body,
          ...layer.typography.body,
        };
      }
    }
    if (layer.radius) out.radius = layer.radius;
    if (layer.button_style) out.button_style = layer.button_style;
    if (layer.spacing) out.spacing = layer.spacing;
    if (layer.shadow) out.shadow = layer.shadow;
  }
  return out;
}

// Convenience wrapper for per-breakpoint resolution at render time. Layers the
// node's default override (applies to both breakpoints) then the breakpoint-
// specific override on top. Either layer may be undefined / null.
export function resolveForBreakpoint(
  shopTokens: DesignTokensT | null | undefined,
  quizTokens: DesignTokensT | null | undefined,
  nodeDefault: DesignTokensT | null | undefined,
  nodeBreakpoint: DesignTokensT | null | undefined,
): DesignTokensT {
  return resolveDesignTokens(shopTokens, quizTokens, nodeDefault, nodeBreakpoint);
}

// Translate a resolved token set into CSS variable values for the storefront.
// The runtime sets these on the root element and all child styles read via
// var(--token-name).
export function tokensToCssVars(t: DesignTokensT): Record<string, string> {
  const radius = t.radius ?? "rounded";
  // "pill" caps at 24px (not 999px): a ≤48px-tall button still renders as a full
  // pill (radius ≥ half its height), but a tall card/answer/product surface stays
  // nicely rounded instead of ballooning into an oval/stadium. 999px on a big
  // container is the "big oval" bug.
  const radiusPx = radius === "square" ? "0px" : radius === "pill" ? "24px" : "10px";
  const spacing = t.spacing ?? "normal";
  const pad =
    spacing === "compact" ? "12px" : spacing === "spacious" ? "32px" : "20px";
  const baseSize = t.typography?.body?.base_size ?? 16;
  const scale = t.typography?.body?.scale_ratio ?? 1.25;
  const shadow = t.shadow ?? "soft";
  const shadowCss =
    shadow === "none"
      ? "none"
      : shadow === "elevated"
        ? "0 14px 44px rgba(0,0,0,0.13)"
        : "0 4px 24px rgba(0,0,0,0.06)";
  return {
    "--qz-color-primary": t.colors?.primary ?? "#5563DE",
    "--qz-color-secondary": t.colors?.secondary ?? "#2C7A4B",
    "--qz-color-accent": t.colors?.accent ?? "#BB6622",
    "--qz-color-bg": t.colors?.background ?? "#FFFFFF",
    "--qz-color-text": t.colors?.text ?? "#1F1F1F",
    "--qz-color-muted": t.colors?.muted ?? "#666666",
    "--qz-font-heading": t.typography?.heading?.family ?? "Inter",
    "--qz-font-body": t.typography?.body?.family ?? "Inter",
    "--qz-base-size": `${baseSize}px`,
    "--qz-h1-size": `${baseSize * scale * scale * 1.4}px`,
    "--qz-h2-size": `${baseSize * scale * scale}px`,
    "--qz-radius": radiusPx,
    "--qz-pad": pad,
    "--qz-shadow": shadowCss,
  };
}

// WCAG 2.x contrast ratio. Returns a value between 1 and 21.
// 4.5+ passes AA for normal text; 3.0+ passes AA for large text and UI components.
export function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const [hi, lo] = lA >= lB ? [lA, lB] : [lB, lA];
  return (hi + 0.05) / (lo + 0.05);
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const toLin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

// Surface contrast pairs that fail WCAG AA against a token set. Use to render
// warnings without blocking save — merchants override at their own risk.
export interface ContrastIssue {
  pair: string;
  ratio: number;
  fg: string;
  bg: string;
}
export function findContrastIssues(t: DesignTokensT): ContrastIssue[] {
  const c = t.colors ?? {};
  const issues: ContrastIssue[] = [];
  const check = (label: string, fg: string | undefined, bg: string | undefined, minRatio: number) => {
    if (!fg || !bg) return;
    const r = contrastRatio(fg, bg);
    if (r < minRatio) {
      issues.push({ pair: label, ratio: r, fg, bg });
    }
  };
  check("Text on background", c.text, c.background, 4.5);
  check("Muted on background", c.muted, c.background, 4.5);
  check("Primary button label on primary", "#FFFFFF", c.primary, 4.5);
  check("Accent on background", c.accent, c.background, 3.0);
  return issues;
}

// Style for filled / outline / ghost buttons.
export function buttonStyle(t: DesignTokensT): React.CSSProperties {
  const kind = t.button_style ?? "filled";
  if (kind === "outline") {
    return {
      background: "transparent",
      color: "var(--qz-color-primary)",
      border: "2px solid var(--qz-color-primary)",
    };
  }
  if (kind === "ghost") {
    return {
      background: "transparent",
      color: "var(--qz-color-primary)",
      border: "none",
    };
  }
  return {
    background: "var(--qz-color-primary)",
    color: "#FFF",
    border: "none",
  };
}
