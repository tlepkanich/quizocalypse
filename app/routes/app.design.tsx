import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  BrandTokens,
  DEFAULT_TOKENS,
  resolveDesignTokens,
  tokensToCssVars,
  buttonStyle,
  findContrastIssues,
  type DesignTokensT,
} from "../lib/designTokens";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBanner,
  QzField,
  QzInput,
  QzSelect,
  QzTooltip,
} from "../components/qz";
import { THEME_PRESETS, type ThemePreset } from "../lib/themePresets";
import {
  parseBrandGuidelinesSafe,
  type BrandGuidelines,
} from "../lib/brandGuidelines";
import { BRAND_VOICE_PRESETS } from "../lib/brandVoicePresets";

const COLOR_ROLES = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted" },
] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  const parsed = BrandTokens.safeParse(shop?.brandTokens ?? {});
  const tokens = parsed.success ? parsed.data : {};
  const guidelines = parseBrandGuidelinesSafe(shop?.brandGuidelines ?? null);
  return json({ tokens, guidelines });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  if (!shop) return json({ ok: false, error: "Shop not found" }, { status: 404 });

  const body = (await request.json()) as { tokens: unknown };
  const parsed = BrandTokens.safeParse(body.tokens);
  if (!parsed.success) {
    return json(
      {
        ok: false,
        error: "Invalid tokens",
        issues: parsed.error.issues.slice(0, 5),
      },
      { status: 400 },
    );
  }
  await prisma.shop.update({
    where: { id: shop.id },
    data: { brandTokens: parsed.data as never },
  });
  return json({ ok: true, savedAt: new Date().toISOString() });
};

