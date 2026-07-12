import { useEffect, useLayoutEffect, useState } from "react";
import { buttonStyle, type DesignTokensT } from "../../lib/designTokens";
import { answerGridColumns } from "../../lib/answerLayout";

// Shared storefront style primitives — extracted from q.$id.tsx so the live
// runtime AND the builder's faithful preview (StepPreview) read the same
// source. Pure (no prisma); safe to import from both routes and components.

const SYSTEM_FONTS = new Set([
  "system",
  "system-ui",
  "Inter",
  "Helvetica",
  "Arial",
  "Georgia",
  "Times",
  "Times New Roman",
  "Courier",
  "Courier New",
]);

// Families verified as Google VARIABLE fonts whose wght axis covers 400–700
// (checked against css2 2026-07). For these we request the real weight range,
// so 500/600/700 headings render true faces instead of browser-synthesized
// bold. Unknown families keep the plain 400-only request on purpose: one bad
// weight spec 400s the ENTIRE css2 response and every font on the page.
const VARIABLE_WGHT_FAMILIES = new Set([
  "Lora",
  "Nunito Sans",
  "Outfit",
  "Newsreader",
  "Source Sans 3",
  "Bricolage Grotesque",
  "Schibsted Grotesk",
  "Quicksand",
  "Karla",
  "Sora",
  "Figtree",
  "Work Sans",
  "Manrope",
  "Archivo",
  "Syne",
  "Space Grotesk",
  "Playfair Display",
]);

