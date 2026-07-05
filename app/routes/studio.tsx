import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { requireStudioAccess } from "../lib/studioAccess.server";
import { Rail } from "../components/chrome/Rail";
import { QzToastProvider } from "../components/qz-toast";

// Standalone /studio layout — the V2 app shell (DS-4). A persistent left nav
// rail (Rail, design-system-V2 §7.7) wraps every /studio child route. Renders
// straight through root.tsx with a shared-token gate (no App Bridge / Shopify
// auth). Same DB as the embedded /app admin, so edits sync both ways.

// Default <title> for every nested /studio screen (Remix applies a parent
// route's meta to children that don't export their own). Without it, axe flags
// a serious "document-title" violation on every admin page. Individual screens
// may override with a more specific title later.
export const meta: MetaFunction = () => [{ title: "Quizocalypse Studio" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  return json({});
};

export default function StudioLayout() {
  return (
    <QzToastProvider>
      <div className="qz-shell">
        <Rail />
        <div className="qz-shell-main">
          <Outlet />
        </div>
        <div className="qz-viewport-notice">
          This workspace is designed for larger screens — please use a desktop browser.
        </div>
      </div>
    </QzToastProvider>
  );
}