export default function DesignSettings() {
  const { tokens: initialTokens, guidelines: initialGuidelines } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ ok: boolean; savedAt?: string; error?: string }>();
  const [tokens, setTokens] = useState<DesignTokensT>(initialTokens);
  const resolved = resolveDesignTokens(tokens);

  const save = (next: DesignTokensT) => {
    setTokens(next);
    fetcher.submit(JSON.stringify({ tokens: next }), {
      method: "PUT",
      encType: "application/json",
    });
  };

  const setColor = (key: string, hex: string) =>
    save({
      ...tokens,
      colors: {
        ...(tokens.colors ?? {}),
        [key]: hex,
      } as DesignTokensT["colors"],
    });

  const setHeadingFont = (family: string) =>
    save({
      ...tokens,
      typography: {
        ...(tokens.typography ?? {}),
        heading: {
          ...(tokens.typography?.heading ?? {}),
          family,
          source: tokens.typography?.heading?.source ?? "system",
        } as NonNullable<DesignTokensT["typography"]>["heading"],
      },
    });
  const setBodyFont = (family: string) =>
    save({
      ...tokens,
      typography: {
        ...(tokens.typography ?? {}),
        body: {
          ...(tokens.typography?.body ?? {}),
          family,
          source: tokens.typography?.body?.source ?? "system",
        } as NonNullable<DesignTokensT["typography"]>["body"],
      },
    });
  const setBaseSize = (n: number) =>
    save({
      ...tokens,
      typography: {
        ...(tokens.typography ?? {}),
        body: {
          ...(tokens.typography?.body ?? {}),
          base_size: n,
          family: tokens.typography?.body?.family ?? "Inter",
          source: tokens.typography?.body?.source ?? "system",
        } as NonNullable<DesignTokensT["typography"]>["body"],
      },
    });
  const setScaleRatio = (n: number) =>
    save({
      ...tokens,
      typography: {
        ...(tokens.typography ?? {}),
        body: {
          ...(tokens.typography?.body ?? {}),
          scale_ratio: n,
          family: tokens.typography?.body?.family ?? "Inter",
          source: tokens.typography?.body?.source ?? "system",
        } as NonNullable<DesignTokensT["typography"]>["body"],
      },
    });

  const isSaving = fetcher.state !== "idle";
  const savedAt = fetcher.data?.ok ? fetcher.data.savedAt : null;
  const error = fetcher.data?.ok === false ? fetcher.data.error : null;

  const headingFont =
    tokens.typography?.heading?.family ??
    DEFAULT_TOKENS.typography?.heading?.family ??
    "Inter";
  const bodyFont =
    tokens.typography?.body?.family ??
    DEFAULT_TOKENS.typography?.body?.family ??
    "Inter";
  const baseSize = tokens.typography?.body?.base_size ?? 16;
  const scaleRatio = tokens.typography?.body?.scale_ratio ?? 1.25;

  const contrastIssues = findContrastIssues(resolved);

  return (
    <QzPage>
      <TitleBar title="Brand design" />

      <QzPageHeader
        eyebrow="Brand design"
        title={
          <>
            How the storefront <span className="qz-serif-italic">looks</span>.
          </>
        }
        subtitle="Colors, fonts, and layout for the shopper-facing quiz. Changes apply to all future published quizzes — re-publish to push the new tokens to a quiz already live."
        actions={
          <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>
            {isSaving
              ? "Saving…"
              : savedAt
                ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
                : ""}
          </span>
        }
      />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <QzBanner tone="crit" title="Save failed">
            {error}
          </QzBanner>
        </div>
      )}
      {contrastIssues.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <QzBanner tone="warn" title="Low contrast — may fail WCAG AA">
            <p style={{ margin: "0 0 8px" }}>
              These color pairs don&apos;t meet AA contrast targets. Shoppers
              using assistive tech may struggle to read these parts of the
              quiz. Saved anyway — fix at your discretion.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {contrastIssues.map((i, idx) => (
                <li key={idx}>
                  <strong>{i.pair}</strong> — {i.ratio.toFixed(2)}:1 (
                  <code>{i.fg}</code> on <code>{i.bg}</code>)
                </li>
              ))}
            </ul>
          </QzBanner>
        </div>
      )}

      <section
        className="qz-responsive-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
          gap: 32,
        }}
      >
        <div className="qz-col qz-gap-24">
          <BrandGuidelinesCard
            initialGuidelines={initialGuidelines}
            onApplyTokens={save}
          />

          <QzCard>
            <div className="qz-col qz-gap-16">
              <div>
                <div className="qz-label">Presets</div>
                <h2 className="qz-h1 qz-mt-8">Start from a theme</h2>
                <p className="qz-muted qz-mt-8" style={{ maxWidth: "52ch" }}>
                  One-click apply a curated token pack. Replaces colors,
                  fonts, radius, button style, and spacing — palette below
                  reflects the change immediately. Tweak any value after.
                </p>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {THEME_PRESETS.map((preset) => (
                  <PresetCard
                    key={preset.id}
                    preset={preset}
                    onApply={() => save(preset.tokens)}
                  />
                ))}
              </div>
            </div>
          </QzCard>

          <QzCard>
            <div className="qz-col qz-gap-16">
              <div>
                <div className="qz-label">Palette</div>
                <h2 className="qz-h1 qz-mt-8">Colors</h2>
                <p className="qz-muted qz-mt-8" style={{ maxWidth: "52ch" }}>
                  Six roles. The storefront uses these tokens for backgrounds,
                  text, buttons, and accents.
                </p>
              </div>
              <div className="qz-col qz-gap-12 qz-mt-16">
                {COLOR_ROLES.map((role) => (
                  <ColorRow
                    key={role.key}
                    label={role.label}
                    value={
                      tokens.colors?.[role.key] ??
                      DEFAULT_TOKENS.colors?.[role.key] ??
                      "#000000"
                    }
                    onChange={(hex) => setColor(role.key, hex)}
                  />
                ))}
              </div>
            </div>
          </QzCard>

          <QzCard>
            <div className="qz-col qz-gap-16">
              <div>
                <div className="qz-label">Type</div>
                <h2 className="qz-h1 qz-mt-8">Typography</h2>
              </div>
              <QzField
                label="Heading font"
                hint="Google Fonts name or system stack (e.g. 'Playfair Display', 'system-ui')"
              >
                <QzInput
                  value={headingFont}
                  onChange={(e) => setHeadingFont(e.target.value)}
                />
              </QzField>
              <QzField label="Body font">
                <QzInput
                  value={bodyFont}
                  onChange={(e) => setBodyFont(e.target.value)}
                />
              </QzField>
              <QzField label="Base font size" meta={`${baseSize}px`}>
                <input
                  type="range"
                  min={14}
                  max={18}
                  step={1}
                  value={baseSize}
                  onChange={(e) => setBaseSize(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--qz-accent)" }}
                />
              </QzField>
              <QzField label="Scale ratio">
                <QzSelect
                  value={String(scaleRatio)}
                  onChange={(e) => setScaleRatio(Number(e.target.value))}
                >
                  <option value="1.125">1.125 (minor second)</option>
                  <option value="1.2">1.2 (minor third)</option>
                  <option value="1.25">1.25 (major third)</option>
                  <option value="1.333">1.333 (perfect fourth)</option>
                </QzSelect>
              </QzField>
            </div>
          </QzCard>

          <QzCard>
            <div className="qz-col qz-gap-16">
              <div>
                <div className="qz-label">Shape</div>
                <h2 className="qz-h1 qz-mt-8">Layout</h2>
              </div>
              <QzField label="Border radius">
                <QzSelect
                  value={tokens.radius ?? "rounded"}
                  onChange={(e) =>
                    save({
                      ...tokens,
                      radius: e.target.value as DesignTokensT["radius"],
                    })
                  }
                >
                  <option value="square">Square</option>
                  <option value="rounded">Rounded</option>
                  <option value="pill">Pill</option>
                </QzSelect>
              </QzField>
              <QzField label="Button style">
                <QzSelect
                  value={tokens.button_style ?? "filled"}
                  onChange={(e) =>
                    save({
                      ...tokens,
                      button_style: e.target
                        .value as DesignTokensT["button_style"],
                    })
                  }
                >
                  <option value="filled">Filled</option>
                  <option value="outline">Outline</option>
                  <option value="ghost">Ghost</option>
                </QzSelect>
              </QzField>
              <QzField label="Spacing density">
                <QzSelect
                  value={tokens.spacing ?? "normal"}
                  onChange={(e) =>
                    save({
                      ...tokens,
                      spacing: e.target.value as DesignTokensT["spacing"],
                    })
                  }
                >
                  <option value="compact">Compact</option>
                  <option value="normal">Normal</option>
                  <option value="spacious">Spacious</option>
                </QzSelect>
              </QzField>
            </div>
          </QzCard>

          <div>
            <QzButton
              onClick={() => save(DEFAULT_TOKENS)}
              variant="ghost"
              size="sm"
              style={{ color: "var(--qz-crit)" }}
            >
              Reset to defaults
            </QzButton>
          </div>
        </div>

        <div style={{ position: "sticky", top: 24, alignSelf: "start" }}>
          <div className="qz-section-head">
            <div>
              <div className="qz-label">Preview</div>
              <h2 className="qz-h1 qz-mt-8">Live storefront</h2>
            </div>
          </div>
          <Preview resolved={resolved} />
          <p
            className="qz-mono qz-dim qz-mt-16"
            style={{ fontSize: 11.5, lineHeight: 1.6 }}
          >
            Renders with your tokens applied. Re-publish a quiz to push these
            tokens to its public storefront page.
          </p>
        </div>
      </section>
    </QzPage>
  );
}

