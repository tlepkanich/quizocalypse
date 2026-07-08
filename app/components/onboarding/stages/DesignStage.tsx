// BIC-2 C2 — the Design stage (stage "design") extracted from Step1Funnel.tsx
// as a PURE MOVE, together with its private FineTuneRow control. Only the
// imports are new.
import { useState } from "react";
import type { useFetcher } from "@remix-run/react";
import { QzCard } from "../../qz";
import { VibeTemplateSelector } from "../../studio/VibeTemplateSelector";
import { StyleBar } from "../../studio/StyleBar";
import { BrandIdentityPanel } from "../../studio/BrandIdentityPanel";
import { THEME_PRESETS, type ThemePreset } from "../../../lib/themePresets";
import { BRAND_TEMPLATE_ID } from "../../../lib/brandSeed";
import type { ActionResult, FunnelData } from "./stagesShared";

// A small segmented control row for the Design step's fine-tune options.
function FineTuneRow({
  label,
  options,
  active,
  onPick,
  busy,
}: {
  label: string;
  options: Array<[string, string]>;
  active: string | undefined;
  onPick: (value: string) => void;
  busy: boolean;
}) {
  return (
    <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
      <span className="qz-dim" style={{ fontSize: 12, flex: "0 0 64px" }}>{label}</span>
      <div className="qz-row" style={{ gap: 4 }}>
        {options.map(([value, lbl]) => (
          <button
            key={value}
            type="button"
            disabled={busy}
            onClick={() => onPick(value)}
            className={`qz-btn qz-btn-sm ${active === value ? "qz-btn-accent" : "qz-btn-ghost"}`}
            style={{ fontSize: 11, padding: "2px 8px" }}
            aria-pressed={active === value}
          >
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Design — pick a theme (the design-settings step, first cut) ───────────────
// Applies a theme preset's tokens to the draft doc via set-design; the build
// threads doc.design_tokens as its base, so the choice survives generation.
// (Logo / curated fonts / style sliders / formatting toggles are later cuts.)
export function DesignStage({
  data,
  fetcher,
  pendingIntent,
}: {
  data: FunnelData;
  fetcher: ReturnType<typeof useFetcher<ActionResult>>;
  pendingIntent: string | null;
}) {
  const [appliedId, setAppliedId] = useState<string | null>(null);
  // §5/D6 — quiz↔rec-page design link. When de-linked, a Quiz/Rec switch routes EVERY
  // design edit below (brand identity, template, style bar, formatting) to whichever
  // design via `scope`; the panels read that design's tokens (`panelTokens`).
  const [designScope, setDesignScope] = useState<"quiz" | "rec_page">("quiz");
  const recScope = data.designLinked === false && designScope === "rec_page";
  const brandScope = recScope ? "rec_page" : "quiz";
  const panelTokens = recScope ? (data.recPageDesign ?? data.designTokens) : data.designTokens;

  const applying = pendingIntent === "set-design";
  const apply = (preset: ThemePreset) => {
    setAppliedId(preset.id);
    fetcher.submit(
      { intent: "set-design", tokens: JSON.stringify(preset.tokens), scope: brandScope },
      { method: "post" },
    );
  };
  const applyingField = pendingIntent === "set-design-field";
  const applyField = (field: string, value: string) =>
    fetcher.submit({ intent: "set-design-field", field, value, scope: brandScope }, { method: "post" });
  // §4 per-quiz formatting (answer layout / progress bar / question image).
  const applyingFormat = pendingIntent === "set-format";
  const applyFormat = (key: string, value: string) =>
    fetcher.submit({ intent: "set-format", key, value, scope: brandScope }, { method: "post" });
  const applyProgress = (patch: Record<string, unknown>) =>
    fetcher.submit(
      { intent: "set-format", key: "progress_bar", value: JSON.stringify(patch), scope: brandScope },
      { method: "post" },
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <QzCard style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Design · Brand identity</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>Your brand</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Colors and fonts apply across every quiz. The template and style bar below fine-tune
            the rest.
          </p>
        </div>

        {/* §5 — link the rec page's design to the quiz, or de-link to give it its
            own colors/fonts/logo (the Quiz/Rec switch routes the edits below). */}
        <div
          className="qz-row qz-gap-12"
          style={{ alignItems: "center", flexWrap: "wrap", fontSize: 13 }}
        >
          <label className="qz-row qz-gap-4" style={{ alignItems: "center", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={data.designLinked !== false}
              onChange={(e) => {
                const linked = e.target.checked;
                if (linked && !window.confirm("Reset the recommendation page’s design back to the quiz design?")) {
                  return;
                }
                if (linked) setDesignScope("quiz");
                fetcher.submit({ intent: "set-design-linked", linked: String(linked) }, { method: "post" });
              }}
            />
            Link the recommendation page’s design to the quiz
          </label>
          {data.designLinked === false ? (
            <FineTuneRow
              label="Editing"
              options={[
                ["quiz", "Quiz"],
                ["rec_page", "Rec page"],
              ]}
              active={designScope}
              onPick={(v) => setDesignScope(v as "quiz" | "rec_page")}
              busy={false}
            />
          ) : null}
        </div>
        {recScope ? (
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Editing the recommendation page’s design — colors, fonts, logo, template, style bar &
            formatting all apply to the rec page until you re-link.
          </p>
        ) : null}

        <BrandIdentityPanel
          tokens={panelTokens}
          onColor={(key, hex) =>
            fetcher.submit(
              { intent: "set-design-color", key, value: hex, scope: brandScope },
              { method: "post" },
            )
          }
          onFont={(slot, family) =>
            fetcher.submit(
              { intent: "set-design-font", slot, family, scope: brandScope },
              { method: "post" },
            )
          }
          onLogoFile={(file) => {
            const fd = new FormData();
            fd.append("intent", "set-design-logo");
            fd.append("logo", file);
            fd.append("scope", brandScope);
            fetcher.submit(fd, { method: "post", encType: "multipart/form-data" });
          }}
          onLogoUrl={(url) =>
            fetcher.submit({ intent: "set-design-logo", url, scope: brandScope }, { method: "post" })
          }
          onLogoMeta={(field, value) =>
            fetcher.submit(
              { intent: "set-design-logo", [field]: value, scope: brandScope },
              { method: "post" },
            )
          }
          onLogoClear={() =>
            fetcher.submit({ intent: "set-design-logo", clear: "1", scope: brandScope }, { method: "post" })
          }
          onReset={() => fetcher.submit({ intent: "reset-design", scope: brandScope }, { method: "post" })}
          onResync={() =>
            fetcher.submit({ intent: "resync-design", scope: brandScope }, { method: "post" })
          }
        />
        <hr style={{ border: "none", borderTop: "1px solid var(--qz-rule)", margin: "2px 0" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="qz-label">Design · Template</div>
          <h2 className="qz-h2" style={{ margin: 0 }}>Pick a template</h2>
          <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
            Start from a vibe — it sets imagery, shape, spacing, and type. Fine-tune colors, fonts,
            and the style bar next; everything’s editable in the builder.
          </p>
        </div>
        {data.brandDerivedTokens ? (
          <button
            type="button"
            onClick={() => {
              setAppliedId(BRAND_TEMPLATE_ID);
              fetcher.submit(
                {
                  intent: "set-design",
                  tokens: JSON.stringify(data.brandDerivedTokens),
                  scope: brandScope,
                },
                { method: "post" },
              );
            }}
            disabled={applying}
            className="qz-card qz-interactive"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 12,
              cursor: "pointer",
              textAlign: "left",
              outline:
                panelTokens.template_id === BRAND_TEMPLATE_ID ? "2px solid var(--qz-accent)" : "none",
              outlineOffset: 2,
            }}
          >
            <span aria-hidden style={{ display: "flex", gap: 5 }}>
              {[
                data.brandDerivedTokens.colors?.background,
                data.brandDerivedTokens.colors?.primary,
                data.brandDerivedTokens.colors?.accent,
                data.brandDerivedTokens.colors?.text,
              ].map((c, i) => (
                <span
                  key={i}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: c,
                    border: "1px solid var(--qz-ink-4)",
                  }}
                />
              ))}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Your brand</span>
              <span className="qz-dim" style={{ fontSize: 11.5 }}>
                {panelTokens.template_id === BRAND_TEMPLATE_ID
                  ? "Applied ✓ · colors & fonts from your store"
                  : "Colors & fonts from your store"}
              </span>
            </span>
          </button>
        ) : null}
        <VibeTemplateSelector
          currentTokens={panelTokens}
          busy={applying}
          onApply={(t) =>
            fetcher.submit(
              { intent: "set-design", tokens: JSON.stringify(t.tokens), scope: brandScope },
              { method: "post" },
            )
          }
        />
        <div className="qz-label" style={{ marginTop: 4 }}>More themes</div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {THEME_PRESETS.map((p) => {
            const active = appliedId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => apply(p)}
                disabled={applying}
                className="qz-card qz-interactive"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 12,
                  cursor: "pointer",
                  textAlign: "left",
                  outline: active ? "2px solid var(--qz-accent)" : "none",
                  outlineOffset: 2,
                }}
              >
                <span aria-hidden style={{ display: "flex", gap: 5 }}>
                  {[
                    p.tokens.colors?.background ?? "#ffffff",
                    p.tokens.colors?.primary ?? "#111111",
                    p.tokens.colors?.accent ?? "#888888",
                    p.tokens.colors?.text ?? "#111111",
                  ].map((c, i) => (
                    <span
                      key={i}
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        background: c,
                        border: "1px solid var(--qz-ink-4)",
                      }}
                    />
                  ))}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                {active ? <span className="qz-dim" style={{ fontSize: 11.5 }}>Applied ✓</span> : null}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 2 }}>
          <FineTuneRow
            label="Shape"
            options={[["square", "Square"], ["rounded", "Rounded"], ["pill", "Pill"]]}
            active={panelTokens.radius}
            onPick={(v) => applyField("radius", v)}
            busy={applyingField}
          />
          <FineTuneRow
            label="Buttons"
            options={[["filled", "Filled"], ["outline", "Outline"], ["ghost", "Ghost"]]}
            active={panelTokens.button_style}
            onPick={(v) => applyField("button_style", v)}
            busy={applyingField}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div className="qz-label">Style bar</div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Fine-tune the template — slide to taste. Changes apply on top of the chosen vibe.
          </p>
          <StyleBar
            value={panelTokens.style_bar}
            onCommit={(sb) =>
              fetcher.submit(
                { intent: "set-style-bar", style_bar: JSON.stringify(sb), scope: brandScope },
                { method: "post" },
              )
            }
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          <div className="qz-label">Formatting</div>
          <p className="qz-dim" style={{ margin: 0, fontSize: 12 }}>
            Per-quiz layout. Applies on top of the theme — leave on Auto to keep the default.
          </p>
          <FineTuneRow
            label="Answers"
            options={[
              ["auto", "Auto"],
              ["list", "List"],
              ["grid", "Grid"],
            ]}
            active={panelTokens.answer_layout ?? "auto"}
            onPick={(v) => applyFormat("answer_layout", v)}
            busy={applyingFormat}
          />
          {panelTokens.answer_layout === "grid" ? (
            <FineTuneRow
              label="Columns"
              options={[
                ["2", "2"],
                ["3", "3"],
              ]}
              active={String(panelTokens.answer_grid_columns ?? 2)}
              onPick={(v) => applyFormat("answer_grid_columns", v)}
              busy={applyingFormat}
            />
          ) : null}
          <FineTuneRow
            label="Progress"
            options={[
              ["on", "On"],
              ["off", "Off"],
            ]}
            active={panelTokens.progress_bar?.enabled === false ? "off" : "on"}
            onPick={(v) => applyProgress({ enabled: v === "on" })}
            busy={applyingFormat}
          />
          {panelTokens.progress_bar?.enabled !== false ? (
            <>
              <FineTuneRow
                label="Style"
                options={[
                  ["bar", "Bar"],
                  ["dots", "Dots"],
                  ["steps", "Steps"],
                ]}
                active={panelTokens.progress_bar?.style ?? "bar"}
                onPick={(v) => applyProgress({ style: v })}
                busy={applyingFormat}
              />
              <FineTuneRow
                label="At"
                options={[
                  ["top", "Top"],
                  ["bottom", "Bottom"],
                ]}
                active={panelTokens.progress_bar?.position ?? "top"}
                onPick={(v) => applyProgress({ position: v })}
                busy={applyingFormat}
              />
            </>
          ) : null}
          <FineTuneRow
            label="Image"
            options={[
              ["top", "Top"],
              ["side", "Side"],
              ["none", "None"],
            ]}
            active={panelTokens.question_image_position ?? "top"}
            onPick={(v) => applyFormat("question_image_position", v)}
            busy={applyingFormat}
          />
        </div>
      </QzCard>
      {/* §7.6 — Back/Open-builder live in the funnel top bar now (stageNav). */}
    </div>
  );
}