export function googleFontsUrl(families: string[]): string | null {
  const params = [...new Set(families)]
    .filter((f) => f && !SYSTEM_FONTS.has(f))
    .map((f) => {
      const enc = encodeURIComponent(f).replace(/%20/g, "+");
      return VARIABLE_WGHT_FAMILIES.has(f)
        ? `family=${enc}:wght@400..700`
        : `family=${enc}`;
    });
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.join("&")}&display=swap`;
}

export const stylesFor = (
  t: DesignTokensT,
  breakpoint: "desktop" | "mobile" = "mobile",
  // MQ — runtime chrome. "classic" (default) returns today's card-on-grey styles
  // byte-for-byte (Shopify regression guard). "minimal" returns the Quizell look:
  // card-less centered content, big bold headline, grey answer chips (single
  // column), no card shadow/border.
  chrome: "classic" | "minimal" = "classic",
) => {
  const minimal = chrome === "minimal";
  return ({
  page: {
    minHeight: "100vh",
    background: "#FAFAFA",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    // QP-2 — Quizell "Page Paddings", per-side. The vars are only present when a
    // merchant sets page_padding (tokensToCssVars); absent → 24px, byte-identical.
    // The desktop-shell rule overrides padding-top with its own var(--qz-pp-top,64px).
    paddingTop: "var(--qz-pp-top, 24px)",
    paddingRight: "var(--qz-pp-right, 24px)",
    paddingBottom: "var(--qz-pp-bottom, 24px)",
    paddingLeft: "var(--qz-pp-left, 24px)",
    fontFamily: "var(--qz-font-body)",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  card: minimal
    ? ({
        // Card-less: the question/result content sits directly on the quiz bg,
        // vertically centered by .qz-runtime-page. Centered, comfortable column.
        background: "transparent",
        borderRadius: 0,
        padding: breakpoint === "desktop" ? "8px 0" : "8px 0",
        boxShadow: "none",
        maxWidth: breakpoint === "desktop" ? 640 : 560,
        width: "100%",
        textAlign: "center" as const,
      } satisfies React.CSSProperties)
    : ({
        background: "var(--qz-color-bg)",
        borderRadius: "var(--qz-radius)",
        padding:
          breakpoint === "desktop"
            ? "calc(var(--qz-pad) * 2)"
            : "calc(var(--qz-pad) * 1.6)",
        boxShadow: "var(--qz-shadow)",
        // Desktop widens the surface; mobile stays a comfortable reading column.
        maxWidth: breakpoint === "desktop" ? 720 : 560,
        width: "100%",
      } satisfies React.CSSProperties),
  primaryBtn: {
    ...buttonStyle(t),
    marginTop: 24,
    // QZY-R7-3 §7.2 — a button-specific radius/scale, applied ONLY when the
    // merchant set them. Absent → the exact prior CSS strings, so a doc without
    // these tokens serializes byte-for-byte as before (the byte pin holds).
    borderRadius:
      t.button_radius != null ? `${t.button_radius}px` : "var(--qz-radius)",
    padding:
      t.button_scale != null
        ? `calc(var(--qz-pad) / 2 * ${t.button_scale}) calc(var(--qz-pad) * ${t.button_scale})`
        : "calc(var(--qz-pad) / 2) var(--qz-pad)",
    fontFamily: "var(--qz-font-body)",
    fontSize:
      t.button_scale != null
        ? `calc(var(--qz-base-size) * ${t.button_scale})`
        : "var(--qz-base-size)",
    fontWeight: 600,
    cursor: "pointer",
  } satisfies React.CSSProperties,
  answerBtn: minimal
    ? ({
        // Quizell grey chip: filled surface, centered text, no visible border.
        textAlign: "center" as const,
        background: "var(--qz-color-surface)",
        border: "1px solid transparent",
        borderRadius: "var(--qz-radius)",
        padding: "calc(var(--qz-pad) * 0.95) var(--qz-pad)",
        fontSize: "var(--qz-base-size)",
        fontFamily: "var(--qz-font-body)",
        fontWeight: 500,
        color: "var(--qz-color-text)",
        cursor: "pointer",
        transition:
          "background 150ms, box-shadow 150ms, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)",
        width: "100%",
      } satisfies React.CSSProperties)
    : ({
        textAlign: "left" as const,
        background: "var(--qz-color-bg)",
        border: "2px solid #00000022",
        borderRadius: "var(--qz-radius)",
        padding: "var(--qz-pad)",
        fontSize: "var(--qz-base-size)",
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-color-text)",
        cursor: "pointer",
        transition:
          "border-color 150ms, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)",
        width: "100%",
      } satisfies React.CSSProperties),
  // A native <select> for the "dropdown" question type. Theme-matched (same
  // border/radius/font/colors as answerBtn) but INPUT-sized: the answer-card's
  // full var(--qz-pad) padding inflates a <select> to ~88px tall with a
  // crammed OS arrow — a "badly formatted shape". Compact padding keeps it a
  // normal control that shows the chosen option cleanly.
  selectInput: {
    textAlign: "left" as const,
    background: "var(--qz-color-bg)",
    border: "2px solid #00000022",
    borderRadius: "var(--qz-radius)",
    padding: "calc(var(--qz-pad) / 2.8) calc(var(--qz-pad) / 1.8)",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    color: "var(--qz-color-text)",
    cursor: "pointer",
    width: "100%",
    maxWidth: "100%",
  } satisfies React.CSSProperties,
  productCard: {
    display: "flex",
    gap: 16,
    padding: "var(--qz-pad)",
    borderRadius: "var(--qz-radius)",
    border: "1px solid #00000010",
    background: "var(--qz-color-bg)",
    alignItems: "center" as const,
    textDecoration: "none",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  // Answer cards and result products go 2-up on desktop, 1-up on mobile — so a
  // wide viewport fills with content instead of a narrow column + whitespace.
  answerGrid: {
    marginTop: minimal ? 28 : 20,
    display: "grid",
    gap: minimal ? 14 : 12,
    // §4 per-quiz answer layout: minimal always 1-up (Quizell); else the quiz's
    // answer_layout drives it (auto/unset = today's 2-up desktop / 1-up mobile).
    // A per-question answer_columns override still wins (applied in QuestionView).
    gridTemplateColumns: answerGridColumns({
      minimal,
      desktop: breakpoint === "desktop",
      answerLayout: t.answer_layout,
      gridColumns: t.answer_grid_columns,
    }),
  } satisfies React.CSSProperties,
  productGrid: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: breakpoint === "desktop" ? "repeat(2, minmax(0, 1fr))" : "1fr",
  } satisfies React.CSSProperties,
  // The result headline gets hero scale on desktop — the climax of the quiz.
  resultHeadline: {
    margin: 0,
    fontSize: breakpoint === "desktop" ? "calc(var(--qz-h2-size) * 1.3)" : "var(--qz-h2-size)",
    fontFamily: "var(--qz-font-heading)",
    lineHeight: 1.15,
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  h1: {
    margin: 0,
    fontSize: "var(--qz-h1-size)",
    fontFamily: "var(--qz-font-heading)",
    lineHeight: 1.2,
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  h2: minimal
    ? ({
        // The big bold centered question headline — the Quizell focal point.
        margin: 0,
        fontSize:
          breakpoint === "desktop"
            ? "calc(var(--qz-h2-size) * 1.3)"
            : "calc(var(--qz-h2-size) * 1.12)",
        fontFamily: "var(--qz-font-heading)",
        fontWeight: 700,
        lineHeight: 1.15,
        color: "var(--qz-color-text)",
        textAlign: "center" as const,
      } satisfies React.CSSProperties)
    : ({
        margin: 0,
        fontSize: "var(--qz-h2-size)",
        fontFamily: "var(--qz-font-heading)",
        color: "var(--qz-color-text)",
      } satisfies React.CSSProperties),
  muted: {
    marginTop: 12,
    color: "var(--qz-color-muted)",
    fontSize: "calc(var(--qz-base-size) * 1.05)",
  } satisfies React.CSSProperties,
  });
};

export type RuntimeStyles = ReturnType<typeof stylesFor>;

// The wide/narrow layout threshold — ONE constant shared by the live runtime
// (container-measured below) and the builder preview (previewWidth.ts), so
// the two can never drift.
export const BREAKPOINT_PX = 900;
// Flip up at ≥900 but back down only below 884: a classic-scrollbar appearing
// when the mobile layout grows taller would otherwise narrow the container
// ~15px and oscillate the breakpoint right at the boundary.
const HYSTERESIS_PX = 16;

// useLayoutEffect warns when invoked during SSR; the server branch is a no-op
// either way, so alias it to useEffect there.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Container-measured breakpoint (Unified P1 — the autoscale core). Measures
// the RUNTIME ROOT's own width via ResizeObserver instead of the window, so
// the quiz formats to wherever it actually lives: a full page, a narrow theme
// section's iframe, the launcher popup (which mounts inside display:none and
// only gets a real width when shown — the observer catches the flip), or any
// future inline embed. Returns null until first measure (callers fall back to
// the SSR default); first paint corrects pre-render via useLayoutEffect.
export function useContainerBreakpoint(
  ref: React.RefObject<HTMLElement | null>,
): "desktop" | "mobile" | null {
  const [bp, setBp] = useState<"desktop" | "mobile" | null>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = (w: number) => {
      // display:none containers measure 0 — keep the previous value (or the
      // SSR fallback) rather than asserting "mobile" from a meaningless width.
      if (w <= 0) return;
      setBp((cur) => {
        if (w >= BREAKPOINT_PX) return "desktop";
        if (w < BREAKPOINT_PX - HYSTERESIS_PX) return "mobile";
        return cur ?? "mobile"; // inside the hysteresis band: hold steady
      });
    };
    apply(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") apply(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return bp;
}
