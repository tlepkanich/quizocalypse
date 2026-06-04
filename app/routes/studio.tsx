import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet } from "@remix-run/react";
import { requireStudioAccess } from "../lib/studioAccess.server";

// Standalone /studio layout — the full-screen, non-embedded home for the quiz
// builder. Unlike the embedded /app/* tree (App Bridge + Shopify auth), this
// renders straight through root.tsx with a shared-token gate. Same DB as the
// embedded admin, so edits sync both ways.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  return json({});
};

export default function StudioLayout() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        className="qz-row qz-row-between"
        style={{
          alignItems: "center",
          padding: "14px 28px",
          borderBottom: "1px solid var(--qz-rule)",
          position: "sticky",
          top: 0,
          background: "color-mix(in srgb, var(--qz-paper) 86%, transparent)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          zIndex: 20,
        }}
      >
        <Link
          to="/studio"
          style={{ display: "inline-flex", alignItems: "baseline", gap: 9, textDecoration: "none", color: "inherit" }}
        >
          <span style={{ fontFamily: "var(--qz-font-display)", fontSize: 21, letterSpacing: "-0.02em" }}>
            Quizocalypse
          </span>
          <span className="qz-label">Studio</span>
        </Link>
        <div className="qz-row" style={{ gap: 14, alignItems: "center" }}>
          <Link to="/studio/new" className="qz-btn qz-btn-ghost qz-btn-sm">
            New quiz →
          </Link>
          <span className="qz-label">standalone preview</span>
        </div>
      </header>
      <main style={{ flex: 1, minWidth: 0, width: "100%" }}>
        <Outlet />
      </main>
    </div>
  );
}
