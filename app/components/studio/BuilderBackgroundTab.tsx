import { useState } from "react";
import type { Quiz, QuizNode } from "../../lib/quizSchema";
import {
  readabilityHint,
  applyBackgroundToAll,
  screensWithBackgroundOverride,
  hasBackgroundOverride,
  type ScreenBackground,
} from "../../lib/screenBackground";
import { resolveDesignTokens } from "../../lib/designTokens";
import { NumericControl } from "../controls/NumericControl";
import { BuilderPageSettings } from "./BuilderPageSettings";
import { useQzToast } from "../qz-toast";
import { MediaPicker } from "./MediaPicker";

// ════════════════════════════════════════════════════════════════════════════
// BuilderBackgroundTab (QZY-11 + R3, build-tab v2.0 §5.3/§8/§9) — PER-SCREEN
// backgrounds with the master/override model:
//   • Scope control "This screen / All screens" (§5.3): This-screen edits write
//     a per-screen override (node_backgrounds); All-screens edits the quiz-wide
//     default (the master, in Design). A per-screen override WINS.
//   • Apply-all RESPECTS overrides (§9): customized screens are kept, the kept
//     count is shown, and "Include customized" is the explicit stomp escape
//     hatch — never a silent auto-overwrite.
//   • A Custom indicator flags a screen that overrides the default.
// Video is ALWAYS muted (§8.2); mobile defaults to the poster fallback.
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

const SWATCH_FALLBACK = resolveDesignTokens().colors?.background ?? "";

