import type { CSSProperties } from "react";
import {
  VIBE_TEMPLATES,
  isModifiedFromTemplate,
  type VibeTemplate,
} from "../../lib/vibeTemplates";
import type { DesignTokens } from "../../lib/quizSchema";

// Design Settings spec §2 — the 4 vibe-template cards. Each card is a token-driven
// mini-preview (bg · heading · button chip) + name/vibe + selected + a "Modified"
// indicator (set tokens diverge from the template baseline, §3). Reusable in the
// funnel Design step and the builder. Applying a card writes the template's full
// token set (incl. template_id) via the caller's onApply.

const RADIUS_PX: Record<string, number> = { square: 0, rounded: 10, pill: 999 };

const modBadge: CSSProperties = {
  fontSize: 10,
  padding: "1px 7px",
  borderRadius: 999,
  background: "var(--qz-cream-2)",
  border: "1px solid var(--qz-rule)",
  color: "var(--qz-ink-2)",
};

function VibeThumbnail({ t }: { t: VibeTemplate }) {
  const c = t.tokens.colors ?? {};
  const r = RADIUS_PX[t.tokens.radius ?? "rounded"] ?? 10;
  const btn = t.tokens.button_style ?? "filled";
  const headingFamily = t.tokens.typography?.heading?.family;
  return (
    <div
      aria-hidden
      style={{
        background: c.background ?? "#fff",
        borderRadius: 8,
        padding: "12px 12px 14px",
        border: "1px solid var(--qz-rule)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          fontFamily: headingFamily ? `'${headingFamily}', Georgia, serif` : undefined,
          color: c.text ?? "#111",
          fontSize: 16,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        Aa
      </div>
      <div
        style={{
          height: 6,
          width: "72%",
          background: c.muted ?? "#cccccc",
          opacity: 0.45,
          borderRadius: 3,
          margin: "9px 0",
        }}
      />
      <span
        style={{
          display: "inline-block",
          fontSize: 10,
          padding: "3px 11px",
          borderRadius: Math.min(r, 14),
          background: btn === "filled" ? c.accent ?? c.primary ?? "#111111" : "transparent",
          color: btn === "filled" ? "#ffffff" : c.text ?? "#111111",
          border: btn === "filled" ? "none" : `1px solid ${c.text ?? "#111111"}`,
        }}
      >
        Start
      </span>
    </div>
  );
}

export function VibeTemplateSelector({
  currentTokens,
  onApply,
  busy,
}: {
  currentTokens: DesignTokens | undefined;
  onApply: (template: VibeTemplate) => void;
  busy?: boolean;
}) {
  const selectedId = currentTokens?.template_id;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        gap: 12,
      }}
    >
      {VIBE_TEMPLATES.map((t) => {
        const selected = selectedId === t.id;
        const modified = selected && isModifiedFromTemplate(currentTokens, t);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onApply(t)}
            disabled={busy}
            aria-pressed={selected}
            className="qz-card qz-interactive"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 12,
              cursor: "pointer",
              textAlign: "left",
              outline: selected ? "2px solid var(--qz-accent)" : "none",
              outlineOffset: 2,
            }}
          >
            <VibeThumbnail t={t} />
            <div className="qz-row qz-row-between" style={{ alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</span>
              {selected ? (
                modified ? (
                  <span style={modBadge}>Modified</span>
                ) : (
                  <span style={{ fontSize: 11, color: "var(--qz-accent)", whiteSpace: "nowrap" }}>
                    ✓ Selected
                  </span>
                )
              ) : null}
            </div>
            <span className="qz-dim" style={{ fontSize: 11.5, lineHeight: 1.35 }}>
              {t.description}
            </span>
            <span className="qz-dim" style={{ fontSize: 10.5, opacity: 0.75 }}>
              {t.exampleFeel}
            </span>
          </button>
        );
      })}
    </div>
  );
}
