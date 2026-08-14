import { useCallback, useMemo, useState } from "react";
import { QuizRuntime } from "../runtime/QuizRuntime";
import type { InspectTarget } from "../runtime/QuizRuntime";
import { QzBadge, QzButton, QzCard, QzField, QzInput, QzSegmented, QzSelect } from "../qz";
import { getPreset } from "../../lib/themePresets";
import { resolveDesignTokens, type DesignTokensT } from "../../lib/designTokens";
import { bakeResultPages, withDraftChapters } from "../../lib/quizPublish";
import { draftDeciderBake } from "../../lib/draftDeciderBake";
import type { StepProps } from "./stepProps";
import { DeviceFrame, type FrameFit } from "./preview/DeviceFrame";
import { ResizableViewport } from "./preview/ResizableViewport";
import { ReskinSwitcher } from "./preview/ReskinSwitcher";
import { LAYOUT_VARIANTS, applyLayoutVariant, detectLayoutVariant } from "../../lib/layoutVariants";
import {
  DEFAULT_TIER,
  DEVICES,
  DEVICE_TIERS,
  TIER_BREAKPOINT,
  TIER_LABEL,
  breakpointForWidth,
  type DeviceTier,
} from "./preview/previewWidth";

type Launcher = StepProps["doc"]["launcher_config"];

