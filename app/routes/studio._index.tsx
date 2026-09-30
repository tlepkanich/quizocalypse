import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { loadHomeForShop, runHomeIntentForShop } from "../lib/home.server";
import { STUDIO_HOME_LINKS } from "../lib/homeFeed";
import { HomeScreens } from "../components/studio/HomeScreens";

// HOME-3 — the standalone studio Home. The page is the shared <HomeScreens>
// (also on the embedded /app Home); only this surface may open the
// first-open dialog (§2 canOpenDialog).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  return json(await loadHomeForShop(shop, { links: STUDIO_HOME_LINKS, allowDialog: true }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const ok = await runHomeIntentForShop(shop, await request.formData(), { allowDialog: true });
  return ok ? json({ ok: true as const }) : json({ ok: false as const }, { status: 400 });
};

export default function StudioHome() {
  const data = useLoaderData<typeof loader>();
  return <HomeScreens data={data} links={STUDIO_HOME_LINKS} goalAction="/studio/goal" />;
}
