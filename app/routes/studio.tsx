import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { requireStudioAccess } from "../lib/studioAccess.server";
import { StudioSidebar } from "../components/studio/StudioSidebar";

// Standalone /studio layout — the Quizell-style app shell. A persistent left
// sidebar (StudioSidebar) wraps every /studio child route. Renders straight
// through root.tsx with a shared-token gate (no App Bridge / Shopify auth).
// Same DB as the embedded /app admin, so edits sync both ways.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  return json({});
};

export default function StudioLayout() {
  return (
    <div className="qz-shell">
      <StudioSidebar />
      <div className="qz-shell-main">
        <Outlet />
      </div>
    </div>
  );
}
