import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  QzPage,
  QzPageHeader,
  QzCard,
  QzButton,
  QzBanner,
  QzField,
  QzSelect,
  QzTextarea,
} from "../components/qz";
import {
  DEFAULT_GEN_SETTINGS,
  type QuizGenSettings,
} from "../lib/quizGenSettings";
import { THEME_PRESETS } from "../lib/themePresets";
import { parseBrandGuidelinesSafe } from "../lib/brandGuidelines";
import { BRAND_VOICE_PRESETS } from "../lib/brandVoicePresets";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });
  const collections: Array<{ collectionId: string; title: string }> = shop
    ? await prisma.collection.findMany({
        where: { shopId: shop.id },
        select: { collectionId: true, title: true },
        orderBy: { title: "asc" },
      })
    : [];
  // Surface the shop's active brand voice name (if any) so the Customize
  // panel can render a "Brand voice: <name> active" pill at the top.
  const brandGuidelines = parseBrandGuidelinesSafe(shop?.brandGuidelines);
  // Count discovered categories so the "Use archetype results" checkbox
  // can disable itself with a hint when there's nothing to bind to.
  const categoryCount = shop
    ? await prisma.category.count({ where: { shopId: shop.id } })
    : 0;
  return json({
    collections,
    shopId: shop?.id ?? null,
    brandVoiceName: brandGuidelines?.name ?? null,
    categoryCount,
  });
};

interface GenerateResponse {
  ok: boolean;
  quizId?: string;
  draftJson?: Record<string, unknown> | null;
  error?: string;
  attempts?: number;
}

