import { useEffect, useState, type ReactNode } from "react";

// Render children only after the component has mounted on the client.
//
// The standalone builder (UnifiedWorkspace) is a heavy, authenticated admin
// surface where server-side first paint buys nothing (no SEO, the merchant has
// JS) — but its deep client-only state made every SSR load throw a batch of
// recoverable React #418 hydration mismatches (invisible to shoppers, but noisy
// and not production-clean). Rendering it client-only removes the mismatch by
// construction: SSR + the first client render both emit the lightweight
// `fallback`, so hydration always matches; the real tree mounts in an effect,
// after hydration, with nothing to mis-match. The shopper runtime (`/q/:id`)
// is deliberately NOT wrapped — its SSR-first-paint still matters.
//
// `children` is a thunk so the heavy tree is never even constructed on the
// server.
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: () => ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return <>{mounted ? children() : fallback}</>;
}

// A calm placeholder for the one frame before the builder mounts. Uses the same
// qz tokens so it never flashes a mismatched background.
export function BuilderSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--qz-bg, #fafafa)",
        color: "var(--qz-ink-4, #71717a)",
        fontFamily: "var(--qz-font-body, system-ui, sans-serif)",
        gap: 12,
      }}
    >
      <style>{"@keyframes qzbldspin{to{transform:rotate(360deg)}}"}</style>
      <span
        aria-hidden
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: "2.5px solid var(--qz-rule, #e4e4e7)",
          borderTopColor: "var(--qz-accent, #0b6bcb)",
          animation: "qzbldspin 0.7s linear infinite",
        }}
      />
      <span style={{ fontSize: 13.5 }}>Loading builder…</span>
    </div>
  );
}
