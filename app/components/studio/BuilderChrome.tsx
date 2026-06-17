import type { ReactNode } from "react";
import type { OrderedStep } from "../../lib/flowOrder";
import { NODE_LABEL } from "./panels/nodeMeta";
import { ThemeToggle } from "./ThemeToggle";

// QD-6 — Quizell-style builder chrome for the STANDALONE surface: a left
// icon-rail (Editor / AI / Theme / Settings / Code) + a bottom step filmstrip.
// Pure presentational; the parent (UnifiedWorkspace) owns the view/selection
// state and maps the rail onto its existing build/logic views.

const RAIL_ICON: Record<string, ReactNode> = {
  editor: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>,
  ai: <path d="M12 3l1.7 4.5L18 9l-4.3 1.5L12 15l-1.7-4.5L6 9l4.3-1.5L12 3Z" />,
  theme: <><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><circle cx="6.5" cy="12.5" r="1" /><path d="M12 3a9 9 0 1 0 0 18 1.6 1.6 0 0 0 1.6-1.6c0-.4-.2-.8-.4-1.1-.2-.3-.4-.6-.4-1a1.6 1.6 0 0 1 1.6-1.6H16a5 5 0 0 0 5-5c0-4.4-4-7.7-9-7.7Z" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.2A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" /></>,
  code: <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />,
};

const RAIL: Array<{ key: string; label: string }> = [
  { key: "editor", label: "Editor" },
  { key: "ai", label: "AI" },
  { key: "theme", label: "Theme" },
  { key: "settings", label: "Settings" },
  { key: "code", label: "Code" },
];

export function BuilderRail({ active, onSelect }: { active: string; onSelect: (key: string) => void }) {
  return (
    <nav className="qz-builder-rail" aria-label="Builder tools">
      {RAIL.map((r) => (
        <button
          key={r.key}
          type="button"
          className={`qz-builder-rail-item${active === r.key ? " is-active" : ""}`}
          aria-current={active === r.key ? "page" : undefined}
          onClick={() => onSelect(r.key)}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {RAIL_ICON[r.key]}
          </svg>
          <span>{r.label}</span>
        </button>
      ))}
      {/* QB-1 — the full-screen builder has no app sidebar, so the dark-mode
          toggle lives at the foot of the rail (matches Quizell's 🌙). */}
      <div className="qz-builder-rail-spacer" />
      <ThemeToggle />
    </nav>
  );
}

export function BuilderFilmstrip({
  steps,
  selectedId,
  onSelect,
}: {
  steps: OrderedStep[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <div className="qz-builder-filmstrip" aria-label="Quiz steps">
      {steps.map((s, i) => (
        <button
          key={s.nodeId}
          type="button"
          className={`qz-film-card${selectedId === s.nodeId ? " is-active" : ""}`}
          onClick={() => onSelect(s.nodeId)}
          title={NODE_LABEL[s.type] ?? s.type}
        >
          <span className="qz-film-num">{i + 1}</span>
          <span className="qz-film-label">{NODE_LABEL[s.type] ?? s.type}</span>
        </button>
      ))}
    </div>
  );
}