export function BuilderBackgroundTab({
  doc,
  node,
  commit,
}: {
  doc: QuizDoc;
  /** The screen being edited (the canvas's current step). */
  node: QuizNode | null;
  commit: (doc: QuizDoc) => void;
}) {
  const toast = useQzToast();
  const [scope, setScope] = useState<"screen" | "all">("screen");
  const [applyConfirm, setApplyConfirm] = useState(false);

  if (!node) {
    return (
      <div className="qz-card" style={{ padding: 14 }}>
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          Select a screen in the carousel below to set its background.
        </p>
      </div>
    );
  }
  const bg: ScreenBackground = doc.node_backgrounds?.[node.id] ?? {};
  const write = (next: ScreenBackground | null) => {
    const map = { ...(doc.node_backgrounds ?? {}) };
    if (next && Object.keys(next).length > 0) map[node.id] = next;
    else delete map[node.id];
    if (Object.keys(map).length === 0) {
      const { node_backgrounds: _dropped, ...rest } = doc;
      commit(rest as QuizDoc);
    } else {
      commit({ ...doc, node_backgrounds: map });
    }
  };
  const patch = (p: Partial<ScreenBackground>) => {
    const next: Record<string, unknown> = { ...bg };
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    write(next as ScreenBackground);
  };
  const hint = readabilityHint(bg);

  // §9 master/override state.
  const thisIsCustom = hasBackgroundOverride(doc, node.id);
  const otherOverrides = screensWithBackgroundOverride(doc).filter((id) => id !== node.id);
  const allCustomCount = screensWithBackgroundOverride(doc).length;

  const doApplyAll = (includeCustomized: boolean) => {
    const { doc: next, skipped } = applyBackgroundToAll(doc, bg, {
      sourceNodeId: node.id,
      includeCustomized,
    });
    commit(next);
    setApplyConfirm(false);
    toast(
      skipped > 0
        ? `Applied — ${skipped} custom screen${skipped === 1 ? "" : "s"} kept.`
        : otherOverrides.length > 0
          ? `Applied to all screens (${otherOverrides.length} custom replaced).`
          : "Background applied to all screens.",
    );
  };
  const onApplyClick = () => {
    if (otherOverrides.length === 0) doApplyAll(false);
    else setApplyConfirm(true);
  };
  const setScopeTo = (next: "screen" | "all") => {
    if (next === scope) return;
    setScope(next);
    setApplyConfirm(false);
    if (next === "all" && thisIsCustom) {
      toast("This screen keeps its custom background — edits here change the default.");
    }
  };

  const colorField = (
    label: string,
    key: "color" | "color2" | "color3" | "color4" | "fill_color" | "overlay_color",
  ) => (
    <label className="qz-ads-color">
      <span>{label}</span>
      <input
        type="color"
        value={bg[key] ?? SWATCH_FALLBACK}
        onChange={(e) => patch({ [key]: e.target.value })}
      />
    </label>
  );
  const urlField = (label: string, key: "image_url" | "video_url" | "poster_url") => (
    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
      <span className="qz-dim" style={{ fontSize: 11.5 }}>
        {label}
      </span>
      <input
        className="qz-input"
        value={bg[key] ?? ""}
        placeholder="https://…"
        onChange={(e) => patch({ [key]: e.target.value.trim() || undefined })}
      />
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* §5.3 — scope control: where do background edits land? */}
      <div className="qz-segmented qz-segmented--fill" role="group" aria-label="Background applies to">
        <button type="button" aria-pressed={scope === "screen"} onClick={() => setScopeTo("screen")}>
          This screen
        </button>
        <button type="button" aria-pressed={scope === "all"} onClick={() => setScopeTo("all")}>
          All screens
        </button>
      </div>

      {scope === "all" ? (
        // ── Master: the quiz-wide default (Design). Screens with their own
        // background keep it — §9's "won't change" count is surfaced here. ──
        <>
          <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
            The default applies to every screen without its own background.
          </p>
          {allCustomCount > 0 ? (
            <p className="qz-dim" role="note" style={{ fontSize: 11.5, margin: 0 }}>
              {allCustomCount} screen{allCustomCount === 1 ? "" : "s"} have a custom background and
              won&rsquo;t change.
            </p>
          ) : null}
          <BuilderPageSettings doc={doc} commit={commit} />
        </>
      ) : (
        <>
          <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
            <div className="qz-label" style={{ fontSize: 11 }}>
              Background — this screen
            </div>
            {thisIsCustom ? (
              <span
                className="qz-dim"
                title="This screen overrides the default background"
                style={{ fontSize: 9.5, letterSpacing: 0.4, textTransform: "uppercase" }}
              >
                ● Custom
              </span>
            ) : null}
          </div>
          <div className="qz-segmented" role="group" aria-label="Background type">
            {(["none", "color", "gradient", "split", "quadrant", "image", "video", "partial"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === "none" ? bg.type === undefined : bg.type === t}
                onClick={() => {
                  if (t === "none") return write(null);
                  // R6-2 §4 — auto-add a readability overlay when switching to an
                  // image/video/partial background (only if none is set yet).
                  const needsOverlay =
                    (t === "image" || t === "video" || t === "partial") && bg.overlay === undefined;
                  patch(needsOverlay ? { type: t, overlay: 30 } : { type: t });
                }}
              >
                {t === "none" ? "None" : t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {bg.type === "color" ? colorField("Color", "color") : null}
          {bg.type === "gradient" ? (
            <>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorField("From", "color")}
                {colorField("To", "color2")}
                {colorField("Third", "color3")}
              </div>
              <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <div className="qz-segmented" role="group" aria-label="Gradient shape">
                  {(["linear", "radial"] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={(bg.gradient_type ?? "linear") === g}
                      onClick={() => patch({ gradient_type: g === "linear" ? undefined : g })}
                    >
                      {g[0]!.toUpperCase() + g.slice(1)}
                    </button>
                  ))}
                </div>
                {(bg.gradient_type ?? "linear") === "linear" ? (
                  <NumericControl
                    label="Angle"
                    value={bg.angle}
                    min={0}
                    max={360}
                    step={5}
                    fallback={135}
                    allowEmpty
                    suffix="°"
                    onChange={(n) => patch({ angle: n })}
                  />
                ) : null}
              </div>
            </>
          ) : null}
          {/* build-tab §6 — split: two regions, direction, edge position + softness. */}
          {bg.type === "split" ? (
            <>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorField("Side A", "color")}
                {colorField("Side B", "color2")}
              </div>
              <div className="qz-segmented" role="group" aria-label="Split direction">
                {(["horizontal", "vertical", "diagonal"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={(bg.split_dir ?? "horizontal") === d}
                    onClick={() => patch({ split_dir: d === "horizontal" ? undefined : d })}
                  >
                    {d[0]!.toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <NumericControl
                  label="Position"
                  value={bg.split_pos}
                  min={0}
                  max={100}
                  step={5}
                  fallback={50}
                  allowEmpty
                  suffix="%"
                  onChange={(n) => patch({ split_pos: n })}
                />
                <NumericControl
                  label="Softness"
                  value={bg.split_soft}
                  min={0}
                  max={40}
                  step={2}
                  fallback={0}
                  allowEmpty
                  onChange={(n) => patch({ split_soft: n })}
                />
              </div>
            </>
          ) : null}
          {/* §6 — quadrant: four corner fills + off-center split lines. */}
          {bg.type === "quadrant" ? (
            <>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorField("Top left", "color")}
                {colorField("Top right", "color2")}
              </div>
              <div className="qz-row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {colorField("Bottom left", "color3")}
                {colorField("Bottom right", "color4")}
              </div>
              <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <NumericControl
                  label="Split X"
                  value={bg.split_x}
                  min={0}
                  max={100}
                  step={5}
                  fallback={50}
                  allowEmpty
                  suffix="%"
                  onChange={(n) => patch({ split_x: n })}
                />
                <NumericControl
                  label="Split Y"
                  value={bg.split_y}
                  min={0}
                  max={100}
                  step={5}
                  fallback={50}
                  allowEmpty
                  suffix="%"
                  onChange={(n) => patch({ split_y: n })}
                />
              </div>
            </>
          ) : null}
          {bg.type === "image" ? (
            // §8 — the shared picker (upload as base64 + URL) for the screen image.
            <MediaPicker
              image={bg.image_url}
              onImage={(v) => patch({ image_url: v })}
              onClear={() => patch({ image_url: undefined })}
            />
          ) : null}
          {bg.type === "partial" ? (
            // R6-1 §4 — image fills a band; the rest is the fill colour.
            <>
              <MediaPicker
                image={bg.image_url}
                onImage={(v) => patch({ image_url: v })}
                onClear={() => patch({ image_url: undefined })}
              />
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  Band
                </span>
                <div className="qz-segmented" role="group" aria-label="Partial image band">
                  {(["left", "top", "right"] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={(bg.band ?? "left") === b}
                      onClick={() => patch({ band: b === "left" ? undefined : b })}
                    >
                      {b[0]!.toUpperCase() + b.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <NumericControl
                label="Coverage"
                value={bg.coverage}
                min={10}
                max={90}
                fallback={50}
                allowEmpty
                suffix="%"
                onChange={(n) => patch({ coverage: n })}
              />
              {colorField("Fill", "fill_color")}
            </>
          ) : null}
          {bg.type === "video" ? (
            <>
              {urlField("Video URL (MP4/WebM)", "video_url")}
              {urlField("Poster frame", "poster_url")}
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  On mobile
                </span>
                <div className="qz-segmented" role="group" aria-label="Mobile video behavior">
                  {(["poster", "play"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={(bg.mobile_video ?? "poster") === m}
                      onClick={() => patch({ mobile_video: m === "poster" ? undefined : m })}
                    >
                      {m === "poster" ? "Show poster" : "Play video"}
                    </button>
                  ))}
                </div>
              </div>
              <p className="qz-dim" style={{ fontSize: 11.5, margin: 0 }}>
                Background video always plays muted (browser autoplay rules).
              </p>
            </>
          ) : null}
          {bg.type === "image" || bg.type === "video" ? (
            <>
              <div className="qz-row" style={{ gap: 6, alignItems: "center" }}>
                <span className="qz-dim" style={{ fontSize: 11.5 }}>
                  Fit
                </span>
                <div className="qz-segmented" role="group" aria-label="Background fit">
                  {(["cover", "contain", "tile"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={(bg.fit ?? "cover") === f}
                      disabled={f === "tile" && bg.type === "video"}
                      onClick={() => patch({ fit: f === "cover" ? undefined : f })}
                    >
                      {f[0]!.toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <NumericControl
                  label="Focal X"
                  value={bg.focal_x}
                  min={0}
                  max={100}
                  fallback={50}
                  allowEmpty
                  suffix="%"
                  onChange={(n) => patch({ focal_x: n })}
                />
                <NumericControl
                  label="Focal Y"
                  value={bg.focal_y}
                  min={0}
                  max={100}
                  fallback={50}
                  allowEmpty
                  suffix="%"
                  onChange={(n) => patch({ focal_y: n })}
                />
                {bg.type === "image" ? (
                  <NumericControl
                    label="Zoom"
                    value={bg.zoom}
                    min={100}
                    max={300}
                    fallback={100}
                    allowEmpty
                    suffix="%"
                    onChange={(n) => patch({ zoom: n })}
                  />
                ) : null}
              </div>
            </>
          ) : null}
          {bg.type ? (
            <>
              <div className="qz-row" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <NumericControl
                  label="Overlay"
                  value={bg.overlay}
                  min={0}
                  max={80}
                  fallback={0}
                  allowEmpty
                  suffix="%"
                  onChange={(n) => patch({ overlay: n })}
                />
                {/* R6-2 §4 — overlay tint colour (absent → black). */}
                {colorField("Overlay tint", "overlay_color")}
              </div>
              {hint ? (
                <p className="qz-dim" role="note" style={{ fontSize: 11.5, margin: 0 }}>
                  💡 {hint}
                </p>
              ) : null}
              <details className="qz-insp-more" style={{ flex: "0 0 auto" }}>
                <summary>More options</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                  <NumericControl
                    label="Blur"
                    value={bg.blur}
                    min={0}
                    max={20}
                    fallback={0}
                    allowEmpty
                    suffix="px"
                    onChange={(n) => patch({ blur: n })}
                  />
                  {bg.type === "image" ? (
                    <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={Boolean(bg.fixed)}
                        onChange={(e) => patch({ fixed: e.target.checked || undefined })}
                      />
                      Fixed (doesn&rsquo;t scroll)
                    </label>
                  ) : null}
                </div>
              </details>
              {/* §9 apply-all that respects overrides. */}
              {applyConfirm ? (
                <div
                  role="alertdialog"
                  aria-label="Apply background to all screens"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: 10,
                    borderRadius: 8,
                    border: "1px solid var(--qz-rule)",
                  }}
                >
                  <span className="qz-dim" style={{ fontSize: 12 }}>
                    {otherOverrides.length} other screen{otherOverrides.length === 1 ? "" : "s"} have a
                    custom background.
                  </span>
                  <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="qz-btn qz-btn-accent qz-btn-sm"
                      onClick={() => doApplyAll(false)}
                    >
                      Apply to the rest
                    </button>
                    <button
                      type="button"
                      className="qz-btn qz-btn-ghost qz-btn-sm"
                      onClick={() => doApplyAll(true)}
                    >
                      Include customized
                    </button>
                    <button
                      type="button"
                      className="qz-btn qz-btn-ghost qz-btn-sm"
                      onClick={() => setApplyConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={onApplyClick}>
                  Apply to all screens…
                </button>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
