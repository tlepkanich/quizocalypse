import { useEffect, useRef, useState } from "react";

// ════════════════════════════════════════════════════════════════════════════
// ScrubNumber — the specs' "scrub + exact on numerics" primitive (QZY-5;
// QZY-8 adopts it inspector-wide). Drag the value horizontally to scrub
// (~6px per step, pointer-captured); a plain click flips to a numeric input
// for the exact value. Arrow keys nudge; Enter opens exact entry.
// ════════════════════════════════════════════════════════════════════════════

export function ScrubNumber({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const drag = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const clamp = (n: number) =>
    Math.min(max, Math.max(min, Math.round(n / step) * step));

  const commitDraft = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) onChange(clamp(n));
    setEditing(false);
  };

  return (
    <div className="qz-scrub">
      <span className="qz-scrub-label">{label}</span>
      {editing ? (
        <span className="qz-scrub-exact">
          <input
            ref={inputRef}
            className="qz-scrub-input"
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            aria-label={label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitDraft();
              else if (e.key === "Escape") setEditing(false);
            }}
          />
          {suffix ? <span className="qz-scrub-suffix">{suffix}</span> : null}
        </span>
      ) : (
        <span
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          className="qz-scrub-value"
          title="Drag to adjust · click to type the exact value"
          onPointerDown={(e) => {
            drag.current = { startX: e.clientX, startValue: value, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const dx = e.clientX - drag.current.startX;
            if (Math.abs(dx) > 2) drag.current.moved = true;
            if (drag.current.moved) {
              const next = clamp(drag.current.startValue + Math.round(dx / 6) * step);
              if (next !== value) onChange(next);
            }
          }}
          onPointerUp={(e) => {
            const wasDrag = drag.current?.moved;
            drag.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (!wasDrag) {
              setDraft(String(value));
              setEditing(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowRight") {
              e.preventDefault();
              onChange(clamp(value + step));
            } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
              e.preventDefault();
              onChange(clamp(value - step));
            } else if (e.key === "Enter") {
              setDraft(String(value));
              setEditing(true);
            }
          }}
        >
          {value}
          {suffix ?? ""}
        </span>
      )}
    </div>
  );
}
