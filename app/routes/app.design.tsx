import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  TextField,
  Select,
  RangeSlider,
  Button,
  InlineStack,
  Banner,
  Box,
  Layout,
} from "@shopify/polaris";
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
    tokens.typography?.heading?.family ?? DEFAULT_TOKENS.typography?.heading?.family ?? "Inter";
  const bodyFont =
    tokens.typography?.body?.family ?? DEFAULT_TOKENS.typography?.body?.family ?? "Inter";
  const baseSize = tokens.typography?.body?.base_size ?? 16;
  const scaleRatio = tokens.typography?.body?.scale_ratio ?? 1.25;

  const contrastIssues = findContrastIssues(resolved);

  return (
    <Page backAction={{ content: "Dashboard", url: "/app" }} title="Brand design">
      <TitleBar title="Brand design" />
      <BlockStack gap="400">
        {error && (
          <Banner tone="critical" title="Save failed">
            <p>{error}</p>
          </Banner>
        )}
        {contrastIssues.length > 0 && (
          <Banner tone="warning" title="Low contrast — may fail accessibility">
            <p>
              The following color pairs don&apos;t meet WCAG AA contrast
              targets. Shoppers using assistive tech may struggle to read these
              parts of the quiz. Saved anyway — fix at your discretion.
            </p>
            <ul>
              {contrastIssues.map((i, idx) => (
                <li key={idx}>
                  <strong>{i.pair}</strong> — ratio {i.ratio.toFixed(2)}:1 (
                  <code>{i.fg}</code> on <code>{i.bg}</code>)
                </li>
              ))}
            </ul>
          </Banner>
        )}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Colors
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Used across the storefront quiz. Roles map to specific UI
                  elements at render time.
                </Text>
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
              </BlockStack>
            </Card>

            <div style={{ height: 16 }} />

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Typography
                </Text>
                <TextField
                  label="Heading font"
                  helpText="Google Fonts name or system stack (e.g. 'Inter', 'Playfair Display', 'system-ui')"
                  value={headingFont}
                  onChange={setHeadingFont}
                  autoComplete="off"
                />
                <TextField
                  label="Body font"
                  value={bodyFont}
                  onChange={setBodyFont}
                  autoComplete="off"
                />
                <RangeSlider
                  label={`Base size: ${baseSize}px`}
                  min={14}
                  max={18}
                  step={1}
                  value={baseSize}
                  onChange={(v) =>
                    setBaseSize(Array.isArray(v) ? (v[0] ?? 16) : v)
                  }
                />
                <Select
                  label="Scale ratio"
                  value={String(scaleRatio)}
                  onChange={(v) => setScaleRatio(Number(v))}
                  options={[
                    { label: "1.125 (minor second)", value: "1.125" },
                    { label: "1.2 (minor third)", value: "1.2" },
                    { label: "1.25 (major third)", value: "1.25" },
                    { label: "1.333 (perfect fourth)", value: "1.333" },
                  ]}
                />
              </BlockStack>
            </Card>

            <div style={{ height: 16 }} />

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Layout
                </Text>
                <Select
                  label="Border radius"
                  value={tokens.radius ?? "rounded"}
                  onChange={(v) =>
                    save({
                      ...tokens,
                      radius: v as DesignTokensT["radius"],
                    })
                  }
                  options={[
                    { label: "Square", value: "square" },
                    { label: "Rounded", value: "rounded" },
                    { label: "Pill", value: "pill" },
                  ]}
                />
                <Select
                  label="Button style"
                  value={tokens.button_style ?? "filled"}
                  onChange={(v) =>
                    save({
                      ...tokens,
                      button_style: v as DesignTokensT["button_style"],
                    })
                  }
                  options={[
                    { label: "Filled", value: "filled" },
                    { label: "Outline", value: "outline" },
                    { label: "Ghost", value: "ghost" },
                  ]}
                />
                <Select
                  label="Spacing density"
                  value={tokens.spacing ?? "normal"}
                  onChange={(v) =>
                    save({
                      ...tokens,
                      spacing: v as DesignTokensT["spacing"],
                    })
                  }
                  options={[
                    { label: "Compact", value: "compact" },
                    { label: "Normal", value: "normal" },
                    { label: "Spacious", value: "spacious" },
                  ]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">
                    Live preview
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {isSaving
                      ? "Saving…"
                      : savedAt
                        ? `Saved ${new Date(savedAt).toLocaleTimeString()}`
                        : ""}
                  </Text>
                </InlineStack>
                <Preview resolved={resolved} />
                <Text as="p" variant="bodySm" tone="subdued">
                  Changes apply to all future published quizzes. Re-publish a
                  quiz to push the new tokens to its public storefront page.
                </Text>
                <Button
                  onClick={() => save(DEFAULT_TOKENS)}
                  variant="plain"
                  tone="critical"
                >
                  Reset to defaults
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
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
    <InlineStack gap="300" blockAlign="center">
      <Box minWidth="100px">
        <Text as="span" variant="bodyMd">
          {label}
        </Text>
      </Box>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 40, height: 32, border: "none", padding: 0 }}
      />
      <div style={{ flex: 1 }}>
        <TextField
          label=""
          labelHidden
          value={value}
          onChange={onChange}
          autoComplete="off"
        />
      </div>
    </InlineStack>
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
          border: "1px solid #00000010",
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
