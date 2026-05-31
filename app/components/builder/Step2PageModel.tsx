import { SHARED_RESULT_KEY } from "../../lib/resultLayout";
import { THEME_PRESETS } from "../../lib/themePresets";
import { resolveDesignTokens } from "../../lib/designTokens";
import { StepPreview } from "../runtime/StepPreview";
import { QzBadge } from "../qz";
import type { StepProps } from "./stepProps";

// Step 2 — "Should all your result pages share one layout, or should each be
// its own thing? (don't worry, you can change this later.)" Two posture cards,
// not a lock. Choosing "shared" cascades one design across every bucket's
// result page; the thumbnail strip shows it live.

export function Step2PageModel({ doc, onCommit, productIndex, categories }: StepProps) {
  const mode = doc.result_layout_mode;
  const resultNodes = doc.nodes.filter((n) => n.type === "result");

  const choose = (next: "shared" | "custom") => {
    let nextDoc = { ...doc, result_layout_mode: next };
    // Seed the shared template layer from the quiz tokens on first "shared"
    // pick so the cascade has something to apply.
    if (next === "shared" && !doc.design_overrides[SHARED_RESULT_KEY]) {
      nextDoc = {
        ...nextDoc,
        design_overrides: {
          ...nextDoc.design_overrides,
          [SHARED_RESULT_KEY]: doc.design_tokens ?? {},
        },
      };
    }
    onCommit(nextDoc);
  };

  const applyTheme = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onCommit({
      ...doc,
      design_tokens: resolveDesignTokens(preset.tokens) as typeof doc.design_tokens,
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 className="qz-h1" style={{ margin: 0 }}>
          Pick your starting posture
        </h2>
        <p className="qz-dim" style={{ marginTop: 6 }}>
          Should all your result pages share one layout, or should each be its own thing? You can
          change this later — it’s not a lock.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <PostureCard
          active={mode === "shared"}
          glyph="▱"
          title="One shared template"
          body="Every result page looks identical and just swaps in its own products. Fastest to ship — edit once, applies everywhere."
          onClick={() => choose("shared")}
        />
        <PostureCard
          active={mode === "custom"}
          glyph="▦"
          title="Custom per page"
          body="Everyone starts from one template, but each page is independently editable. Most flexible."
          onClick={() => choose("custom")}
        />
      </div>

      <div>
        <div className="qz-label" style={{ marginBottom: 8 }}>
          Starting theme
        </div>
        <div className="qz-row" style={{ gap: 8, flexWrap: "wrap" }}>
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => applyTheme(p.id)}
              className="qz-btn qz-btn-ghost qz-btn-sm"
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="qz-dim" style={{ fontSize: 12, marginTop: 6 }}>
          Sets the quiz's base colors + type. Fine-tune per step in the Page builder.
        </p>
      </div>

      <div>
        <div className="qz-label" style={{ marginBottom: 8 }}>
          Your result pages ({resultNodes.length})
        </div>
        {resultNodes.length === 0 ? (
          <p className="qz-dim" style={{ fontSize: 13 }}>
            No result pages yet — group products into buckets in Step 1 first.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
            {resultNodes.map((node) => (
              <div key={node.id} style={{ flex: "0 0 auto", width: 220 }}>
                <div
                  style={{
                    height: 150,
                    overflow: "hidden",
                    borderRadius: 10,
                    border: "1px solid #00000012",
                    background: "#FAFAFA",
                  }}
                >
                  <div
                    style={{
                      width: 220 / 0.4,
                      transform: "scale(0.4)",
                      transformOrigin: "top left",
                      padding: 16,
                      pointerEvents: "none",
                    }}
                  >
                    <StepPreview doc={doc} node={node} productIndex={productIndex} categories={categories} />
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>
                  {node.type === "result" ? node.data.headline : ""}
                </div>
              </div>
            ))}
          </div>
        )}
        {mode === "shared" ? (
          <p className="qz-dim" style={{ fontSize: 12, marginTop: 8 }}>
            Shared mode: design one template and it cascades to every page above. Per-page tweaks
            live in Step 3.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PostureCard({
  active,
  glyph,
  title,
  body,
  onClick,
}: {
  active: boolean;
  glyph: string;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="qz-card"
      style={{
        textAlign: "left",
        cursor: "pointer",
        padding: 18,
        border: active ? "2px solid var(--qz-accent, #2a6df4)" : "1px solid #00000014",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="qz-row qz-row-between" style={{ alignItems: "center" }}>
        <span style={{ fontSize: 28 }}>{glyph}</span>
        {active ? <QzBadge tone="ok">Selected</QzBadge> : null}
      </div>
      <span style={{ fontWeight: 700, fontSize: 16 }}>{title}</span>
      <span className="qz-dim" style={{ fontSize: 13 }}>
        {body}
      </span>
    </button>
  );
}
