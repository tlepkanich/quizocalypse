import type { ReactNode } from "react";
import { Fragment } from "react";
import {
  GitBranch,
  Package,
  Palette,
  Pencil,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Wordmark } from "../chrome/Wordmark";
import { ThemeToggle } from "./ThemeToggle";

// ════════════════════════════════════════════════════════════════════════════
// BLD-1 — the standalone builder's chrome, rebuilt on the Design-System-V2
// primitives (§7.6 top bar · §7.7 rail vocabulary). ONE navigation rail
// replaces the old two-system entanglement (a Build/Products/Results/Logic
// tab strip ABOVE an Editor/AI/Theme/Settings/Code tool rail, where clicking
// the "Logic" tab lit the "Settings" tool): the four workspace views and the
// three build-scoped tools are peers on a single rail, and the parent derives
// one `active` key so exactly one item ever lights. Pure presentational —
// UnifiedWorkspace owns the view/tool state. The QP-1 filmstrip is retired
// (owner decision, BLD-1): the rail's step list is the one step navigator,
// and the canvas gets its height back.
// ════════════════════════════════════════════════════════════════════════════

// QZY-6 (build-tab spec §1) — the five rail sections. Results left the rail
// (result screens edit in Build); AI became the top-bar "Assist" companion
// (never a destination tab); Code/placement/integrations/embed live in
// Settings. Design is still a build-scoped tool (the canvas stays visible).
export type BuilderNavKey =
  | "build"
  | "products"
  | "logic"
  | "design"
  | "settings";

const NAV: Array<{ key: BuilderNavKey; label: string; icon: LucideIcon; ruleAbove?: boolean }> = [
  { key: "build", label: "Build", icon: Pencil },
  { key: "products", label: "Products", icon: Package },
  { key: "logic", label: "Logic", icon: GitBranch },
  { key: "design", label: "Design", icon: Palette, ruleAbove: true },
  { key: "settings", label: "Settings", icon: Settings },
];

export function BuilderNavRail({
  active,
  onSelect,
}: {
  active: BuilderNavKey;
  onSelect: (key: BuilderNavKey) => void;
}) {
  return (
    <nav className="qz-builder-rail" aria-label="Builder navigation">
      {NAV.map((r) => {
        const Icon = r.icon;
        return (
          <Fragment key={r.key}>
            {r.ruleAbove ? <div className="qz-builder-rail-rule" aria-hidden="true" /> : null}
            <button
              type="button"
              className={`qz-builder-rail-item${active === r.key ? " is-active" : ""}`}
              aria-current={active === r.key ? "page" : undefined}
              onClick={() => onSelect(r.key)}
            >
              <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
              <span>{r.label}</span>
            </button>
          </Fragment>
        );
      })}
      <div className="qz-builder-rail-spacer" />
      <ThemeToggle />
    </nav>
  );
}

/* §7.6 — the builder's top bar on the shared .qz-topbar zone primitive. Left
   is ALWAYS the wordmark (compact ◆ — the word is reinforcement, the builder
   spends the room on the quiz title), then the host's title/badges; center
   carries the preview controls; right carries save state · health · actions.
   The --builder modifier drops stickiness (the bar is a flex-column child)
   and lets the left zone shrink so a long quiz title truncates instead of
   wrapping the bar to three lines. */
export function BuilderTopBar({
  left,
  center,
  right,
}: {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="qz-topbar qz-topbar--builder">
      <div className="qz-topbar-zone qz-topbar-left">
        <Wordmark to="/studio" compact />
        {left}
      </div>
      <div className="qz-topbar-zone qz-topbar-center">{center}</div>
      <div className="qz-topbar-zone qz-topbar-right">{right}</div>
    </header>
  );
}