// Step 4 — "Preview & publish". A LIVE, interactive preview: the real quiz
// runtime (mode="preview", no side-effects) with instant theme reskins.
// CHROMELESS (the standalone builder canvas) renders the drag/2026-08
// ResizableViewport — a 1:1 browser window whose width the merchant drags,
// flipping layouts at 900px exactly like live. The classic (non-chromeless)
// surface keeps the two FIXED scaled viewports (viewport/2026-08). The
// "Open live" link still tests the published version on the storefront.

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
  shopBrandTokens,
  tier: tierProp,
  onTierChange,
  zoom,
  viewportWidth,
  onViewportWidthChange,
  onViewportWidth,
  paneHeight,
  focusNodeId,
  onNodeShown,
  chromeless = false,
  platform = "shopify",
}: StepProps & {
  // Editor revamp P2: click-to-inspect pass-through (AI editor only — the
  // 4-step builder doesn't pass these, so its preview behaves as before).
  onInspect?: (target: InspectTarget) => void;
  inspectedTarget?: InspectTarget | null;
  // Unified P2: optional CONTROLLED device tier — the UnifiedWorkspace lifts it
  // so the ContextPanel's design-layer selector can follow the device frame
  // ("edit what you see"). Omit both for the classic uncontrolled behavior.
  tier?: DeviceTier;
  onTierChange?: (t: DeviceTier) => void;
  // C4 — the classic surface's zoom, a CEILING on the fit scale (never a
  // multiplier). Omitted → 100. Ignored in chromeless mode (always 1:1).
  zoom?: number;
  // drag/2026-08 (chromeless only) — the resizable viewport's width, lifted
  // by the host: null = fill the pane; a number = dragged/preset width.
  viewportWidth?: number | null;
  onViewportWidthChange?: (w: number | null) => void;
  // Reports the RENDERED width (pane-sized in fill mode) plus the fit scale
  // (1 = shown 1:1) so the host can derive the mode for its device toggle /
  // readout / design-layer selector and label a scaled-to-fit frame.
  onViewportWidth?: (w: number, scale?: number) => void;
  // Forwarded to DeviceFrame. Required from any host whose container is
  // auto-height, or the fit rule's height axis measures 0.
  paneHeight?: number | string;
  // Unified P3: preview-only selection sync (rail ↔ runtime) pass-through.
  focusNodeId?: string | null;
  onNodeShown?: (nodeId: string) => void;
  // QB-1: the standalone Quizell builder owns its own chrome (top bar + Theme
  // tool), so it hides this component's header + Theme/Layout card and renders
  // just the device toolbar + the live frame in the centered canvas.
  chromeless?: boolean;
  // QB-5: the standalone builder passes "standalone" so the preview shows the
  // "Build with wiskr.ai" badge (matching the published quiz).
  platform?: "shopify" | "standalone";
}) {
  const [tierState, setTierState] = useState<DeviceTier>(DEFAULT_TIER);
  const tier = tierProp ?? tierState;
  const setTier = onTierChange ?? setTierState;
  const [fit, setFit] = useState<FrameFit | null>(null);
  const [tryOnId, setTryOnId] = useState<string | null>(null);
  const [restartKey, setRestartKey] = useState(0);
  // SPEC — "scroll position resets when the previewed step changes": track the
  // step the runtime is SHOWING (selection jumps AND interact-mode walks both
  // land here) and hand it to the frame as its scroll-reset key.
  const [shownNodeId, setShownNodeId] = useState<string | null>(null);
  const handleNodeShown = useCallback(
    (nodeId: string) => {
      setShownNodeId(nodeId);
      onNodeShown?.(nodeId);
    },
    [onNodeShown],
  );

  // Live draft recommendations: the runtime resolves result pages from the
  // baked `category_product_ids_map` (a publish-time field a draft lacks). Bake
  // it here from the builder's live buckets (StepProps.categories) using the
  // SAME publish logic, so preview result pages show real products without a
  // re-publish. The builder's productIndex is the full catalog, so the engine's
  // category-intersection resolves cleanly.
  const previewDoc = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c.productIds]));
    // WYSIWYG parity — resolve the SAME design-token cascade publish bakes
    // (shop brand → quiz overrides → schema defaults, quizPublish.ts). The
    // draft's design_tokens are SPARSE; feeding them raw made the canvas
    // render publish-default typography/spacing the shopper never sees
    // (e.g. brand scale 1.2 vs default 1.25 → question headlines wrapped
    // differently at 390px than any real phone). Render-only: commits still
    // write the merchant's own sparse `doc`, never this resolution.
    const resolvedTokens = resolveDesignTokens(
      shopBrandTokens ?? null,
      doc.design_tokens,
    ) as DesignTokensT;
    // FIX-1 mirror (quizPublish.ts) — decider docs publish with the card-less
    // "minimal" chrome baked in unless the doc says otherwise.
    if (doc.logic_model === "decider" && !resolvedTokens.chrome) {
      resolvedTokens.chrome = "minimal";
    }
    // QRTZ-F2 — withDraftChapters: the Chapters analog of the bake above (same
    // deriveChapters + gating as publish), so the preview's progress bar
    // matches published /q. Legacy drafts pass through untouched.
    return withDraftChapters({
      ...doc,
      results_pages: bakeResultPages(doc, byId),
      design_tokens: resolvedTokens as typeof doc.design_tokens,
      ...(doc.design_linked === false && doc.rec_page_design
        ? {
            rec_page_design: resolveDesignTokens(
              shopBrandTokens ?? null,
              doc.rec_page_design,
            ) as typeof doc.rec_page_design,
          }
        : {}),
    });
  }, [doc, categories, shopBrandTokens]);

  // LOGIC v2 (L2-10a) — the decider analog of the bake above: derive the
  // publish-time target map from the live buckets so a decider draft's reveal
  // resolves real products pre-publish. Legacy docs derive nothing → the
  // runtime props stay null → engine inputs byte-identical to before.
  const deciderBake = useMemo(
    () => (doc.logic_model === "decider" ? draftDeciderBake(categories) : null),
    [doc, categories],
  );

  // Tried-on theme tokens layered over the saved doc (live, not yet saved).
  const tryOnTokens = useMemo<DesignTokensT | null>(() => {
    const preset = tryOnId ? getPreset(tryOnId) : undefined;
    return preset ? (resolveDesignTokens(preset.tokens) as DesignTokensT) : null;
  }, [tryOnId]);

  // Position-true jumps — hand the runtime the spine's question prefix for
  // the focused step, so the counter + progress bar show the step's REAL
  // position (live shows "Question 2 of 3" on the second question; the
  // canvas previously always said "Question 1"). Spine only: a node not on
  // the main run (branch lane / orphan) falls back to the old clean jump.
  const focusPath = useMemo(() => {
    if (!focusNodeId) return null;
    const idx = ordered.steps.findIndex((s) => s.nodeId === focusNodeId);
    if (idx < 0) return null;
    return ordered.steps
      .slice(0, idx)
      .filter((s) => s.type === "question")
      .map((s) => ({ questionNodeId: s.nodeId, answerIds: [] as string[] }));
  }, [focusNodeId, ordered.steps]);

  // drag/2026-08 — chromeless derives the breakpoint from the viewport's
  // RENDERED width with the runtime's own 900px function, so dragging across
  // the line flips the layout exactly as a live browser resize would.
  const [vpRenderedW, setVpRenderedW] = useState<number | null>(null);
  const handleViewportWidth = useCallback(
    (w: number, scale: number) => {
      setVpRenderedW(w);
      onViewportWidth?.(w, scale);
    },
    [onViewportWidth],
  );

  // A1 (classic surfaces) — this prop, not the frame's pixel width, is what
  // makes the quiz render its phone layout: QuizRuntime ignores container
  // measurement in preview. Chromeless: width-derived (0 → mobile, matching
  // the pre-measurement SSR default).
  const breakpoint = chromeless
    ? breakpointForWidth(vpRenderedW ?? viewportWidth ?? 0)
    : TIER_BREAKPOINT[tier];

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

  // ONE runtime element for both frame kinds — the frame is presentation,
  // the quiz inside must be identical either way.
  const runtime = (
    <QuizRuntime
      key={restartKey}
      mode="preview"
      doc={previewDoc}
      productIndex={productIndex}
      designTokens={previewDoc.design_tokens ?? null}
      designOverrides={previewDoc.design_overrides}
      breakpointOverrides={previewDoc.breakpoint_overrides}
      resultLayoutMode={previewDoc.result_layout_mode}
      designLinked={previewDoc.design_linked ?? true}
      recPageDesign={previewDoc.rec_page_design ?? null}
      quizId={quizId}
      version={0}
      shopDomain=""
      platform={platform}
      targetProductIdsMap={deciderBake?.targetProductIdsMap ?? null}
      targetIndex={deciderBake?.targetIndex ?? null}
      tokensOverride={tryOnTokens}
      breakpoint={breakpoint}
      onInspect={onInspect}
      inspectedTarget={inspectedTarget}
      focusNodeId={focusNodeId}
      focusPath={focusPath}
      onNodeShown={handleNodeShown}
    />
  );

  return (
    <div className={chromeless ? "qz-step5-chromeless" : undefined} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!chromeless && (
        <div className="qz-row qz-row-between" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 className="qz-h1" style={{ margin: 0 }}>
              Preview &amp; publish
            </h2>
            <p className="qz-dim" style={{ marginTop: 4 }}>
              Your live quiz — click through it, switch device, try a theme. Changes here are
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
          <QzSegmented<DeviceTier>
            ariaLabel="Device"
            value={tier}
            onChange={setTier}
            options={DEVICE_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
          />
          {/* The readout: a fact you can check, not a control to think about. */}
          <span className="qz-dim" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {TIER_LABEL[tier]} · {DEVICES[tier].w} × {DEVICES[tier].h}
            {fit
              ? fit.constrainedBy === "none"
                ? " · actual size"
                : ` · ${Math.round(fit.scale * 100)}%`
              : ""}
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

      {/* The live frame: chromeless = the drag/2026-08 resizable browser
          window (1:1, width lifted by the host); classic = the fixed scaled
          DeviceFrame. Both host the SAME runtime children below. */}
      {chromeless ? (
        <ResizableViewport
          widthPx={viewportWidth ?? null}
          onWidthPx={(w) => onViewportWidthChange?.(w)}
          onEffectiveWidth={handleViewportWidth}
          paneHeight={paneHeight}
          placement={previewDoc.placement ?? "page"}
          resetKey={shownNodeId}
        >
          {runtime}
        </ResizableViewport>
      ) : (
        <DeviceFrame
          tier={tier}
          zoom={zoom}
          paneHeight={paneHeight}
          resetKey={shownNodeId}
          onFit={setFit}
        >
          {runtime}
        </DeviceFrame>
      )}

      {!chromeless && ordered.orphans.length > 0 ? (
        <QzBadge tone="warn">
          {ordered.orphans.length} unreachable step(s) — fix in the Questions step
        </QzBadge>
      ) : null}

      {!chromeless ? <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
        Recommendations here resolve from your current product groups — the same products
        shoppers will see once you publish.
      </p> : null}

      {/* Floating launcher config (unchanged) */}
      {!chromeless ? <QzCard style={{ padding: 16 }}>
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
      </QzCard> : null}
    </div>
  );
}
