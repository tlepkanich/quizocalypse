import { useState } from "react";

// Emoji icon picker for answers (editor revamp P3). A curated commerce-leaning
// grid + a free-text field for any emoji. Inline-expanding (the InspectorPanel
// renders it under the answer row), so no popover/z-index plumbing.

const CURATED = [
  "✨", "🔥", "💧", "🌿", "☀️", "🌙", "❄️", "🌈",
  "💪", "🧘", "🏃", "🛌", "🎯", "🎁", "💎", "👑",
  "🧴", "🧼", "💄", "🪮", "👟", "🥾", "🎒", "🧢",
  "🏔️", "🏖️", "🏠", "🛠️", "☕", "🍫", "🐶", "🐱",
  "💼", "✈️", "🚲", "📱", "💻", "🎧", "📚", "🕯️",
];

export function EmojiIconPicker({
  value,
  onPick,
}: {
  value?: string;
  onPick: (icon: string | undefined) => void;
}) {
  const [custom, setCustom] = useState("");
  return (
    <div
      style={{
        border: "1px solid #00000018",
        borderRadius: 8,
        padding: 8,
        background: "#fafafa",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
        {CURATED.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`Use ${e}`}
            style={{
              border: value === e ? "2px solid var(--qz-accent, #2a6df4)" : "1px solid transparent",
              background: value === e ? "#fff" : "none",
              borderRadius: 6,
              fontSize: 17,
              lineHeight: "26px",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="qz-row" style={{ gap: 6 }}>
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="…or type any emoji"
          maxLength={16}
          style={{
            flex: 1,
            font: "inherit",
            fontSize: 12.5,
            padding: "5px 8px",
            borderRadius: 6,
            border: "1px solid #00000022",
          }}
        />
        <button
          type="button"
          className="qz-btn qz-btn-ghost qz-btn-sm"
          disabled={!custom.trim()}
          onClick={() => onPick(custom.trim())}
        >
          Use
        </button>
        {value ? (
          <button
            type="button"
            className="qz-btn qz-btn-ghost qz-btn-sm"
            onClick={() => onPick(undefined)}
          >
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}
