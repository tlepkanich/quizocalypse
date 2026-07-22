import { useEffect, useMemo, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import type { BrandIdentity } from "../../lib/brandIdentity";
import { THEME_PRESETS, getPreset } from "../../lib/themePresets";
import { LAYOUT_VARIANTS } from "../../lib/layoutVariants";
import { QzCard, QzField, QzInput, QzTextarea, QzSelect, QzButton, QzBanner } from "../qz";

// ════════════════════════════════════════════════════════════════════════════
// "Here's what we see" — the editable Brand Identity confirm screen (P4). Shared
// verbatim by the studio validation route and the embedded onboarding twin; it
// posts intents (build / refresh / save / confirm) to whichever route renders
// it. Editing any field and Saving LOCKS it (the action diffs + locks), so a
// later Refresh/re-sync preserves the merchant's words.
// ════════════════════════════════════════════════════════════════════════════

const PRICE_TIERS = ["value", "mid", "premium", "luxury", "mixed"] as const;
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const commas = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function BrandIdentityReview({
  identity,
  state,
  stalled = false,
}: {
  identity: BrandIdentity | null;
  state: string | null;
  // Gap 6 — the loader's stall verdict for a "building" state. Stalled =
  // presumed dead: stop polling, re-enable the build button (it IS the retry),
  // and say so instead of spinning forever.
  stalled?: boolean;
}) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const building = fetcher.state !== "idle" || (state === "building" && !stalled);
  const errorState = state?.startsWith("error:") ? state.slice("error:".length) : null;

  // Poll while a detached (install-time) build is running.
  useEffect(() => {
    if (state !== "building" || stalled) return;
    const t = setInterval(() => revalidator.revalidate(), 3000);
    return () => clearInterval(t);
  }, [state, stalled, revalidator]);

  // Editable local copies, re-seeded whenever a fresh identity arrives.
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState("");
  const [descriptions, setDescriptions] = useState("");
  const [industry, setIndustry] = useState("");
  const [vertical, setVertical] = useState("");
  const [priceTier, setPriceTier] = useState<string>("mid");
  const [audience, setAudience] = useState("");
  const [trends, setTrends] = useState("");
  const [presetId, setPresetId] = useState("linen");
  const [layoutId, setLayoutId] = useState("classic");

  const idKey = identity ? `${identity.updated_at}:${identity.version}` : "none";
  useEffect(() => {
    if (!identity) return;
    setSummary(identity.summary);
    setTags(identity.tags.join(", "));
    setDescriptions(identity.descriptions.join("\n"));
    setIndustry(identity.positioning.industry);
    setVertical(identity.positioning.vertical);
    setPriceTier(identity.positioning.price_tier);
    setAudience(identity.positioning.target_demographic.join(", "));
    setTrends(identity.positioning.category_trends.join("\n"));
    setPresetId(identity.design.suggested_theme_preset_id);
    setLayoutId(identity.design.suggested_layout_variant_id);
  }, [idKey, identity]);

  const swatch = useMemo(() => getPreset(presetId)?.tokens.colors ?? {}, [presetId]);

  function post(intent: string, extra?: Record<string, string>) {
    fetcher.submit({ intent, ...(extra ?? {}) }, { method: "post" });
  }

  function save() {
    if (!identity) return;
    const edited: BrandIdentity = {
      ...identity,
      summary: summary.trim(),
      tags: commas(tags),
      descriptions: lines(descriptions),
      positioning: {
        ...identity.positioning,
        industry: industry.trim(),
        vertical: vertical.trim(),
        price_tier: priceTier as BrandIdentity["positioning"]["price_tier"],
        target_demographic: commas(audience),
        category_trends: lines(trends),
      },
      design: {
        ...identity.design,
        suggested_theme_preset_id: presetId as BrandIdentity["design"]["suggested_theme_preset_id"],
        suggested_layout_variant_id: layoutId as BrandIdentity["design"]["suggested_layout_variant_id"],
      },
    };
    post("save", { identity: JSON.stringify(edited) });
  }

  const buildBtn = (
    <QzButton
      type="button"
      variant="accent"
      disabled={building}
      onClick={() => post(identity ? "refresh" : "build")}
    >
      {building ? "Digesting…" : identity ? "Refresh from Shopify" : "Build identity"}
    </QzButton>
  );

  const stalledBanner =
    stalled && state === "building" && fetcher.state === "idle" ? (
      <QzBanner tone="warn" title="This is taking longer than it should">
        The last build looks interrupted — nothing has been written for a while.
        Run it again.
      </QzBanner>
    ) : null;

  if (!identity) {
    return (
      <>
        {stalledBanner}
        {errorState ? (
          <QzBanner tone="warn" title="Last build errored">
            {errorState}
          </QzBanner>
        ) : null}
        <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="qz-dim" style={{ margin: 0, fontSize: 14 }}>
            {building
              ? "Digesting your catalog, brand, and theme into a brand identity…"
              : "No identity yet. Build one from your catalog, brand assets, theme, and best-sellers."}
          </p>
          <div>{buildBtn}</div>
        </QzCard>
      </>
    );
  }

  const locked = new Set(identity.locked_fields);
  const lockTag = (path: string) =>
    locked.has(path) ? (
      <span className="qz-dim" style={{ fontSize: 10, marginLeft: 6 }}>
        🔒 edited
      </span>
    ) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {stalledBanner}
      {errorState ? (
        <QzBanner tone="warn" title="Last build errored">
          {errorState}
        </QzBanner>
      ) : null}

      <div className="qz-row qz-row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className="qz-dim" style={{ fontSize: 12 }}>
          Confidence <strong>{identity.confidence}</strong> · v{identity.version} ·{" "}
          {identity.merchant_confirmed ? "✓ confirmed" : "not yet confirmed"} · sources:{" "}
          {identity.sources.map((s) => s.kind).join(", ") || "—"}
        </span>
        <div className="qz-row" style={{ gap: 8 }}>
          {buildBtn}
          <QzButton type="button" variant="ghost" disabled={building || fetcher.state !== "idle"} onClick={save}>
            Save edits
          </QzButton>
          <QzButton
            type="button"
            disabled={building}
            onClick={() => post("confirm")}
          >
            {identity.merchant_confirmed ? "Re-confirm" : "Looks right →"}
          </QzButton>
        </div>
      </div>

      <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <QzField label={<>Summary {lockTag("summary")}</>}>
          <QzTextarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={5} />
        </QzField>
        <QzField label={<>Brand tags (comma-separated) {lockTag("tags")}</>}>
          <QzInput value={tags} onChange={(e) => setTags(e.target.value)} />
        </QzField>
        <QzField label={<>Descriptions (one per line) {lockTag("descriptions")}</>}>
          <QzTextarea value={descriptions} onChange={(e) => setDescriptions(e.target.value)} rows={4} />
        </QzField>
      </QzCard>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <strong style={{ fontSize: 14 }}>Design lens</strong>
          <QzField label={<>Template {lockTag("design.suggested_theme_preset_id")}</>}>
            <QzSelect value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {THEME_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </QzSelect>
          </QzField>
          <div className="qz-row" style={{ gap: 6 }}>
            {(["primary", "secondary", "accent", "background", "text"] as const).map((k) => (
              <span
                key={k}
                title={`${k}: ${swatch[k] ?? "—"}`}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: "1px solid var(--qz-rule, #ddd)",
                  background: swatch[k] ?? "transparent",
                }}
              />
            ))}
          </div>
          <QzField label={<>Layout {lockTag("design.suggested_layout_variant_id")}</>}>
            <QzSelect value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              {LAYOUT_VARIANTS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </QzSelect>
          </QzField>
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            {identity.design.aesthetic.join(", ")} · {identity.design.imagery_density} imagery ·{" "}
            {identity.design.color_temperament}
          </p>
        </QzCard>

        <QzCard style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <strong style={{ fontSize: 14 }}>Positioning lens</strong>
          <QzField label={<>Industry {lockTag("positioning.industry")}</>}>
            <QzInput value={industry} onChange={(e) => setIndustry(e.target.value)} />
          </QzField>
          <QzField label={<>Vertical {lockTag("positioning.vertical")}</>}>
            <QzInput value={vertical} onChange={(e) => setVertical(e.target.value)} />
          </QzField>
          <QzField label={<>Price tier {lockTag("positioning.price_tier")}</>}>
            <QzSelect value={priceTier} onChange={(e) => setPriceTier(e.target.value)}>
              {PRICE_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </QzSelect>
          </QzField>
          <QzField label={<>Audience (comma-separated) {lockTag("positioning.target_demographic")}</>}>
            <QzInput value={audience} onChange={(e) => setAudience(e.target.value)} />
          </QzField>
          <QzField label={<>Category trends (one per line) {lockTag("positioning.category_trends")}</>}>
            <QzTextarea value={trends} onChange={(e) => setTrends(e.target.value)} rows={3} />
          </QzField>
        </QzCard>
      </div>
    </div>
  );
}
