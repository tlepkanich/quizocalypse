import { useMemo, useState } from "react";
import { QuizRuntime } from "../runtime/QuizRuntime";
import type { InspectTarget } from "../runtime/QuizRuntime";
import { QzBadge, QzButton, QzCard, QzField, QzInput, QzSegmented, QzSelect } from "../qz";
import { getPreset } from "../../lib/themePresets";
import { resolveDesignTokens, type DesignTokensT } from "../../lib/designTokens";
import { bakeResultPages } from "../../lib/quizPublish";
import type { StepProps } from "./stepProps";
import { DeviceFrame } from "./preview/DeviceFrame";
import { ReskinSwitcher } from "./preview/ReskinSwitcher";
import { LAYOUT_VARIANTS, applyLayoutVariant, detectLayoutVariant } from "../../lib/layoutVariants";
import {
  DEVICE_PRESETS,
  breakpointForWidth,
  presetForWidth,
  type DevicePreset,
} from "./preview/previewWidth";

type Launcher = StepProps["doc"]["launcher_config"];

// Step 4 — "Preview & publish". A LIVE, interactive preview: the real quiz
// runtime (mode="preview", no side-effects) runs inside a resizable device
// frame, with instant theme reskins. The "Open live" link still tests the
// published version on the storefront.

export function Step5Preview({
  doc,
  onCommit,
  productIndex,
  categories,
  ordered,
  previewUrl,
  quizId,
  onInspect,
  inspectedTarget,
  frameW: frameWProp,
  onFrameWChange,
  focusNodeId,
  onNodeShown,
  chromeless = false,
  platform = "shopify",
}: StepProps & {
  // Editor revamp P2: click-to-inspect pass-through (AI editor only — the
  // 4-step builder doesn't pass these, so its preview behaves as before).
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  // Unified P2: optional CONTROLLED frame width — the UnifiedWorkspace lifts it
  // so the ContextPanel's design-layer selector can follow the device frame
  // ("edit what you see"). Omit both for the classic uncontrolled behavior.
  frameW?: number;
  onFrameWChange?: (w: number) => void;
  // Unified P3: preview-only selection sync (rail ↔ runtime) pass-through.
  focusNodeId?: string | null;
  onNodeShown?: (nodeId: string) => void;
  // QB-1: the standalone Quizell builder owns its own chrome (top bar + Theme
  // tool), so it hides this component's header + Theme/Layout card and renders
  // just the device toolbar + the live frame in the centered canvas.
  chromeless?: boolean;
  // QB-5: the standalone builder passes "standalone" so the preview shows the
  // "Build with Quizocalypse" badge (matching the published quiz).
  platform?: "shopify" | "standalone";
}) {
  const [frameWState, setFrameWState] = useState<number>(DEVICE_PRESETS.desktop);
  const frameW = frameWProp ?? frameWState;
  const setFrameW = onFrameWChange ?? setFrameWState;
  const [tryOnId, setTryOnId] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);

  // Live draft recommendations: the runtime resolves result pages from the
  // baked `category_product_ids_map` (a publish-time field a draft lacks). Bake
  // it here from the builder's live buckets (StepProps.categories) using the
  // SAME publish logic, so preview result pages show real products without a
  // re-publish. The builder's productIndex is the full catalog, so the engine's
  // category-intersection resolves cleanly.
  const previewDoc = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.productIds]));
    return { ...doc, results_pages: bakeResultPages(doc, byId) };
  }, [doc, categories]);

  // Tried-on theme tokens layered over the saved doc (live, not yet saved).
  const tryOnTokens = useMemo<DesignTokensT | null>(() => {
    const preset = tryOnId ? getPreset(tryOnId) : undefined;
    return preset ? (resolveDesignTokens(preset.tokens) as DesignTokensT) : null;
  }, [tryOnId]);

  const activePreset = presetForWidth(frameW);
  const breakpoint = breakpointForWidth(frameW);

  const applyTheme = () => {
    const preset = tryOnId ? getPreset(tryOnId) : undefined;
    if (!preset) return;
    onCommit({
      ...doc,
      design_tokens: resolveDesignTokens(preset.tokens) as typeof doc.design_tokens,
    });
    setTryOnId(null);
  };

  const lc = doc.launcher_config;
  const setLauncher = (patch: Partial<Launcher>) =>
    onCommit({ ...doc, launcher_config: { ...lc, ...patch } });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!chromeless && (
        <div className="qz-row qz-row-between" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 className="qz-h1" style={{ margin: 0 }}>
              Preview &amp; publish
            </h2>
            <p className="qz-dim" style={{ marginTop: 4 }}>
              Your live quiz — click through it, resize the device, try a theme. Changes here are
              your draft; <strong>Publish</strong> pushes them live.
            </p>
          </div>
          <a href={previewUrl} target="_blank" rel="noreferrer" className="qz-btn qz-btn-ghost qz-btn-sm">
            Open live ↗
          </a>
        </div>
      )}

      {/* Toolbar: device size · width · restart. Hidden in the standalone builder
          (chromeless) — the device toggle + zoom live in the Quizell top bar. */}
      {!chromeless && (
      <div className="qz-row qz-row-between" style={{ alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="qz-row" style={{ gap: 10, alignItems: "center" }}>
          <QzSegmented<DevicePreset>
            ariaLabel="Device size"
            value={activePreset ?? "desktop"}
            onChange={(d) => setFrameW(DEVICE_PRESETS[d])}
            options={[
              { value: "mobile", label: "Mobile" },
              { value: "tablet", label: "Tablet" },
              { value: "desktop", label: "Desktop" },
            ]}
          />
          <span className="qz-dim" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {activePreset ? `${activePreset} · ` : "Custom · "}
            {frameW}px · {breakpoint}
          </span>
        </div>
        <QzButton size="sm" variant="ghost" onClick={() => setRestartKey((k) => k + 1)}>
          ↺ Restart
        </QzButton>
      </div>
      )}

      {/* Theme gallery — premium reskin picker with live mini-previews.
          Hidden in the standalone builder (chromeless): it lives in the Theme
          tool there, so the canvas stays a clean centered preview. */}
      {!chromeless && (
      <QzCard style={{ padding: 16 }}>
        <div
          className="qz-row qz-row-between"
          style={{ alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}
        >
          <div>
            <strong style={{ fontSize: 14 }}>Theme</strong>
            <div className="qz-dim" style={{ fontSize: 12 }}>
              Tap a theme to try it on the live preview below — nothing saves until you hit
              Apply.
            </div>
          </div>
          {tryOnId ? (
            <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
              <span className="qz-dim" style={{ fontSize: 12 }}>
                Trying on — not saved
              </span>
              <QzButton size="sm" variant="ghost" onClick={() => setTryOnId(null)}>
                Reset
              </QzButton>
              <QzButton size="sm" variant="accent" onClick={applyTheme}>
                Apply theme
              </QzButton>
            </div>
          ) : null}
        </div>
        <ReskinSwitcher value={tryOnId} onSelect={setTryOnId} />

        {/* Phase H — layout variants: structural presets orthogonal to the
            color themes (density / type scale / result layout). Applied
            immediately (autosave); the frame below reflects it live. */}
        <div style={{ marginTop: 14, borderTop: "1px solid var(--qz-rule, #eee)", paddingTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Layout</strong>
          <div className="qz-row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            {LAYOUT_VARIANTS.map((v) => {
              const active = detectLayoutVariant(doc) === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={active}
                  title={v.description}
                  onClick={() => onCommit(applyLayoutVariant(doc, v.id))}
                  className="qz-card qz-interactive"
                  style={{
                    font: "inherit",
                    textAlign: "left",
                    cursor: "pointer",
                    padding: "8px 12px",
                    minWidth: 150,
                    border: active
                      ? "2px solid var(--qz-accent, #2a6df4)"
                      : "1px solid var(--qz-rule, #e3ddd2)",
                    background: "var(--qz-paper, #fff)",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</div>
                  <div className="qz-dim" style={{ fontSize: 11, marginTop: 2 }}>{v.description}</div>
                </button>
              );
            })}
          </div>
        </div>
      </QzCard>
      )}

      {/* The live device frame */}
      <DeviceFrame width={frameW} onWidthChange={setFrameW}>
        <QuizRuntime
          key={restartKey}
          mode="preview"
          doc={previewDoc}
          productIndex={productIndex}
          designTokens={previewDoc.design_tokens ?? null}
          designOverrides={previewDoc.design_overrides}
          breakpointOverrides={previewDoc.breakpoint_overrides}
          resultLayoutMode={previewDoc.result_layout_mode}
          quizId={quizId}
          version={0}
          shopDomain=""
          platform={platform}
          tokensOverride={tryOnTokens}
          breakpoint={breakpoint}
          onInspect={onInspect}
          inspectedTarget={inspectedTarget}
          focusNodeId={focusNodeId}
          onNodeShown={onNodeShown}
        />
      </DeviceFrame>

      {ordered.orphans.length > 0 ? (
        <QzBadge tone="warn">
          {ordered.orphans.length} unreachable step(s) — fix in the Questions step
        </QzBadge>
      ) : null}

      <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
        Recommendations here resolve from your current product groups — the same products
        shoppers will see once you publish.
      </p>

      {/* Floating launcher config (unchanged) */}
      <QzCard style={{ padding: 16 }}>
        <div
          className="qz-row qz-row-between"
          style={{ alignItems: "center", marginBottom: lc.enabled ? 12 : 0 }}
        >
          <div>
            <strong style={{ fontSize: 14 }}>Floating launcher</strong>
            <div className="qz-dim" style={{ fontSize: 12 }}>
              Add a floating button that opens the quiz in a pop-up on your storefront (alongside
              the inline embed).
            </div>
          </div>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={lc.enabled}
              onChange={(e) => setLauncher({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        {lc.enabled ? (
          <div className="qz-row" style={{ gap: 16, flexWrap: "wrap" }}>
            <QzField label="Icon">
              <QzSelect
                value={lc.icon}
                onChange={(e) => setLauncher({ icon: e.target.value as Launcher["icon"] })}
              >
                <option value="sparkle">Sparkle</option>
                <option value="star">Star</option>
                <option value="chat">Chat</option>
              </QzSelect>
            </QzField>
            <QzField label="Corner">
              <QzSelect
                value={lc.corner}
                onChange={(e) => setLauncher({ corner: e.target.value as Launcher["corner"] })}
              >
                <option value="bottom-right">Bottom right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="top-right">Top right</option>
                <option value="top-left">Top left</option>
              </QzSelect>
            </QzField>
            <QzField label="Label (optional)">
              <QzInput
                value={lc.label}
                onChange={(e) => setLauncher({ label: e.target.value })}
                placeholder="Take the quiz"
              />
            </QzField>
          </div>
        ) : null}
      </QzCard>
    </div>
  );
}
