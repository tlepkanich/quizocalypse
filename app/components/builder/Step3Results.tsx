import { SHARED_RESULT_KEY } from "../../lib/resultLayout";
import { THEME_PRESETS } from "../../lib/themePresets";
import { resolveDesignTokens } from "../../lib/designTokens";
import { Step3PageGallery } from "./Step3PageGallery";
import type { StepProps } from "./stepProps";

// Step 3 — "Results". One workspace for everything about the result pages:
// a compact LAYOUT header (the old "page model" posture + theme quick-pick),
// then the result-page gallery + per-page recommendation logic + discount
// (Step3PageGallery). Runs AFTER Questions (Step 2) so a result page's
// conditional "if answer → products" rules can reference real answers.
export function Step3Results(props: StepProps) {
  const { doc, onCommit } = props;
  const mode = doc.result_layout_mode;

  const choose = (next: "shared" | "custom") => {
    let nextDoc = { ...doc, result_layout_mode: next };
    // Seed the shared template layer on first "shared" pick so the cascade has
    // something to apply.
    if (next === "shared" && !doc.design_overrides[SHARED_RESULT_KEY]) {
      nextDoc = {
        ...nextDoc,
        design_overrides: { ...nextDoc.design_overrides, [SHARED_RESULT_KEY]: doc.design_tokens ?? {} },
      };
    }
    onCommit(nextDoc);
  };
  const applyTheme = (presetId: string) => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      onCommit({ ...doc, design_tokens: resolveDesignTokens(preset.tokens) as typeof doc.design_tokens });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="qz-card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="qz-row" style={{ gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <div className="qz-label" style={{ marginBottom: 6 }}>
              Layout
            </div>
            <div className="qz-row" style={{ gap: 8 }}>
              {(["shared", "custom"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => choose(m)}
                  className={`qz-btn qz-btn-sm${mode === m ? " qz-btn-primary" : " qz-btn-ghost"}`}
                >
                  {m === "shared" ? "One shared template" : "Custom per page"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="qz-label" style={{ marginBottom: 6 }}>
              Theme
            </div>
            <div className="qz-row" style={{ gap: 6, flexWrap: "wrap" }}>
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
          </div>
        </div>
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          <strong>Shared</strong> = every result page looks identical and just swaps its products;{" "}
          <strong>Custom</strong> = each page is independently editable. The theme sets base colors +
          type — fine-tune per step under Questions.
        </p>
      </div>

      <Step3PageGallery {...props} />
    </div>
  );
}
