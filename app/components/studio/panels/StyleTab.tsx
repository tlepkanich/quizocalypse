import { QzField, QzInput, QzSelect } from "../../qz";
import type { Quiz, QuizNode } from "../../../lib/quizSchema";
import { setDesignLayer, type DesignLayerMode } from "../../../lib/designLayers";
import { mergeTokens } from "../../../lib/designLayers";
import { findContrastIssues } from "../../../lib/designTokens";

// ════════════════════════════════════════════════════════════════════════════
// Style panel — node design tokens, synced or per-breakpoint (Unified P0:
// extracted from StudioBuilder verbatim; writes via the shared setDesignLayer).
// ════════════════════════════════════════════════════════════════════════════

type QuizDoc = Quiz;

export function StyleTab({
  doc,
  node,
  mode,
  onCommit,
  hideBackground = false,
}: {
  doc: QuizDoc;
  node: QuizNode;
  mode: DesignLayerMode;
  onCommit: (doc: QuizDoc) => void;
  // build-tab v2.0 §1 — decider docs edit the screen background ONLY in the left
  // Background tab; the right inspector must not carry a page-background control.
  hideBackground?: boolean;
}) {
  const layer =
    mode === "synced"
      ? doc.design_overrides[node.id]
      : doc.breakpoint_overrides[node.id]?.[mode];
  const colors = layer?.colors ?? {};

  // Phase H — WCAG check on the EFFECTIVE tokens for this node (quiz tokens
  // merged with this layer's overrides). Warn-only; merchants can override.
  const contrastIssues = findContrastIssues(
    mergeTokens(doc.design_tokens ?? {}, layer ?? {}),
  );

  const color = (key: "primary" | "background" | "text", label: string) => (
    <QzField label={label} key={key}>
      <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
        <input
          type="color"
          value={colors[key] ?? "#000000"}
          onChange={(e) => onCommit(setDesignLayer(doc, node.id, mode, { colors: { [key]: e.target.value } }))}
          style={{ width: 36, height: 30, border: "none", background: "none" }}
        />
        <QzInput
          value={colors[key] ?? ""}
          placeholder="inherit"
          onChange={(e) => onCommit(setDesignLayer(doc, node.id, mode, { colors: { [key]: e.target.value } }))}
        />
      </div>
    </QzField>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
        Editing the <strong>{mode}</strong> layer. Use the preview toggle to switch.
      </p>
      {color("primary", "Primary")}
      {hideBackground ? null : color("background", "Background")}
      {color("text", "Text")}
      {contrastIssues.length > 0 ? (
        <div
          role="status"
          style={{
            fontSize: 11.5,
            padding: "8px 10px",
            borderRadius: 8,
            background: "color-mix(in srgb, #d9822b 12%, transparent)",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {contrastIssues.map((i) => (
            <span key={i.pair}>
              ⚠ {i.pair}: {i.ratio.toFixed(1)}:1 — below WCAG AA
            </span>
          ))}
        </div>
      ) : null}
      <QzField label="Corner radius">
        <QzSelect
          value={layer?.radius ?? ""}
          onChange={(e) =>
            onCommit(setDesignLayer(doc, node.id, mode, { radius: (e.target.value || undefined) as never }))
          }
        >
          <option value="">Inherit</option>
          <option value="square">Square</option>
          <option value="rounded">Rounded</option>
          <option value="pill">Pill</option>
        </QzSelect>
      </QzField>
      <QzField label="Button style">
        <QzSelect
          value={layer?.button_style ?? ""}
          onChange={(e) =>
            onCommit(setDesignLayer(doc, node.id, mode, { button_style: (e.target.value || undefined) as never }))
          }
        >
          <option value="">Inherit</option>
          <option value="filled">Filled</option>
          <option value="outline">Outline</option>
          <option value="ghost">Ghost</option>
        </QzSelect>
      </QzField>
    </div>
  );
}
