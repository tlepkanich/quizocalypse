import type { stylesFor } from "../runtimeStyles";

// "Why this product" benefit bullets (Dev Spec §5) — baked at publish, rendered
// under the result headline. Shared by the single + multi-stage result views.
export function WhyBullets({
  bullets,
  styles,
}: {
  bullets?: string[];
  styles: ReturnType<typeof stylesFor>;
}) {
  if (!bullets || bullets.length === 0) return null;
  return (
    <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
      {bullets.map((b, i) => (
        <li key={i} style={{ ...styles.muted, fontSize: 14, lineHeight: 1.45 }}>
          {b}
        </li>
      ))}
    </ul>
  );
}
