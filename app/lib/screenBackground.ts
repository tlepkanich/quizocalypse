import type { CSSProperties } from "react";
import type { Quiz } from "./quizSchema";

// ════════════════════════════════════════════════════════════════════════════
// QZY-11 (build-tab §8) — pure resolution for per-screen backgrounds. The
// runtime page wrapper, the builder preview, and the Background tab all read
// through these so the config means one thing everywhere.
// ════════════════════════════════════════════════════════════════════════════

export type ScreenBackground = NonNullable<Quiz["node_backgrounds"]>[string];

/** Static CSS for color / gradient / image backgrounds (video renders as a
 *  layer element, not CSS). */
export function screenBackgroundCss(bg: ScreenBackground): CSSProperties {
  const out: CSSProperties = {};
  const focal = `${bg.focal_x ?? 50}% ${bg.focal_y ?? 50}%`;
  switch (bg.type) {
    case "color":
      if (bg.color) out.background = bg.color;
      break;
    case "gradient": {
      // R6-1 §4 — up to 3 stops, linear or radial. Absent extras → today's
      // 2-stop linear exactly (byte-identical).
      const stops = [bg.color, bg.color2, bg.color3].filter((c): c is string => Boolean(c));
      if (stops.length >= 2)
        out.background =
          bg.gradient_type === "radial"
            ? `radial-gradient(circle, ${stops.join(", ")})`
            : `linear-gradient(${bg.angle ?? 135}deg, ${stops.join(", ")})`;
      else if (bg.color) out.background = bg.color;
      break;
    }
    case "image":
      if (bg.image_url) {
        out.backgroundImage = `url("${bg.image_url}")`;
        out.backgroundPosition = focal;
        if (bg.fit === "tile") {
          out.backgroundRepeat = "repeat";
          out.backgroundSize = "auto";
        } else {
          out.backgroundRepeat = "no-repeat";
          // R6-2 §4 — zoom overrides cover/contain; absent → today's exact fit.
          out.backgroundSize = bg.zoom
            ? `${bg.zoom}% auto`
            : bg.fit === "contain"
              ? "contain"
              : "cover";
        }
        if (bg.fixed) out.backgroundAttachment = "fixed";
      }
      break;
    case "split": {
      // build-tab §6 — two regions with a hard or soft edge. Hard = both
      // stops at the position (linear-gradient(dir, A pos%, B pos%)); soft
      // spreads the stops ±softness/2.
      const a = bg.color ?? "#FFFFFF";
      const b = bg.color2 ?? "#111111";
      const pos = bg.split_pos ?? 50;
      const soft = bg.split_soft ?? 0;
      const dir =
        bg.split_dir === "vertical"
          ? "to bottom"
          : bg.split_dir === "diagonal"
            ? "135deg"
            : "to right";
      const lo = Math.max(0, pos - soft / 2);
      const hi = Math.min(100, pos + soft / 2);
      out.background = `linear-gradient(${dir}, ${a} ${lo}%, ${b} ${hi}%)`;
      break;
    }
    case "quadrant": {
      // build-tab §6 — four corner fills as a FOUR-LAYER background (each
      // corner a sized no-repeat layer), so the split can be off-center and a
      // corner value may itself be a css gradient string.
      const x = bg.split_x ?? 50;
      const y = bg.split_y ?? 50;
      const tl = bg.color ?? "#FFFFFF";
      const tr = bg.color2 ?? tl;
      const bl = bg.color3 ?? tl;
      const br = bg.color4 ?? tl;
      const layer = (v: string) => (v.includes("gradient(") ? v : `linear-gradient(${v}, ${v})`);
      out.backgroundImage = [layer(tl), layer(tr), layer(bl), layer(br)].join(", ");
      out.backgroundRepeat = "no-repeat";
      out.backgroundPosition = "left top, right top, left bottom, right bottom";
      out.backgroundSize = `${x}% ${y}%, ${100 - x}% ${y}%, ${x}% ${100 - y}%, ${100 - x}% ${100 - y}%`;
      break;
    }
    case "partial": {
      // R6-1 §4 — the image fills a band on one edge at coverage %; the rest is
      // fill_color.
      if (bg.fill_color) out.backgroundColor = bg.fill_color;
      if (bg.image_url) {
        const cov = bg.coverage ?? 50;
        const band = bg.band ?? "left";
        out.backgroundImage = `url("${bg.image_url}")`;
        out.backgroundRepeat = "no-repeat";
        if (band === "top") {
          out.backgroundSize = `100% ${cov}%`;
          out.backgroundPosition = "top";
        } else {
          out.backgroundSize = `${cov}% 100%`;
          out.backgroundPosition = band === "right" ? "right" : "left";
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** The darkening overlay alpha (0–0.8); 0 = no overlay layer at all. */
export function screenOverlayAlpha(bg: ScreenBackground): number {
  return (bg.overlay ?? 0) / 100;
}

/** R6-2 §4 — the overlay layer's background. Absent overlay_color → the current
 *  black overlay exactly (byte-identical); set → a tint at the same alpha. */
export function screenOverlayBg(bg: ScreenBackground): string {
  const alpha = screenOverlayAlpha(bg);
  if (!bg.overlay_color) return `rgba(0,0,0,${alpha})`;
  return `color-mix(in srgb, ${bg.overlay_color} ${Math.round(alpha * 100)}%, transparent)`;
}

/** §8.2 — video layer facts: always muted; mobile falls back to the poster
 *  unless explicitly set to play. */
export function videoLayer(bg: ScreenBackground): {
  url: string;
  poster: string | undefined;
  mobilePlays: boolean;
} | null {
  if (bg.type !== "video" || !bg.video_url) return null;
  return {
    url: bg.video_url,
    poster: bg.poster_url,
    mobilePlays: bg.mobile_video === "play",
  };
}

/** §8 readability guard — non-blocking: an image/video background with a
 *  light overlay likely fights the foreground text. */
export function readabilityHint(bg: ScreenBackground): string | null {
  if (
    (bg.type === "image" && bg.image_url) ||
    (bg.type === "video" && bg.video_url) ||
    (bg.type === "partial" && bg.image_url)
  ) {
    if ((bg.overlay ?? 0) < 20)
      return "Text may be hard to read over this background — consider raising the overlay.";
  }
  return null;
}

// ── R3 (build-tab v2.0 §5.3/§9) — master / per-screen override model ─────────
// The quiz-wide default (Design) is the master; a `node_backgrounds` entry is a
// per-screen override that WINS. These pure helpers back the scope control, the
// carousel Custom badge, and the override-respecting apply-all.

/** Screen node ids carrying a per-screen background override (a non-empty
 *  node_backgrounds entry) — the "Custom" screens apply-all must respect. */
export function screensWithBackgroundOverride(
  doc: Pick<Quiz, "node_backgrounds">,
): string[] {
  const map = doc.node_backgrounds ?? {};
  return Object.keys(map).filter((id) => Object.keys(map[id] ?? {}).length > 0);
}

/** True when this screen carries its own background override (drives the
 *  carousel Custom badge + the This-screen scope indicator). */
export function hasBackgroundOverride(
  doc: Pick<Quiz, "node_backgrounds">,
  nodeId: string,
): boolean {
  const bg = doc.node_backgrounds?.[nodeId];
  return !!bg && Object.keys(bg).length > 0;
}

/** §9 apply-all that RESPECTS overrides. Every screen WITHOUT its own
 *  background gets `bg`; screens that already customized theirs are KEPT
 *  (skipped), never silently stomped. `includeCustomized` is the explicit
 *  escape hatch that overwrites them too. Returns the new doc + the count of
 *  customized screens kept (the number the UI must surface). Pure. */
export function applyBackgroundToAll(
  doc: Quiz,
  bg: ScreenBackground,
  opts: { sourceNodeId: string; includeCustomized: boolean },
): { doc: Quiz; skipped: number } {
  const existing = doc.node_backgrounds ?? {};
  // "Customized" = a screen OTHER than the source with its own override.
  const customized = new Set(
    screensWithBackgroundOverride(doc).filter((id) => id !== opts.sourceNodeId),
  );
  const map: NonNullable<Quiz["node_backgrounds"]> = {};
  let skipped = 0;
  for (const n of doc.nodes) {
    if (!opts.includeCustomized && customized.has(n.id)) {
      const own = existing[n.id];
      if (own) map[n.id] = own; // keep the screen's own background
      skipped++;
      continue;
    }
    map[n.id] = { ...bg };
  }
  return { doc: { ...doc, node_backgrounds: map }, skipped };
}