// Tile in the presets grid. Renders a compact swatch row + name + apply
// button. Clicking the tile body or the button both trigger apply for
// forgiving target size.
function PresetCard({
  preset,
  onApply,
}: {
  preset: ThemePreset;
  onApply: () => void;
}) {
  const c = preset.tokens.colors ?? {};
  const swatches = [c.primary, c.secondary, c.accent, c.background, c.text].filter(
    (s): s is string => typeof s === "string",
  );
  return (
    <button
      type="button"
      onClick={onApply}
      style={{
        textAlign: "left",
        background: "var(--qz-paper)",
        border: "1px solid var(--qz-rule)",
        borderRadius: "var(--qz-radius)",
        padding: 12,
        cursor: "pointer",
        fontFamily: "var(--qz-font-body)",
        color: "var(--qz-ink)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "var(--qz-ink-3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--qz-rule)";
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {swatches.map((hex, i) => (
          <span
            key={i}
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              background: hex,
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          />
        ))}
      </div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</div>
      <div
        className="qz-muted"
        style={{ fontSize: 11, lineHeight: 1.3 }}
      >
        {preset.description}
      </div>
    </button>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="qz-row qz-gap-12" style={{ alignItems: "center" }}>
      <span
        className="qz-mono"
        style={{
          minWidth: 88,
          fontSize: 11,
          color: "var(--qz-ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        {label}
      </span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 44,
          height: 32,
          border: "1px solid var(--qz-rule)",
          borderRadius: "var(--qz-radius)",
          padding: 0,
          background: "var(--qz-paper)",
        }}
      />
      <div style={{ flex: 1 }}>
        <QzInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: "var(--qz-font-mono)", fontSize: 13 }}
        />
      </div>
    </div>
  );
}

