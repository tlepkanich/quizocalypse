import { THEME_PRESETS } from "../../../lib/themePresets";
import { googleFontsUrl } from "../../runtime/runtimeStyles";

// A gallery of theme mini-previews. Each card renders a faithful thumbnail of the
// theme — its background, heading font + text color, a faux question line, and a
// button chip honoring the theme's primary color, corner radius, and button
// style. Clicking one "tries it on" (the parent applies the preset's tokens live
// to the running preview, no save); a separate Apply in the toolbar persists it.
// `value` is the currently tried-on preset id (or null = the quiz's saved theme).

const ALL_FONTS = Array.from(
  new Set(
    THEME_PRESETS.flatMap((p) => [
      p.tokens.typography?.heading?.family,
      p.tokens.typography?.body?.family,
    ]).filter((f): f is string => Boolean(f)),
  ),
);

function radiusPx(r: string | undefined): number {
  return r === "square" ? 2 : r === "pill" ? 999 : 8;
}

export function ReskinSwitcher({
  value,
  onSelect,
}: {
  value: string | null;
  onSelect: (presetId: string) => void;
}) {
  const fontUrl = googleFontsUrl(ALL_FONTS);
  return (
    <>
      {fontUrl && <link rel="stylesheet" href={fontUrl} />}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
          gap: 10,
        }}
      >
        {THEME_PRESETS.map((p) => {
          const c = p.tokens.colors ?? {};
          const active = value === p.id;
          const headingFont = p.tokens.typography?.heading?.family ?? "inherit";
          const r = radiusPx(p.tokens.radius);
          const outline = p.tokens.button_style === "outline";
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              title={p.description}
              onClick={() => onSelect(p.id)}
              style={{
                padding: 0,
                cursor: "pointer",
                background: "transparent",
                textAlign: "left",
                border: active
                  ? "2px solid var(--qz-accent, #e8623c)"
                  : "1px solid var(--qz-rule, #e5e5e5)",
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: active ? "var(--qz-shadow-focus)" : undefined,
                transition: "border-color 120ms",
              }}
            >
              {/* Theme canvas — a faithful mini-render of the quiz surface. */}
              <div
                style={{
                  background: c.background ?? "#fff",
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minHeight: 92,
                }}
              >
                <div
                  style={{
                    fontFamily: headingFont,
                    color: c.text ?? "#111",
                    fontWeight: 700,
                    fontSize: 17,
                    lineHeight: 1,
                  }}
                >
                  Aa
                </div>
                <div
                  style={{
                    height: 6,
                    width: "70%",
                    borderRadius: 3,
                    background: c.muted ?? "#999",
                    opacity: 0.5,
                  }}
                />
                <div style={{ marginTop: "auto", display: "inline-flex" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "4px 12px",
                      borderRadius: r,
                      ...(outline
                        ? {
                            color: c.primary ?? "#111",
                            border: `1.5px solid ${c.primary ?? "#111"}`,
                            background: "transparent",
                          }
                        : { color: c.background ?? "#fff", background: c.primary ?? "#111" }),
                    }}
                  >
                    Shop
                  </span>
                </div>
              </div>
              {/* Label strip */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  padding: "6px 10px",
                  background: "var(--qz-surface, #fff)",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span>{p.name}</span>
                {active ? <span style={{ color: "var(--qz-accent, #e8623c)" }}>✓</span> : null}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
