import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { EngagementSettings, type EngagementSettingsT } from "../lib/engagementSchema";
import { QzPage, QzPageHeader } from "../components/qz";
import { EngagementSettingsPanel } from "../components/studio/EngagementSettingsPanel";

// §R R-6 — account-level Settings (builder left rail). The ENGAGEMENT DEFAULTS
// here apply to every quiz unless a quiz overrides them in its own Settings
// (studio.$id_.engagement). Writes to shop.engagementDefaults; resolveEngagement
// merges default → account → quiz at read time.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const parsed = EngagementSettings.safeParse(shop.engagementDefaults ?? {});
  const engagement: EngagementSettingsT = parsed.success ? parsed.data : {};
  return json({ engagement, shopDomain: shop.shopDomain });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  if (form.get("intent") !== "save-engagement") return json({ ok: false }, { status: 400 });

  let raw: unknown = {};
  try {
    raw = JSON.parse(String(form.get("engagement") ?? "{}"));
  } catch {
    raw = {};
  }
  const parsed = EngagementSettings.safeParse(raw);
  if (!parsed.success) return json({ ok: false, error: "invalid engagement" }, { status: 400 });
  await prisma.shop.update({ where: { id: shop.id }, data: { engagementDefaults: parsed.data as never } });
  return redirect("/studio/settings");
};

export default function StudioSettings() {
  const { engagement } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        title="Settings"
        actions={<Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">← Home</Link>}
      />
      {/* accountDefaults=null → the panel edits THESE as the base (no lower layer). */}
      <div className="qz-formcol">
        <EngagementSettingsPanel initial={engagement} accountDefaults={null} />
      </div>
    </QzPage>
  );
}
