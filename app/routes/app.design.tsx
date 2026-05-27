import { useState } from "react";
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
} from "../components/qz";

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
  return json({ tokens });
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
  const { tokens: initialTokens } = useLoaderData<typeof loader>();
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
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)",
          gap: 32,
        }}
      >
        <div className="qz-col qz-gap-24">
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
