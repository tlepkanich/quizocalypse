import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, type ShouldRevalidateFunction } from "@remix-run/react";
import { adminStyleLinks } from "../styles/adminLinks";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { emailSignalForShop } from "../lib/emailSignal.server";
import { logFor } from "../lib/log.server";
import { Rail } from "../components/chrome/Rail";
import { QzToastProvider } from "../components/qz-toast";

// BIC-2 B1 — the admin sheet moved out of root.tsx; this layout route links it
// for every nested /studio child.
export const links: LinksFunction = () => adminStyleLinks;

// Standalone /studio layout — the V2 app shell (DS-4). A persistent left nav
// rail (Rail, design-system-V2 §7.7) wraps every /studio child route. Renders
// straight through root.tsx with a shared-token gate (no App Bridge / Shopify
// auth). Same DB as the embedded /app admin, so edits sync both ways.

// Default <title> for every nested /studio screen (Remix applies a parent
// route's meta to children that don't export their own). Without it, axe flags
// a serious "document-title" violation on every admin page. Individual screens
// may override with a more specific title later.
export const meta: MetaFunction = () => [{ title: "Wiskr Studio" }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  // HOME-3 — the teal dot on Integrations (first-run handoff §7.5): captured
  // emails with nowhere to go. Decorative, so a failure degrades to no dot
  // (logged) instead of taking down every studio page.
  let emailsWaiting = 0;
  try {
    const shop = await resolveStudioShop();
    emailsWaiting = (await emailSignalForShop(shop.id)).waiting;
  } catch (err) {
    if (err instanceof Response) throw err; // the shop gate's own 503/404
    logFor("studio").warn({ err }, "rail email signal failed");
  }
  return json({ emailsWaiting });
};

// The signal only needs a fresh read when the page changes — not on every
// same-page submission (the builder autosaves every 700 ms).
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}) => (currentUrl.pathname !== nextUrl.pathname ? defaultShouldRevalidate : false);

export default function StudioLayout() {
  const { emailsWaiting } = useLoaderData<typeof loader>();
  return (
    <QzToastProvider>
      <a className="qz-skip-link" href="#main-content">Skip to content</a>
      <div className="qz-shell">
        <Rail
          signals={
            emailsWaiting > 0
              ? {
                  "/studio/integrations":
                    emailsWaiting === 1
                      ? "1 captured email needs a destination"
                      : `${emailsWaiting.toLocaleString("en-US")} captured emails need a destination`,
                }
              : undefined
          }
        />
        <main className="qz-shell-main" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </QzToastProvider>
  );
}
