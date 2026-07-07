// ════════════════════════════════════════════════════════════════════════════
// NumericControl (QZY-8, build-tab spec §2) — the inspector's numeric
// primitive: a LINKED range + number pair (scrub the slider to eyeball, type
// the exact number for precision; editing either updates the other and the
// canvas live). Supports blank-to-unset (`allowEmpty`) so optional style
// overrides can fall back to the template default.
// ════════════════════════════════════════════════════════════════════════════

export function NumericControl({
  label,
  value,
  min,
  max,
  step = 1,
  fallback,
  allowEmpty = false,
  suffix,
  onChange,
}: {
  label: string;
  /** undefined = unset (inherits the template/default). */
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  /** What the slider shows while unset. */
  fallback?: number;
  allowEmpty?: boolean;
  suffix?: string;
  onChange: (next: number | undefined) => void;
}) {
  const shown = value ?? fallback ?? min;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="qz-numctl">
      <span className="qz-numctl-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        aria-label={`${label} (slider)`}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <span className="qz-numctl-exact">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value === undefined ? "" : String(value)}
          placeholder={fallback !== undefined ? String(fallback) : ""}
          aria-label={`${label} (exact)`}
          onChange={(e) => {
            const t = e.target.value.trim();
            if (t === "") {
              if (allowEmpty) onChange(undefined);
              return;
            }
            const n = Number(t);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
        />
        {suffix ? <span className="qz-numctl-suffix">{suffix}</span> : null}
      </span>
    </div>
  );
}
