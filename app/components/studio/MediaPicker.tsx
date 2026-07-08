import { useState } from "react";
import {
  isAllowedLogoType,
  isSafeLogoUrl,
  MAX_LOGO_BYTES,
  LOGO_ACCEPT,
} from "../../lib/logoUpload";
import type { PickerProduct } from "./ImagePicker";

// ════════════════════════════════════════════════════════════════════════════
// MediaPicker (QZY-R4, build-tab v2.0 §8) — the ONE shared media picker, used
// everywhere media is chosen (per-option icons/images, screen/option image
// backgrounds, and later reveal-on-interaction images). Source-agnostic to the
// caller via two callbacks:
//   • onGlyph  → Emoji + Icon-library sources (a text glyph stored in `icon`).
//   • onImage  → Upload (base64 data-URL) + URL + Products (an `image_url`).
// Upload reuses the logoUpload validators (type + 2 MB cap); per the owner's
// R4 call, uploaded IMAGES are base64 data-URLs (no external store) and VIDEO
// stays paste-a-URL, handled by the caller. There is no second uploader.
// ════════════════════════════════════════════════════════════════════════════

// Curated commerce-leaning emoji (the answer-icon set, kept in sync in spirit
// with EmojiIconPicker; MediaPicker is its unified successor).
const EMOJI = [
  "✨", "🔥", "💧", "🌿", "☀️", "🌙", "❄️", "🌈",
  "💪", "🧘", "🏃", "🛌", "🎯", "🎁", "💎", "👑",
  "🧴", "🧼", "💄", "🪮", "👟", "🥾", "🎒", "🧢",
  "🏔️", "🏖️", "🏠", "🛠️", "☕", "🍫", "🐶", "🐱",
  "💼", "✈️", "🚲", "📱", "💻", "🎧", "📚", "🕯️",
];

// A monochrome symbol library (renders via the same text path as emoji, so
// zero runtime change). Distinct from the emoji grid — clean line glyphs.
const SYMBOLS = [
  "★", "☆", "♥", "♡", "✓", "✔", "✕", "✚",
  "➤", "▲", "▼", "●", "○", "◆", "◇", "■",
  "□", "♦", "⚑", "⚐", "☀", "☾", "⚡", "✿",
  "❀", "❄", "✦", "✧", "♫", "✎", "⌂", "⚙",
];

type Tab = "emoji" | "icons" | "upload" | "url" | "products";

