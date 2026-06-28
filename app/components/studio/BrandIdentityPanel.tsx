import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  CURATED_FONTS,
  CURATED_FONT_CATEGORIES,
  FONT_CATEGORY_LABEL,
  isCuratedFont,
} from "../../lib/curatedFonts";
import { findContrastIssues, suggestContrastText } from "../../lib/designTokens";
import type { DesignTokens } from "../../lib/quizSchema";

// Design Settings spec §1 — Brand Identity (global): the 4 colors (primary /
// background / text with auto-contrast suggest / accent) + heading & body fonts
// (curated Google Fonts, the current/Shopify font surfaced first). A non-blocking
// WCAG AA warning shows when a pair fails contrast. Edits persist via the caller's
// onColor / onFont (set-design-color / set-design-font). Logo + reset/re-sync are
// separate sub-phases (D3b/D3c).

type ColorKey = "primary" | "background" | "text" | "accent";

const swatch: CSSProperties = {
  width: 34,
  height: 30,
  padding: 0,
  border: "1px solid var(--qz-rule)",
  borderRadius: 6,
  cursor: "pointer",
  background: "none",
};
const hexInput: CSSProperties = {
  width: 96,
  font: "inherit",
  fontSize: 13,
  padding: "5px 8px",
  border: "1px solid var(--qz-rule)",
  borderRadius: 6,
};
const selectStyle: CSSProperties = {
  font: "inherit",
  fontSize: 13,
  padding: "7px 10px",
  border: "1px solid var(--qz-rule)",
  borderRadius: 8,
  background: "var(--qz-paper)",
  width: "100%",
};

function ColorRow({
  label,
  value,
  onCommit,
  extra,
}: {
  label: string;
  value: string | undefined;
  onCommit: (hex: string) => void;
  extra?: React.ReactNode;
}) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  return (
    <div className="qz-row qz-gap-8" style={{ alignItems: "center" }}>
      <span style={{ fontSize: 13, width: 96, flexShrink: 0 }}>{label}</span>
      <input
        type="color"
        aria-label={`${label} color`}
        value={/^#[0-9a-fA-F]{6}$/.test(text) ? text : "#000000"}
        onChange={(e) => {
          setText(e.target.value);
          onCommit(e.target.value);
        }}
        style={swatch}
      />
      <input
        type="text"
        aria-label={`${label} hex`}
        value={text}
        placeholder="#000000"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v) && v !== value) onCommit(v);
        }}
        style={hexInput}
      />
      {extra}
    </div>
  );
}

function FontSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (family: string) => void;
}) {
  const current = value;
  const showCurrent = current && !isCuratedFont(current);
  return (
    <div className="qz-col qz-gap-4">
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <select
        aria-label={label}
        value={current ?? "Inter"}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      >
        {showCurrent ? <option value={current}>{current} (from your theme)</option> : null}
        {CURATED_FONT_CATEGORIES.map((cat) => (
          <optgroup key={cat} label={FONT_CATEGORY_LABEL[cat]}>
            {CURATED_FONTS.filter((f) => f.category === cat).map((f) => (
              <option key={f.family} value={f.family}>
                {f.family}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export function BrandIdentityPanel({
  tokens,
  onColor,
  onFont,
}: {
  tokens: DesignTokens;
  onColor: (key: ColorKey, hex: string) => void;
  onFont: (slot: "heading" | "body", family: string) => void;
}) {
  const c = tokens.colors ?? {};
  const issues = findContrastIssues(tokens);
  return (
    <div className="qz-col qz-gap-12">
      <div className="qz-col qz-gap-8">
        <ColorRow label="Primary" value={c.primary} onCommit={(v) => onColor("primary", v)} />
        <ColorRow label="Background" value={c.background} onCommit={(v) => onColor("background", v)} />
        <ColorRow
          label="Text"
          value={c.text}
          onCommit={(v) => onColor("text", v)}
          extra={
            c.background ? (
              <button
                type="button"
                className="qz-btn qz-btn-ghost qz-btn-sm"
                style={{ fontSize: 11 }}
                title="Set a contrast-safe text color for your background"
                onClick={() => onColor("text", suggestContrastText(c.background!))}
              >
                ✨ Auto
              </button>
            ) : null
          }
        />
        <ColorRow label="Accent" value={c.accent} onCommit={(v) => onColor("accent", v)} />
      </div>

      {issues.length > 0 ? (
        <div
          role="status"
          style={{
            fontSize: 12,
            lineHeight: 1.4,
            padding: "8px 10px",
            borderRadius: 8,
            background: "color-mix(in srgb, #B25E00 12%, transparent)",
            border: "1px solid color-mix(in srgb, #B25E00 35%, transparent)",
            color: "var(--qz-ink-2)",
          }}
        >
          ⚠ Low contrast (below WCAG AA 4.5:1):{" "}
          {issues.map((i) => `${i.pair} ${i.ratio.toFixed(1)}:1`).join(" · ")}. Readable colors
          convert better — adjust or use ✨ Auto.
        </div>
      ) : null}

      <div className="qz-row qz-gap-12" style={{ flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <FontSelect label="Heading font" value={tokens.typography?.heading?.family} onChange={(f) => onFont("heading", f)} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <FontSelect label="Body font" value={tokens.typography?.body?.family} onChange={(f) => onFont("body", f)} />
        </div>
      </div>
    </div>
  );
}
