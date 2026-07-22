import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import prisma from "../db.server";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import { resolveIdentityBuildState } from "../lib/stall.server";
import {
  runBrandIdentityBuild,
  saveBrandIdentityEdits,
  confirmBrandIdentity,
} from "../lib/brandIdentityBuild.server";
import { DesignTokens } from "../lib/quizSchema";
import { parseBrandGuidelinesSafe, BrandVoice, type BrandGuidelines } from "../lib/brandGuidelines";
import { QzPage, QzPageHeader } from "../components/qz";
import { BrandBook } from "../components/studio/BrandBook";

// Brand Identity — the deploy-validation surface (P3). Cookie-gated like the
// rest of /studio; it runs a REAL build against the dev shop via the offline
// admin session and renders / returns the persisted identity. P4 grows this into
// the full editable "here's what we see" screen; for now it proves the chain
// end-to-end on the live deploy (and the action returns JSON for headless
// verification: POST intent=build with the studio cookie).

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const tokensParse = DesignTokens.safeParse(shop.brandTokens ?? {});
  return json({
    shopDomain: shop.shopDomain,
    // Gap 6 — "building:<iso>" stall stamp normalized to the client contract.
    state: resolveIdentityBuildState(shop.brandIdentityState ?? null).state,
    identity: parseBrandIdentitySafe(shop.brandIdentity),
    tokens: tokensParse.success ? tokensParse.data : {},
    voice: parseBrandGuidelinesSafe(shop.brandGuidelines)?.voice ?? null,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "build");

  if (intent === "save") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(form.get("identity") ?? "null"));
    } catch {
      return json({ ok: false, error: "bad identity JSON" }, { status: 400 });
    }
    const res = await saveBrandIdentityEdits(shop.id, parsed);
    return json(res, { status: res.ok ? 200 : 400 });
  }
  if (intent === "save-tokens") {
    // Brand book visual sections (logo/colors/type/shape/spacing/imagery/presets)
    // persist to shop.brandTokens — merged over the stored set so a partial edit
    // never drops other fields. The token cascade (brand → quiz override →
    // default) then feeds every AI-built quiz's Design step.
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("tokens") ?? "null"));
    } catch {
      return json({ ok: false, error: "bad tokens JSON" }, { status: 400 });
    }
    const parsedTokens = DesignTokens.safeParse(raw);
    if (!parsedTokens.success) return json({ ok: false, error: "invalid tokens" }, { status: 400 });
    const existing = DesignTokens.safeParse(shop.brandTokens ?? {});
    const base: Record<string, unknown> = existing.success ? { ...existing.data } : {};
    // One-level deep merge: for object-valued keys (colors, typography, logo,
    // style_bar, …) merge fields so a payload touching one nested field can't
    // drop its siblings. Scalars/enums/arrays replace wholesale.
    for (const [k, v] of Object.entries(parsedTokens.data)) {
      const prev = base[k];
      if (v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" && !Array.isArray(prev)) {
        base[k] = { ...(prev as object), ...(v as object) };
      } else {
        base[k] = v;
      }
    }
    await prisma.shop.update({ where: { id: shop.id }, data: { brandTokens: base as never } });
    return json({ ok: true });
  }
  if (intent === "save-voice") {
    // Voice & tone (do / don't / sample copy) persists to shop.brandGuidelines'
    // BrandVoice. If no guidelines exist yet, synthesize a minimal wrapper so a
    // merchant can author voice without first uploading a brand-guidelines file.
    let raw: unknown;
    try {
      raw = JSON.parse(String(form.get("voice") ?? "null"));
    } catch {
      return json({ ok: false, error: "bad voice JSON" }, { status: 400 });
    }
    const parsedVoice = BrandVoice.safeParse(raw);
    if (!parsedVoice.success) return json({ ok: false, error: "invalid voice" }, { status: 400 });
    const existing = parseBrandGuidelinesSafe(shop.brandGuidelines);
    const next: BrandGuidelines = existing
      ? { ...existing, voice: parsedVoice.data }
      : {
          name: "Brand",
          voice: parsedVoice.data,
          visual_suggestions: { notes: [] },
          source: { uploaded_at: new Date().toISOString(), file_kind: "preset", extraction_model: "merchant-edited" },
        };
    await prisma.shop.update({ where: { id: shop.id }, data: { brandGuidelines: next as never } });
    return json({ ok: true });
  }
  if (intent === "confirm") {
    const res = await confirmBrandIdentity(shop.id);
    return json(res, { status: res.ok ? 200 : 400 });
  }
  // build | refresh — awaited (one AI call ≈ 15–30s, within the edge-proxy
  // window). Admin is optional: with an offline session we add the maximal pull,
  // otherwise the digest builds from the synced catalog alone.
  const result = await runBrandIdentityBuild(shop.id, undefined, { refine: intent === "refresh" });
  return json(result, { status: result.ok ? 200 : 502 });
};

export default function StudioBrand() {
  const { identity, tokens, voice } = useLoaderData<typeof loader>();
  const buildFetcher = useFetcher<{ ok: boolean }>();
  const building = buildFetcher.state !== "idle";
  return (
    <QzPage width="wide">
      <QzPageHeader
        title="Brand Identity"
        actions={
          <div className="qz-row" style={{ gap: 8 }}>
            <buildFetcher.Form method="post">
              <input type="hidden" name="intent" value={identity ? "refresh" : "build"} />
              <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm" disabled={building}>
                {building ? "Working…" : identity ? "Re-sync from store" : "Build identity"}
              </button>
            </buildFetcher.Form>
            <Link to="/studio" className="qz-btn qz-btn-ghost qz-btn-sm">← All quizzes</Link>
          </div>
        }
      />
      <BrandBook identity={identity} tokens={tokens} voice={voice} />
    </QzPage>
  );
}
