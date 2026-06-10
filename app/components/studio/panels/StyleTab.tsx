import { QzField, QzInput, QzSelect } from "../../qz";
import type { Quiz, QuizNode } from "../../../lib/quizSchema";
import { setDesignLayer, type DesignLayerMode } from "../../../lib/designLayers";

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
}: {
  doc: QuizDoc;
  node: QuizNode;
  mode: DesignLayerMode;
  onCommit: (doc: QuizDoc) => void;
}) {
  const layer =
    mode === "synced"
      ? doc.design_overrides[node.id]
      : doc.breakpoint_overrides[node.id]?.[mode];
  const colors = layer?.colors ?? {};

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
      {color("background", "Background")}
      {color("text", "Text")}
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
