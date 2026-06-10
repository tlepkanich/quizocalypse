import { useEffect, useLayoutEffect, useState } from "react";
import { buttonStyle, type DesignTokensT } from "../../lib/designTokens";

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

export function googleFontsUrl(families: string[]): string | null {
  const params = families
    .filter((f) => f && !SYSTEM_FONTS.has(f))
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`);
  if (params.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${params.join("&")}&display=swap`;
}

export const stylesFor = (
  t: DesignTokensT,
  breakpoint: "desktop" | "mobile" = "mobile",
) => ({
  page: {
    minHeight: "100vh",
    background: "#FAFAFA",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    fontFamily: "var(--qz-font-body)",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  card: {
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
  } satisfies React.CSSProperties,
  primaryBtn: {
    ...buttonStyle(t),
    marginTop: 24,
    borderRadius: "var(--qz-radius)",
    padding: "calc(var(--qz-pad) / 2) var(--qz-pad)",
    fontFamily: "var(--qz-font-body)",
    fontSize: "var(--qz-base-size)",
    fontWeight: 600,
    cursor: "pointer",
  } satisfies React.CSSProperties,
  answerBtn: {
    textAlign: "left" as const,
    background: "var(--qz-color-bg)",
    border: "2px solid #00000022",
    borderRadius: "var(--qz-radius)",
    padding: "var(--qz-pad)",
    fontSize: "var(--qz-base-size)",
    fontFamily: "var(--qz-font-body)",
    color: "var(--qz-color-text)",
    cursor: "pointer",
    transition: "border-color 150ms",
    width: "100%",
  } satisfies React.CSSProperties,
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
    marginTop: 20,
    display: "grid",
    gap: 12,
    gridTemplateColumns: breakpoint === "desktop" ? "repeat(2, minmax(0, 1fr))" : "1fr",
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
  h2: {
    margin: 0,
    fontSize: "var(--qz-h2-size)",
    fontFamily: "var(--qz-font-heading)",
    color: "var(--qz-color-text)",
  } satisfies React.CSSProperties,
  muted: {
    marginTop: 12,
    color: "var(--qz-color-muted)",
    fontSize: "calc(var(--qz-base-size) * 1.05)",
  } satisfies React.CSSProperties,
});

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
