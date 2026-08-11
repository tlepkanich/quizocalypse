import type { ReactNode } from "react";
import { Fragment } from "react";
import { Wordmark } from "../chrome/Wordmark";

// ════════════════════════════════════════════════════════════════════════════
// BLD-3 — the standalone builder's chrome, a structural port of
// docs/design/build-tab/build-tab.html. ONE navigation rail (the mock's
// .rail): Build, a "Set up" divider, then Products · Logic · Theme ·
// Settings — with the mock's exact icon set (its <symbol> paths, 19px,
// stroke 1.8). Pure presentational — UnifiedWorkspace owns the view/tool
// state. The top bar moved into UnifiedWorkspace itself (the mock's .top is
// a single ordered row, not a 3-zone primitive).
// ════════════════════════════════════════════════════════════════════════════

export type BuilderNavKey =
  | "build"
  | "products"
  | "logic"
  | "design"
  | "settings";

/** The mock's SVG symbol paths (build-tab.html <symbol> defs), 24px viewBox. */
function RailIcon({ d }: { d: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

// mock #i-build / #i-tag / #i-logic / #i-palette / #i-gear
export const MOCK_ICONS: Record<BuilderNavKey, ReactNode> = {
  build: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  products: (
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7a2 2 0 01-.6-1.4V5a2 2 0 012-2h6.8a2 2 0 011.4.6l7 7a2 2 0 010 2.8z" />
  ),
  logic: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M8.2 7.3l7.6 3.6M8.2 16.7l7.6-3.6" />
    </>
  ),
  design: (
    <path d="M12 3a9 9 0 000 18c1 0 1.7-.8 1.7-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H16a5 5 0 005-5c0-3.9-4-7-9-7z" />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.9 7.9 0 000-2l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L15 3.5h-4l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4L6.6 11a7.9 7.9 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1L11 20.5h4l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4z" />
    </>
  ),
};

const NAV: Array<{ key: BuilderNavKey; label: string; ruleAbove?: boolean }> = [
  { key: "build", label: "Build" },
  { key: "products", label: "Products", ruleAbove: true },
  { key: "logic", label: "Logic" },
  { key: "design", label: "Theme" },
  { key: "settings", label: "Settings" },
];

export function BuilderNavRail({
  active,
  onSelect,
}: {
  active: BuilderNavKey;
  onSelect: (key: BuilderNavKey) => void;
}) {
  return (
    <nav className="qz-builder-rail" aria-label="Sections">
      {NAV.map((r) => (
        <Fragment key={r.key}>
          {r.ruleAbove ? (
            <span className="qz-builder-rail-label">Set up</span>
          ) : null}
          <button
            type="button"
            className={`qz-builder-rail-item${active === r.key ? " is-active" : ""}`}
            aria-current={active === r.key ? "page" : undefined}
            onClick={() => onSelect(r.key)}
          >
            <RailIcon d={MOCK_ICONS[r.key]} />
            <span>{r.label}</span>
          </button>
        </Fragment>
      ))}
      <div className="qz-builder-rail-spacer" />
      {/* Quartz: dark mode is CUT (owner, 2026-08-09) — theme toggle removed. */}
    </nav>
  );
}

/* BLD-3 — the mock's .top: ONE ordered flex row (brandmark · title · badges ·
   spacer · device/mode segs · dividers · undo/redo · actions). The host
   composes the row; this wrapper just provides the bar chrome + brandmark. */
export function BuilderTopBar({ children }: { children: ReactNode }) {
  return (
    <header className="qz-bt-top">
      <Wordmark to="/studio" compact />
      {children}
    </header>
  );
}