function Preview({ resolved }: { resolved: DesignTokensT }) {
  const vars = tokensToCssVars(resolved) as React.CSSProperties;
  const btn = {
    ...buttonStyle(resolved),
    borderRadius: "var(--qz-radius)",
    padding: "calc(var(--qz-pad) / 2) var(--qz-pad)",
    fontFamily: "var(--qz-font-body)",
    fontSize: "var(--qz-base-size)",
    cursor: "pointer",
  };
  return (
    <div style={vars}>
      <div
        style={{
          background: "var(--qz-color-bg)",
          color: "var(--qz-color-text)",
          padding: "var(--qz-pad)",
          borderRadius: "var(--qz-radius)",
          fontFamily: "var(--qz-font-body)",
          fontSize: "var(--qz-base-size)",
          border: "1px solid #00000020",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--qz-font-heading)",
            fontSize: "var(--qz-h2-size)",
            margin: 0,
            color: "var(--qz-color-text)",
            fontWeight: 600,
          }}
        >
          Find your match
        </div>
        <div style={{ marginTop: 8, color: "var(--qz-color-muted)" }}>
          Quick personalized picks in 60 seconds.
        </div>
        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          {["Option A", "Option B", "Option C"].map((opt) => (
            <div
              key={opt}
              style={{
                padding: "var(--qz-pad)",
                borderRadius: "var(--qz-radius)",
                border: "2px solid #00000020",
                color: "var(--qz-color-text)",
                fontSize: "var(--qz-base-size)",
              }}
            >
              {opt}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <button style={btn}>Start</button>
        </div>
      </div>
    </div>
  );
}

// Brand voice card. Two states:
//   - Empty: tabs for "Pick a preset" (8 archetype tiles) and "Upload your
//     own" (file picker for PDF / image / text). Both POST to
//     /app/design/guidelines and re-render via fetcher.data.
//   - Loaded: tone summary + suggested-token review sub-card with Apply
//     buttons + Remove/Change links.
function BrandGuidelinesCard({
  initialGuidelines,
  onApplyTokens,
}: {
  initialGuidelines: BrandGuidelines | null;
  onApplyTokens: (next: DesignTokensT) => void;
}) {
  const fetcher = useFetcher<{
    ok: boolean;
    guidelines?: BrandGuidelines | null;
    brandTokens?: DesignTokensT;
    error?: string;
  }>();
  const [tab, setTab] = useState<"preset" | "upload">("preset");
  // The card mirrors the most recent fetcher.data when present, falling
  // back to loader data on first render. So clicking a preset updates the
  // UI immediately on the next render cycle.
  const guidelines = fetcher.data?.guidelines ?? initialGuidelines;
  const isWorking = fetcher.state !== "idle";

  // When the server returns updated brand tokens (because the new voice
  // carried a theme), sync them into the parent's state so the Palette
  // and Type cards below re-render with the new theme immediately.
  // useRef tracks the last applied response so we don't infinite-loop on
  // every render — we only push when the response changes.
  const lastAppliedRef = useRef<DesignTokensT | null>(null);
  useEffect(() => {
    const tokens = fetcher.data?.brandTokens;
    if (
      fetcher.data?.ok &&
      tokens &&
      tokens !== lastAppliedRef.current
    ) {
      lastAppliedRef.current = tokens;
      onApplyTokens(tokens);
    }
  }, [fetcher.data, onApplyTokens]);

  const pickPreset = (presetId: string) => {
    const form = new FormData();
    form.set("presetId", presetId);
    fetcher.submit(form, {
      method: "POST",
      action: "/app/design/guidelines",
    });
  };

  const uploadFile = (file: File) => {
    const form = new FormData();
    form.set("file", file);
    fetcher.submit(form, {
      method: "POST",
      action: "/app/design/guidelines",
      encType: "multipart/form-data",
    });
  };

  const remove = () => {
    fetcher.submit(null, {
      method: "DELETE",
      action: "/app/design/guidelines",
    });
  };

  // Empty state — show tabs.
  if (!guidelines) {
    return (
      <QzCard>
        <div className="qz-col qz-gap-16">
          <div>
            <div className="qz-label">Brand voice</div>
            <h2 className="qz-h1 qz-mt-8">Set your voice</h2>
            <p className="qz-muted qz-mt-8" style={{ maxWidth: "52ch" }}>
              Pick an archetype or upload your brand book. The voice gets
              folded into every AI surface — new quiz generation,
              regenerate, and the in-quiz AI chat.
            </p>
          </div>

          {/* Tabs */}
          <div
            className="qz-row qz-gap-8"
            style={{ borderBottom: "1px solid var(--qz-rule)", paddingBottom: 8 }}
          >
            <TabBtn active={tab === "preset"} onClick={() => setTab("preset")}>
              Pick a preset
            </TabBtn>
            <TabBtn active={tab === "upload"} onClick={() => setTab("upload")}>
              Upload your own
            </TabBtn>
          </div>

          {tab === "preset" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {BRAND_VOICE_PRESETS.map((preset) => (
                <QzTooltip
                  key={preset.id}
                  content={
                    <span>
                      <strong style={{ display: "block", marginBottom: 4 }}>
                        Tone
                      </strong>
                      {preset.guidelines.voice.tone_description}
                    </span>
                  }
                >
                  <button
                    type="button"
                    onClick={() => pickPreset(preset.id)}
                    disabled={isWorking}
                    style={{
                      textAlign: "left",
                      background: "var(--qz-paper)",
                      border: "1px solid var(--qz-rule)",
                      borderRadius: "var(--qz-radius)",
                      padding: 12,
                      cursor: isWorking ? "wait" : "pointer",
                      fontFamily: "var(--qz-font-body)",
                      color: "var(--qz-ink)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      opacity: isWorking ? 0.6 : 1,
                      width: "100%",
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      {preset.label}
                    </span>
                    <span
                      className="qz-muted"
                      style={{ fontSize: 11, lineHeight: 1.3 }}
                    >
                      {preset.inspiration}
                    </span>
                  </button>
                </QzTooltip>
              ))}
            </div>
          )}

          {tab === "upload" && (
            <div
              style={{
                border: "1px dashed var(--qz-rule)",
                borderRadius: "var(--qz-radius)",
                padding: 24,
                textAlign: "center",
              }}
            >
              <label
                style={{
                  display: "inline-block",
                  cursor: isWorking ? "wait" : "pointer",
                  background: "var(--qz-ink)",
                  color: "var(--qz-paper)",
                  padding: "10px 16px",
                  borderRadius: "var(--qz-radius)",
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {isWorking ? "Reading…" : "Choose a file"}
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,image/gif,text/plain,text/markdown"
                  style={{ display: "none" }}
                  disabled={isWorking}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadFile(f);
                  }}
                />
              </label>
              <p
                className="qz-muted"
                style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
              >
                PDF, image (PNG/JPEG/WebP), or text/markdown. Up to 10MB.
              </p>
            </div>
          )}

          {fetcher.data?.ok === false && (
            <QzBanner tone="crit" title="Couldn't process that">
              {fetcher.data.error ?? "Unknown error"}
            </QzBanner>
          )}
        </div>
      </QzCard>
    );
  }

  // Loaded state — the theme (colors + typography) has already been
  // applied server-side by the upload route, so we just summarize the
  // voice + note the theme switch. The Palette + Type cards below show
  // the live tokens.
  const hasThemeApplied =
    !!guidelines.visual_suggestions.tokens &&
    (Object.keys(guidelines.visual_suggestions.tokens.colors ?? {}).length > 0 ||
      !!guidelines.visual_suggestions.tokens.typography?.heading?.family ||
      !!guidelines.visual_suggestions.tokens.typography?.body?.family);

  return (
    <QzCard>
      <div className="qz-col qz-gap-16">
        <div className="qz-row qz-row-between" style={{ alignItems: "baseline" }}>
          <div>
            <div className="qz-label">Brand voice</div>
            <h2 className="qz-h1 qz-mt-8">{guidelines.name}</h2>
          </div>
          <div className="qz-row qz-gap-8">
            <button
              type="button"
              onClick={() => {
                // Soft "change voice" — clear the local data so the empty
                // tabs reappear without forcing the merchant to confirm a
                // destructive remove.
                fetcher.submit(null, {
                  method: "DELETE",
                  action: "/app/design/guidelines",
                });
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--qz-ink-3)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "var(--qz-font-mono)",
              }}
            >
              change voice
            </button>
          </div>
        </div>

        <p style={{ margin: 0, lineHeight: 1.5 }}>
          {guidelines.voice.tone_description}
        </p>

        {guidelines.voice.do_list.length > 0 && (
          <ListBlock label="Do" items={guidelines.voice.do_list} />
        )}
        {guidelines.voice.dont_list.length > 0 && (
          <ListBlock label="Don't" items={guidelines.voice.dont_list} />
        )}

        {hasThemeApplied && (
          <div
            style={{
              borderTop: "1px solid var(--qz-rule)",
              paddingTop: 12,
            }}
          >
            <p
              className="qz-muted"
              style={{ fontSize: 12, margin: 0 }}
            >
              Voice <em>and theme</em> are both applied. Tweak colors or fonts
              in the cards below — your edits sit on top of the preset.
            </p>
          </div>
        )}

        <div className="qz-row qz-gap-8" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={remove}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--qz-crit)",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "var(--qz-font-mono)",
            }}
          >
            remove guidelines
          </button>
        </div>
      </div>
    </QzCard>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        padding: "6px 4px",
        cursor: "pointer",
        fontFamily: "var(--qz-font-body)",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? "var(--qz-ink)" : "var(--qz-ink-3)",
        borderBottom: active
          ? "2px solid var(--qz-accent)"
          : "2px solid transparent",
        marginBottom: -8,
      }}
    >
      {children}
    </button>
  );
}

function ListBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="qz-label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
