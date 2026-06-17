import { useState } from "react";
import type { Quiz } from "../../lib/quizSchema";
import { ReskinSwitcher } from "../builder/preview/ReskinSwitcher";
import { getPreset } from "../../lib/themePresets";
import { resolveDesignTokens } from "../../lib/designTokens";
import {
  LAYOUT_VARIANTS,
  applyLayoutVariant,
  detectLayoutVariant,
} from "../../lib/layoutVariants";

// QB-4 — the Theme tool's left panel (standalone builder). Matches Quizell's
// gallery: Create Custom Theme / Your Website Theme affordances · My Themes ‖
// Templates tabs · theme cards with live Q/A swatches · layout variants. Applies
// a preset immediately (the top-bar undo reverts it — no separate try-on state
// to thread into the canvas).

type QuizDoc = Quiz;

export function BuilderThemePanel({
  doc,
  commit,
}: {
  doc: QuizDoc;
  commit: (doc: QuizDoc) => void;
}) {
  const [tab, setTab] = useState<"templates" | "mine">("templates");
  const [note, setNote] = useState<string | null>(null);

  const applyTheme = (presetId: string) => {
    const preset = getPreset(presetId);
    if (!preset) return;
    commit({ ...doc, design_tokens: resolveDesignTokens(preset.tokens) as QuizDoc["design_tokens"] });
  };
  const currentLayout = detectLayoutVariant(doc);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button
        type="button"
        className="qz-btn qz-btn-ghost qz-btn-sm"
        style={{ justifyContent: "center" }}
        onClick={() =>
          setNote(
            note === "custom"
              ? null
              : "custom",
          )
        }
      >
        ⊕ Create Custom Theme
      </button>
      <button
        type="button"
        className="qz-btn qz-btn-ghost qz-btn-sm"
        style={{ justifyContent: "center" }}
        onClick={() => setNote(note === "website" ? null : "website")}
      >
        ⊡ Your Website Theme
      </button>
      {note ? (
        <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
          {note === "custom"
            ? "Fine-tune colours, fonts, and per-step CSS in the Code tool. A full custom-theme editor is coming soon."
            : "Auto-importing your storefront's colours and fonts is coming soon — pick a starting theme below for now."}
        </p>
      ) : null}

      <div className="qz-segmented" role="group" aria-label="Theme source">
        <button type="button" aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
          My Themes
        </button>
        <button type="button" aria-pressed={tab === "templates"} onClick={() => setTab("templates")}>
          Templates
        </button>
      </div>

      {tab === "templates" ? (
        <ReskinSwitcher value={null} onSelect={applyTheme} />
      ) : (
        <p className="qz-dim" style={{ fontSize: 12.5, margin: "4px 0" }}>
          Your saved custom themes will appear here. Apply a template, then refine it in the Code
          tool to make it your own.
        </p>
      )}

      <div style={{ borderTop: "1px solid var(--qz-rule)", paddingTop: 12 }}>
        <strong style={{ fontSize: 13 }}>Layout</strong>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {LAYOUT_VARIANTS.map((v) => {
            const active = currentLayout === v.id;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={active}
                title={v.description}
                onClick={() => commit(applyLayoutVariant(doc, v.id))}
                style={{
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "var(--qz-radius)",
                  border: active ? "2px solid var(--qz-accent)" : "1px solid var(--qz-rule)",
                  background: active ? "var(--qz-accent-tint)" : "var(--qz-paper)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name}</div>
                <div className="qz-dim" style={{ fontSize: 11, marginTop: 2 }}>
                  {v.description}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
