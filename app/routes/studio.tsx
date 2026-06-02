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
          padding: "10px 22px",
          borderBottom: "1px solid #00000012",
          position: "sticky",
          top: 0,
          background: "var(--qz-paper, #fff)",
          zIndex: 20,
        }}
      >
        <Link
          to="/studio"
          style={{ fontWeight: 800, textDecoration: "none", color: "inherit", letterSpacing: "-0.01em" }}
        >
          Quizocalypse <span className="qz-dim" style={{ fontWeight: 600 }}>Studio</span>
        </Link>
        <span className="qz-dim" style={{ fontSize: 12 }}>standalone preview</span>
      </header>
      <main style={{ flex: 1, minWidth: 0, width: "100%", padding: "20px 24px 64px" }}>
        <Outlet />
      </main>
    </div>
  );
}
