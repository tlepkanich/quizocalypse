import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { linesToRadiusPx, spacingToPadPx, hideDecorativeImagery } from "../../lib/styleBar";

// Design Settings spec §3 — the Style Bar: 3 continuous sliders (0-100) that
// fine-tune the chosen template. A small live mini-preview reflects radius +
// padding + image density immediately; the value persists on slider release
// (onCommit), and the runtime applies it via the --qz-radius / --qz-pad /
// --qz-image-density vars (styleBar.ts / tokensToCssVars).

type StyleBarValue = { image_density?: number; lines?: number; spacing?: number };

// image_density default MUST stay ≥ the hideDecorativeImagery threshold (20):
// the re-sync effect fills unset density with this value, so a merchant nudging
// only Lines/Spacing commits image_density: 50 — which must render the same as
// unset (show imagery), else that nudge would silently repaint the quiz.
const DEFAULTS: Required<StyleBarValue> = { image_density: 50, lines: 50, spacing: 50 };

function Row({
  label,
  lo,
  hi,
  value,
  onInput,
  onCommit,
}: {
  label: string;
  lo: string;
  hi: string;
  value: number;
  onInput: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="qz-col qz-gap-4">
      <div className="qz-row qz-row-between" style={{ alignItems: "baseline" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span className="qz-dim qz-mono" style={{ fontSize: 11 }}>{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label={label}
        onChange={(e) => onInput(e.target.valueAsNumber)}
        onMouseUp={onCommit}
        onTouchEnd={onCommit}
        onKeyUp={onCommit}
        style={{ width: "100%", accentColor: "var(--qz-accent)" }}
      />
      <div className="qz-row qz-row-between qz-dim" style={{ fontSize: 10.5 }}>
        <span>{lo}</span>
        <span>{hi}</span>
      </div>
    </div>
  );
}

export function StyleBar({
  value,
  onCommit,
}: {
  value: StyleBarValue | undefined;
  onCommit: (next: StyleBarValue) => void;
}) {
  const [sb, setSb] = useState<StyleBarValue>({ ...DEFAULTS, ...value });
  // Re-sync when the persisted value changes externally (e.g. a template applied).
  // Depend on the primitives (not the object, whose identity changes every render).
  const vImg = value?.image_density;
  const vLines = value?.lines;
  const vSpacing = value?.spacing;
  useEffect(() => {
    setSb({
      image_density: vImg ?? DEFAULTS.image_density,
      lines: vLines ?? DEFAULTS.lines,
      spacing: vSpacing ?? DEFAULTS.spacing,
    });
  }, [vImg, vLines, vSpacing]);

  const set = (k: keyof StyleBarValue, v: number) => setSb((s) => ({ ...s, [k]: v }));

  const radius = linesToRadiusPx(sb.lines ?? 50);
  const pad = spacingToPadPx(sb.spacing ?? 50);
  // The runtime effect is a single flip at the hideDecorativeImagery threshold,
  // not a continuum — the preview must show that cliff honestly, and on a
  // HEADER-image proxy (question headers + intro hero are what's gated), never
  // an answer swatch: answer imagery is functional and always shows.
  const hidesDecor = hideDecorativeImagery(sb.image_density ?? 50);

  const previewCard: CSSProperties = {
    border: "1px solid var(--qz-rule)",
    background: "var(--qz-paper)",
    borderRadius: radius,
    padding: pad,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  };

  return (
    <div className="qz-col qz-gap-12">
      <Row label="Image density" lo="Minimal" hi="Rich" value={sb.image_density ?? 50}
        onInput={(v) => set("image_density", v)} onCommit={() => onCommit(sb)} />
      <Row label="Lines" lo="Sharp" hi="Soft" value={sb.lines ?? 50}
        onInput={(v) => set("lines", v)} onCommit={() => onCommit(sb)} />
      <Row label="Spacing" lo="Compact" hi="Airy" value={sb.spacing ?? 50}
        onInput={(v) => set("spacing", v)} onCommit={() => onCommit(sb)} />

      <div className="qz-col qz-gap-4">
        <span className="qz-label" style={{ fontSize: 10.5 }}>Live preview</span>
        <div style={previewCard}>
          {hidesDecor ? null : (
            <span
              aria-hidden
              style={{
                height: 30,
                borderRadius: Math.min(radius, 12),
                background: "var(--qz-accent)",
                opacity: 0.35,
                flexShrink: 0,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Sample answer</div>
            <div className="qz-dim" style={{ fontSize: 11 }}>
              radius {radius}px · padding {pad}px
            </div>
          </div>
          <span
            style={{
              alignSelf: "flex-start",
              fontSize: 11,
              padding: "5px 12px",
              borderRadius: radius,
              background: "var(--qz-accent)",
              color: "#fff",
            }}
          >
            Continue
          </span>
        </div>
        <span className="qz-dim" style={{ fontSize: 10.5 }}>
          {hidesDecor
            ? "Text-forward: decorative images (question headers + the intro hero) are hidden at this density. Answer images always show."
            : "Decorative images (question headers + the intro hero) show at this density; below 20 they hide. Answer images always show."}
        </span>
      </div>
    </div>
  );
}
