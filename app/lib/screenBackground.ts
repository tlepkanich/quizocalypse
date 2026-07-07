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
    case "gradient":
      if (bg.color && bg.color2)
        out.background = `linear-gradient(${bg.angle ?? 135}deg, ${bg.color}, ${bg.color2})`;
      else if (bg.color) out.background = bg.color;
      break;
    case "image":
      if (bg.image_url) {
        out.backgroundImage = `url("${bg.image_url}")`;
        out.backgroundPosition = focal;
        if (bg.fit === "tile") {
          out.backgroundRepeat = "repeat";
          out.backgroundSize = "auto";
        } else {
          out.backgroundRepeat = "no-repeat";
          out.backgroundSize = bg.fit === "contain" ? "contain" : "cover";
        }
        if (bg.fixed) out.backgroundAttachment = "fixed";
      }
      break;
    default:
      break;
  }
  return out;
}

/** The darkening overlay alpha (0–0.8); 0 = no overlay layer at all. */
export function screenOverlayAlpha(bg: ScreenBackground): number {
  return (bg.overlay ?? 0) / 100;
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
  if ((bg.type === "image" && bg.image_url) || (bg.type === "video" && bg.video_url)) {
    if ((bg.overlay ?? 0) < 20)
      return "Text may be hard to read over this background — consider raising the overlay.";
  }
  return null;
}
