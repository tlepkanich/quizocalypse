import { THEME_PRESETS } from "../../../lib/themePresets";

// A row of theme swatches. Clicking one "tries it on" (the parent applies the
// preset's tokens live to the running preview, no save); a separate Apply in
// the toolbar persists it. `value` is the currently tried-on preset id (or null
// = showing the quiz's saved theme).
export function ReskinSwitcher({
  value,
  onSelect,
}: {
  value: string | null;
  onSelect: (presetId: string) => void;
}) {
  return (
    <div className="qz-row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      {THEME_PRESETS.map((p) => {
        const colors = p.tokens.colors ?? {};
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            title={p.description}
            aria-pressed={active}
            onClick={() => onSelect(p.id)}
            className="qz-card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 10px 5px 6px",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 999,
              border: active
                ? "1.5px solid var(--qz-accent, #e8623c)"
                : "1px solid var(--qz-rule)",
              boxShadow: active ? "var(--qz-shadow-focus)" : undefined,
            }}
          >
            {/* two-tone swatch dot from the preset's bg + primary */}
            <span
              aria-hidden
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                flex: "0 0 auto",
                border: "1px solid var(--qz-rule)",
                background: `linear-gradient(135deg, ${colors.background ?? "#fff"} 0 50%, ${
                  colors.primary ?? "#888"
                } 50% 100%)`,
              }}
            />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