export function MediaPicker({
  glyph,
  image,
  onGlyph,
  onImage,
  onClear,
  products,
}: {
  /** Current glyph (emoji/symbol) value, if any. */
  glyph?: string | null;
  /** Current image (data-URL / https) value, if any. */
  image?: string | null;
  /** Provide to enable the Emoji + Icons sources (stores a text glyph). */
  onGlyph?: (value: string | undefined) => void;
  /** Provide to enable the Upload + URL + Products sources (stores an image). */
  onImage?: (value: string | undefined) => void;
  /** Clears both glyph and image. */
  onClear?: () => void;
  /** Optional product catalog for the "Your products" source. */
  products?: PickerProduct[];
}) {
  const tabs: Tab[] = [];
  if (onGlyph) tabs.push("emoji", "icons");
  if (onImage) {
    tabs.push("upload", "url");
    if (products && products.length > 0) tabs.push("products");
  }
  const [tab, setTab] = useState<Tab>(tabs[0] ?? "emoji");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const hasValue = Boolean(glyph || image);

  const onFile = (file: File | undefined) => {
    setErr(null);
    if (!file || !onImage) return;
    if (!isAllowedLogoType(file.type)) {
      setErr("Use a PNG, JPG, SVG, WebP or GIF.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setErr("Image is over 2 MB — pick a smaller file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      if (isSafeLogoUrl(result)) onImage(result);
      else setErr("Couldn't read that image.");
    };
    reader.onerror = () => setErr("Couldn't read that image.");
    reader.readAsDataURL(file);
  };

  const withImages = (products ?? []).filter(
    (p): p is PickerProduct & { image_url: string } => !!p.image_url,
  );
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? withImages.filter((p) => p.title.toLowerCase().includes(needle))
    : withImages;
  const urlOk = /^https:\/\/.+/.test(url.trim());

  const glyphGrid = (items: string[]) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
      {items.map((g) => (
        <button
          key={g}
          type="button"
          onClick={() => onGlyph?.(g)}
          aria-label={`Use ${g}`}
          aria-pressed={glyph === g}
          className="qz-media-glyph"
          style={{
            border: glyph === g ? "2px solid var(--qz-accent)" : "1px solid transparent",
            background: glyph === g ? "var(--qz-paper)" : "none",
            borderRadius: 6,
            fontSize: 17,
            lineHeight: "26px",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {g}
        </button>
      ))}
    </div>
  );

  return (
    <div
      style={{
        border: "1px solid var(--qz-rule)",
        borderRadius: 8,
        padding: 8,
        background: "var(--qz-cream-2)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {tabs.length > 1 ? (
        <div className="qz-segmented" role="group" aria-label="Media source">
          {tabs.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t === "emoji"
                ? "Emoji"
                : t === "icons"
                  ? "Icons"
                  : t === "upload"
                    ? "Upload"
                    : t === "url"
                      ? "URL"
                      : "Your products"}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "emoji" ? (
        <>
          {glyphGrid(EMOJI)}
          <input
            className="qz-input"
            placeholder="…or type any emoji"
            maxLength={16}
            style={{ fontSize: 12.5 }}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (v) onGlyph?.(v);
            }}
          />
        </>
      ) : null}

      {tab === "icons" ? glyphGrid(SYMBOLS) : null}

      {tab === "upload" ? (
        <>
          <input
            type="file"
            accept={LOGO_ACCEPT}
            aria-label="Upload an image"
            onChange={(e) => onFile(e.target.files?.[0])}
            style={{ fontSize: 12 }}
          />
          <p className="qz-dim" style={{ fontSize: 11, margin: 0 }}>
            Uploaded images embed in the quiz — keep them small (under a few hundred KB) so it stays
            fast. Max 2 MB.
          </p>
        </>
      ) : null}

      {tab === "url" ? (
        <div className="qz-row" style={{ gap: 6 }}>
          <input
            className="qz-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            style={{ flex: 1, fontSize: 12.5 }}
          />
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            disabled={!urlOk}
            onClick={() => onImage?.(url.trim())}
          >
            Use
          </button>
        </div>
      ) : null}

      {tab === "products" ? (
        withImages.length === 0 ? (
          <p className="qz-dim" style={{ fontSize: 12, margin: 0 }}>
            No product images synced yet — upload or paste a URL instead.
          </p>
        ) : (
          <>
            <input
              className="qz-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products…"
              style={{ fontSize: 12.5 }}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 6,
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {filtered.slice(0, 48).map((p) => (
                <button
                  key={p.product_id}
                  type="button"
                  title={p.title}
                  onClick={() => onImage?.(p.image_url)}
                  style={{
                    padding: 0,
                    border:
                      image === p.image_url
                        ? "2px solid var(--qz-accent)"
                        : "1px solid var(--qz-rule)",
                    borderRadius: 6,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "var(--qz-paper)",
                    aspectRatio: "1 / 1",
                  }}
                >
                  <img
                    src={p.image_url}
                    alt={p.title}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
            </div>
          </>
        )
      ) : null}

      {err ? (
        <p role="alert" style={{ fontSize: 11.5, margin: 0, color: "var(--qz-warn)" }}>
          {err}
        </p>
      ) : null}
      {hasValue && onClear ? (
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={onClear}
        >
          Remove
        </button>
      ) : null}
    </div>
  );
}
