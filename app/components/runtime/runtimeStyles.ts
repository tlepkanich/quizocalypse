import { useSyncExternalStore } from "react";
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

export const stylesFor = (t: DesignTokensT) => ({
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
    padding: "calc(var(--qz-pad) * 1.6)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
    maxWidth: 560,
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

// Resize-aware breakpoint hook. SSR-safe: "desktop" on the server, then
// re-subscribes to window resize once mounted. 900px threshold mirrors the
// runtime layout CSS.
export function useBreakpoint(): "desktop" | "mobile" {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === "undefined") return () => {};
      window.addEventListener("resize", cb);
      return () => window.removeEventListener("resize", cb);
    },
    () => (window.innerWidth < 900 ? "mobile" : "desktop"),
    () => "desktop",
  );
}