export default function NewQuiz() {
  const { collections, brandVoiceName, categoryCount } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<GenerateResponse>();
  const navigate = useNavigate();
  const isGenerating =
    fetcher.state !== "idle" && fetcher.formMethod === "POST";

  const [selected, setSelected] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(5);

  // Wizard "Customize" state — default-collapsed so the lightweight flow
  // is unchanged for users who don't open it. The settings object only
  // gets sent to the server (and only triggers any non-default behavior)
  // when something actually deviates from DEFAULT_GEN_SETTINGS.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [settings, setSettings] = useState<QuizGenSettings>(
    DEFAULT_GEN_SETTINGS,
  );
  const settingsDirty =
    JSON.stringify(settings) !== JSON.stringify(DEFAULT_GEN_SETTINGS);

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.quizId) {
      navigate(`/app/quizzes/${fetcher.data.quizId}`);
    }
  }, [fetcher.data, navigate]);

  const toggleCollection = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const canSubmit = prompt.trim().length > 0 && !isGenerating;
  const promptChars = prompt.length;

  const submit = () => {
    const formData = new FormData();
    formData.set("collection_ids", JSON.stringify(selected));
    formData.set("goal_prompt", prompt);
    formData.set("question_count", String(count));
    // Only send settings when the merchant deviated from defaults — keeps
    // the legacy code path on the server side a clean byte-for-byte match.
    if (settingsDirty) {
      formData.set("settings", JSON.stringify(settings));
    }
    fetcher.submit(formData, {
      method: "POST",
      action: "/api/quizzes/new/generate",
    });
  };

  return (
    <QzPage>
      <TitleBar title="New AI quiz" />
      <QzPageHeader
        eyebrow="New quiz"
        title={
          <>
            Generate a quiz from your{" "}
            <span className="qz-serif-italic">catalog</span>.
          </>
        }
        subtitle="Pick a scope, describe the goal in plain English, and Claude drafts the questions, answers, and product mappings against your real product tags. You'll edit the result on the visual flow canvas."
      />

      <div className="qz-col qz-gap-24" style={{ maxWidth: 720 }}>
        <QzCard>
          <div className="qz-col qz-gap-24">
            <QzField
              label="Collection scope"
              hint={
                collections.length === 0
                  ? "No collections synced yet. Run a catalog sync first."
                  : "Optional. Leave empty to let the AI use your whole catalog."
              }
              meta={`${selected.length} selected`}
            >
              {collections.length === 0 ? (
                <QzBanner tone="warn">
                  No collections available. Go back to the dashboard and resync.
                </QzBanner>
              ) : (
                <div className="qz-row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {collections.map((c) => {
                    const on = selected.includes(c.collectionId);
                    return (
                      <button
                        key={c.collectionId}
                        type="button"
                        onClick={() => toggleCollection(c.collectionId)}
                        className="qz-btn qz-btn-sm"
                        style={{
                          background: on
                            ? "var(--qz-ink)"
                            : "var(--qz-paper)",
                          color: on
                            ? "var(--qz-paper)"
                            : "var(--qz-ink-2)",
                          borderColor: on
                            ? "var(--qz-ink)"
                            : "var(--qz-rule)",
                        }}
                      >
                        {c.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </QzField>

            <QzField
              label="Goal prompt"
              hint="What should the shopper learn about themselves, and what should they end up shopping?"
              meta={`${promptChars} / 500`}
            >
              <QzTextarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={5}
                placeholder="e.g. Help shoppers pick the right hoodie for their style, season, and fit preference."
              />
            </QzField>

            <QzField
              label="Question count"
              hint="Three is tight, eight is exhaustive. Five usually hits the sweet spot."
              meta={String(count)}
            >
              <input
                type="range"
                min={3}
                max={8}
                step={1}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                style={{ width: "100%", accentColor: "var(--qz-accent)" }}
              />
              <div
                className="qz-row qz-row-between qz-mono qz-dim"
                style={{ fontSize: 11 }}
              >
                <span>3</span>
                <span>4</span>
                <span>5</span>
                <span>6</span>
                <span>7</span>
                <span>8</span>
              </div>
            </QzField>

            <button
              type="button"
              onClick={() => setCustomizeOpen((o) => !o)}
              style={{
                background: "transparent",
                border: "1px dashed var(--qz-rule)",
                borderRadius: "var(--qz-radius)",
                padding: "10px 14px",
                cursor: "pointer",
                fontFamily: "var(--qz-font-body)",
                color: "var(--qz-ink)",
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                textAlign: "left",
              }}
            >
              <span>
                <strong>Customize</strong>
                <span
                  className="qz-muted"
                  style={{ marginLeft: 8, fontSize: 12 }}
                >
                  Theme, tone, flow extras, embed mode
                </span>
              </span>
              <span
                className="qz-mono qz-dim"
                style={{ fontSize: 11 }}
              >
                {settingsDirty ? "● customized" : ""}{" "}
                {customizeOpen ? "▴" : "▾"}
              </span>
            </button>

            {customizeOpen && (
              <CustomizePanel
                settings={settings}
                onChange={setSettings}
                onReset={() => setSettings(DEFAULT_GEN_SETTINGS)}
                brandVoiceName={brandVoiceName}
                categoryCount={categoryCount}
              />
            )}

            <div className="qz-row qz-gap-12">
              <QzButton
                variant="accent"
                size="lg"
                onClick={submit}
                disabled={!canSubmit}
              >
                {isGenerating ? "Generating…" : "Generate quiz"}
              </QzButton>
              {!canSubmit && !isGenerating && (
                <span className="qz-mono qz-dim" style={{ fontSize: 11 }}>
                  Type a goal prompt to continue
                </span>
              )}
            </div>
          </div>
        </QzCard>

        {fetcher.data?.ok === false && (
          <QzBanner tone="crit" title="Generation failed">
            {fetcher.data.error ?? "Unknown error"}
            {fetcher.data.attempts ? ` (${fetcher.data.attempts} attempts)` : ""}
          </QzBanner>
        )}

        {fetcher.data?.ok && fetcher.data.quizId && (
          <QzBanner tone="ok" title="Generated">
            Opening the flow builder…
          </QzBanner>
        )}
      </div>
    </QzPage>
  );
}

// Collapsible "Customize" panel — four stacked QzCards covering style,
// flow, embed, and integrations. Pure state plumbing; nothing decides the
// AI behavior here, that's all done downstream in quizGenSettings.ts.
function CustomizePanel({
  settings,
  onChange,
  onReset,
  brandVoiceName,
  categoryCount,
}: {
  settings: QuizGenSettings;
  onChange: (next: QuizGenSettings) => void;
  onReset: () => void;
  categoryCount: number;
  brandVoiceName: string | null;
}) {
  const presetFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const setFlow = (
    key: keyof QuizGenSettings["flow"],
    value: boolean,
  ) => onChange({ ...settings, flow: { ...settings.flow, [key]: value } });
  const setLauncher = <K extends keyof QuizGenSettings["launcher"]>(
    key: K,
    value: QuizGenSettings["launcher"][K],
  ) =>
    onChange({
      ...settings,
      launcher: { ...settings.launcher, [key]: value },
    });

  // Picking from the Brand presets optgroup persists straight to
  // shop.brandGuidelines so all AI surfaces honor it — not just this
  // quiz. The wizard pill above flips on the next render.
  const pickBrandPreset = (presetId: string) => {
    const form = new FormData();
    form.set("presetId", presetId);
    presetFetcher.submit(form, {
      method: "POST",
      action: "/app/design/guidelines",
    });
  };

  return (
    <div className="qz-col qz-gap-16">
      {/* Active brand voice pill — only shown when guidelines exist */}
      {brandVoiceName && (
        <Link
          to="/app/design"
          prefetch="intent"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
            background: "var(--qz-cream-2)",
            border: "1px solid var(--qz-rule)",
            borderRadius: 999,
            padding: "6px 12px",
            textDecoration: "none",
            color: "var(--qz-ink)",
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--qz-ok)",
            }}
          />
          <span>
            Brand voice: <strong>{brandVoiceName}</strong> active
          </span>
          <span
            className="qz-mono qz-dim"
            style={{ fontSize: 11, marginLeft: 4 }}
          >
            edit →
          </span>
        </Link>
      )}

      {/* Style */}
      <QzCard>
        <div className="qz-col qz-gap-12">
          <div className="qz-label">Style</div>
          <QzField label="Theme preset" hint="Applied after generation.">
            <QzSelect
              value={settings.theme_preset_id ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...settings,
                  ...(v
                    ? { theme_preset_id: v }
                    : { theme_preset_id: undefined }),
                });
              }}
            >
              <option value="">(none — keep defaults)</option>
              {THEME_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </QzSelect>
          </QzField>
          <QzField
            label="Tone"
            hint="Biases the AI's copy register. Pick a Brand preset to persist a voice across every quiz."
          >
            <QzSelect
              value={settings.tone}
              onChange={(e) => {
                const v = e.target.value;
                // Brand preset values are prefixed so we can distinguish
                // them from the four built-in tones. Picking one fires a
                // fetcher that persists to shop.brandGuidelines and leaves
                // the wizard's own tone unchanged.
                if (v.startsWith("brand:")) {
                  pickBrandPreset(v.slice("brand:".length));
                  return;
                }
                onChange({
                  ...settings,
                  tone: v as QuizGenSettings["tone"],
                });
              }}
            >
              <optgroup label="Brand presets (persists across all quizzes)">
                {BRAND_VOICE_PRESETS.map((p) => (
                  <option key={p.id} value={`brand:${p.id}`}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Generic tones (this generation only)">
                <option value="friendly">Friendly</option>
                <option value="editorial">Editorial</option>
                <option value="playful">Playful</option>
                <option value="professional">Professional</option>
              </optgroup>
            </QzSelect>
          </QzField>
        </div>
      </QzCard>

      {/* Flow */}
      <QzCard>
        <div className="qz-col qz-gap-12">
          <div className="qz-label">Flow</div>
          <p className="qz-muted" style={{ fontSize: 12, margin: 0 }}>
            Tick the extras you want the AI to include. We bias the prompt;
            you can fine-tune afterwards in the canvas.
          </p>
          <SettingCheckbox
            checked={settings.flow.welcome_message}
            onChange={(v) => setFlow("welcome_message", v)}
            title="Welcome message"
            hint="Adds a friendly chat-style intro before the first question."
          />
          <SettingCheckbox
            checked={settings.flow.email_gate}
            onChange={(v) => setFlow("email_gate", v)}
            title="Email gate before results"
            hint="Captures email so you can email recommendations later."
          />
          <SettingCheckbox
            checked={settings.flow.mid_flow_preview}
            onChange={(v) => setFlow("mid_flow_preview", v)}
            title="Show product previews mid-quiz"
            hint="Activates the refining product rail partway through."
          />
          <SettingCheckbox
            checked={settings.flow.ask_ai_followup}
            onChange={(v) => setFlow("ask_ai_followup", v)}
            title="AI follow-up chat after results"
            hint="Lets shoppers ask follow-up questions, grounded in catalog."
          />
          <SettingCheckbox
            checked={settings.flow.end_screen}
            onChange={(v) => setFlow("end_screen", v)}
            title="Thank-you screen after results"
            hint="Wraps the flow with a branded sign-off."
          />
          <SettingCheckbox
            checked={settings.flow.mixed_input_types}
            onChange={(v) => setFlow("mixed_input_types", v)}
            title="Mix in visual / searchable inputs"
            hint="Uses image_picker + searchable in addition to multi-select."
          />
          <SettingCheckbox
            checked={settings.flow.use_archetype_results}
            onChange={(v) => setFlow("use_archetype_results", v)}
            title="Use my discovered categories as result archetypes"
            hint={
              categoryCount > 0
                ? `Each result page returns the products bucketed into a matching category instead of running per-product tag scoring. ${categoryCount} categories available.`
                : "Discover categories first to enable this option."
            }
            disabled={categoryCount === 0}
          />
        </div>
      </QzCard>

      {/* Embed */}
      <QzCard>
        <div className="qz-col qz-gap-12">
          <div className="qz-label">Embed</div>
          <SettingCheckbox
            checked={settings.launcher.enabled}
            onChange={(v) => setLauncher("enabled", v)}
            title="Enable floating launcher"
            hint="Drop the launcher script anywhere on your storefront for a floating button."
          />
          {settings.launcher.enabled && (
            <div className="qz-col qz-gap-8">
              <QzField label="Icon">
                <QzSelect
                  value={settings.launcher.icon}
                  onChange={(e) =>
                    setLauncher(
                      "icon",
                      e.target.value as QuizGenSettings["launcher"]["icon"],
                    )
                  }
                >
                  <option value="sparkle">Sparkle</option>
                  <option value="star">Star</option>
                  <option value="chat">Chat bubble</option>
                </QzSelect>
              </QzField>
              <QzField label="Corner">
                <QzSelect
                  value={settings.launcher.corner}
                  onChange={(e) =>
                    setLauncher(
                      "corner",
                      e.target.value as QuizGenSettings["launcher"]["corner"],
                    )
                  }
                >
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="top-right">Top right</option>
                  <option value="top-left">Top left</option>
                </QzSelect>
              </QzField>
            </div>
          )}
        </div>
      </QzCard>

      {/* Integrations */}
      <QzCard>
        <div className="qz-col qz-gap-12">
          <div className="qz-label">Integrations</div>
          <SettingCheckbox
            checked={settings.integrations.webhook_stub}
            onChange={(v) =>
              onChange({
                ...settings,
                integrations: { ...settings.integrations, webhook_stub: v },
              })
            }
            title="Pre-add an outbound webhook"
            hint="Inserts a placeholder integration node before the result. Edit the URL afterwards."
          />
        </div>
      </QzCard>

      <div className="qz-row" style={{ justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onReset}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--qz-ink-3)",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "var(--qz-font-mono)",
          }}
        >
          reset to defaults
        </button>
      </div>
    </div>
  );
}

// Native checkbox styled to match the Qz panel layout. We render the same
// pattern in app.design.tsx and the captures page — keeping it local here
// avoids an unrelated component dependency for one panel.
function SettingCheckbox({
  checked,
  onChange,
  title,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: 4,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ marginTop: 3, accentColor: "var(--qz-accent)" }}
      />
      <span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{title}</span>
        {hint && (
          <span
            className="qz-muted"
            style={{ fontSize: 12, display: "block", marginTop: 2 }}
          >
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
