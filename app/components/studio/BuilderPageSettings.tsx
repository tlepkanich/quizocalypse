import type { Quiz } from "../../lib/quizSchema";

// QP-2 — Quizell's "Page Settings" panel for the standalone Editor → Settings
// sub-tab: a Background Color swatch+hex and a Page Paddings cross-layout. Both
// edit the quiz-level design_tokens (so they apply to every page), committed
// through the workspace's autosave/undo seam. Page padding is wired to the
// runtime via --qz-page-pad (designTokens.ts / runtimeStyles.ts).

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];
const PAD_DEFAULT: Record<Side, number> = { top: 24, right: 24, bottom: 24, left: 24 };
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const clampPad = (n: number) => Math.max(0, Math.min(240, Math.round(n) || 0));

function PadInput({
  side,
  value,
  onChange,
  className,
}: {
  side: Side;
  value: number;
  onChange: (side: Side, value: number) => void;
  className: string;
}) {
  return (
    <input
      className={`qz-ps-pad-input ${className}`}
      type="number"
      min={0}
      max={240}
      value={value}
      aria-label={`${side} padding (px)`}
      onChange={(e) => onChange(side, clampPad(Number(e.target.value)))}
    />
  );
}

export function BuilderPageSettings({
  doc,
  commit,
}: {
  doc: Quiz;
  commit: (doc: Quiz) => void;
}) {
  const dt = doc.design_tokens ?? {};
  const bg = dt.colors?.background ?? "#FFFFFF";
  const swatch = HEX_RE.test(bg) ? bg : "#FFFFFF";
  const pad = dt.page_padding ?? PAD_DEFAULT;

  const setBg = (hex: string) =>
    commit({ ...doc, design_tokens: { ...dt, colors: { ...(dt.colors ?? {}), background: hex } } });
  const setPad = (side: Side, value: number) =>
    commit({ ...doc, design_tokens: { ...dt, page_padding: { ...PAD_DEFAULT, ...pad, [side]: value } } });

  return (
    <div className="qz-card qz-page-settings">
      <div className="qz-ps-title">Page Settings</div>

      <div className="qz-ps-field">
        <label className="qz-ps-label" htmlFor="qz-ps-bg">
          Background Color
        </label>
        <div className="qz-ps-color">
          <input
            type="color"
            aria-label="Background color swatch"
            value={swatch}
            onChange={(e) => setBg(e.target.value)}
          />
          <input
            id="qz-ps-bg"
            type="text"
            spellCheck={false}
            value={bg}
            onChange={(e) => setBg(e.target.value)}
          />
        </div>
      </div>

      <div className="qz-ps-field">
        <div className="qz-ps-label-row">
          <span className="qz-ps-label">Page Paddings</span>
          <span className="qz-ps-note">Applies to every page</span>
        </div>
        <div className="qz-ps-pad">
          <PadInput side="top" value={pad.top} onChange={setPad} className="qz-ps-pad-top" />
          <PadInput side="left" value={pad.left} onChange={setPad} className="qz-ps-pad-left" />
          <div className="qz-ps-pad-mid" aria-hidden="true" />
          <PadInput side="right" value={pad.right} onChange={setPad} className="qz-ps-pad-right" />
          <PadInput side="bottom" value={pad.bottom} onChange={setPad} className="qz-ps-pad-bottom" />
        </div>
      </div>
    </div>
  );
}
