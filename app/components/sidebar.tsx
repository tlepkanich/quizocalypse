// app/components/sidebar.tsx
// Persistent in-iframe sidebar nav for the admin. Three sections grouped
// per the Grid Notebook redesign. Counts come from the app-route loader so
// they stay live across screens.
//
// Mobile: under 900px the sidebar collapses to a horizontally-scrolling top
// strip and the layout switches from row to column. The styles use
// !important because the markup carries inline `style={...}` props inherited
// from when this was desktop-only — easier than re-plumbing every callsite.

import { Link, useLocation } from "@remix-run/react";
import type { ReactNode } from "react";

const SIDEBAR_MOBILE_CSS = `
@media (max-width: 899px) {
  .qz-sidebar-layout {
    flex-direction: column !important;
  }
  .qz-sidebar {
    width: 100% !important;
    height: auto !important;
    position: static !important;
    padding: 12px 16px !important;
    border-right: none !important;
    border-bottom: 1px solid var(--qz-rule);
    overflow-x: auto;
  }
  .qz-sidebar > div:first-child {
    padding: 0 0 8px !important;
    border-bottom: none !important;
  }
  .qz-sidebar nav {
    display: flex !important;
    flex-direction: row;
    gap: 4px;
    padding: 4px 0 !important;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .qz-sidebar nav > .qz-sidebar-section {
    padding: 0 !important;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .qz-sidebar nav > .qz-sidebar-section .qz-label {
    display: none;
  }
  .qz-sidebar nav a {
    padding: 6px 10px !important;
    border-left: none !important;
    border-radius: 6px;
    white-space: nowrap;
    font-size: 13px !important;
  }
  /* Generic page content needs to flex/scroll vs being constrained */
  .qz-main {
    padding: 16px !important;
  }
  /* Two-column dashboard / page grids fall to single column */
  .qz-responsive-grid {
    grid-template-columns: 1fr !important;
  }
}
`;

interface NavItem {
  label: string;
  to: string;
  exact?: boolean;
  count?: number;
}

interface Section {
  label: string;
  items: NavItem[];
}

export function Sidebar({
  counts,
}: {
  counts: { quizzes: number; captures: number };
}) {
  const sections: Section[] = [
    {
      label: "Workspace",
      items: [
        { label: "Dashboard", to: "/app", exact: true },
        { label: "Quizzes", to: "/app/quizzes", count: counts.quizzes },
        { label: "New quiz", to: "/app/quizzes/new", exact: true },
        { label: "What's new", to: "/app/releases" },
      ],
    },
    {
      label: "Design",
      items: [
        { label: "Brand", to: "/app/design" },
        { label: "Analytics", to: "/app/analytics" },
      ],
    },
    {
      label: "Shop",
      items: [
        { label: "Settings", to: "/app/settings" },
        { label: "Captures", to: "/app/captures", count: counts.captures },
      ],
    },
  ];

  return (
    <aside
      className="qz-sidebar"
      style={{
        width: 240,
        flexShrink: 0,
        background: "var(--qz-cream-2)",
        borderRight: "1px solid var(--qz-rule)",
        padding: "32px 0",
        position: "sticky",
        top: 0,
        alignSelf: "flex-start",
        height: "100vh",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          padding: "0 24px 24px",
          borderBottom: "1px solid var(--qz-rule)",
        }}
      >
        <div className="qz-label">Quizocalypse</div>
        <div
          className="qz-display"
          style={{ fontSize: 20, lineHeight: 1.1, marginTop: 4 }}
        >
          <span className="qz-serif-italic">studio</span>
        </div>
      </div>
      <nav style={{ padding: "20px 0" }}>
        {sections.map((section, sectionIdx) => (
          <SidebarSection key={section.label} section={section} first={sectionIdx === 0} />
        ))}
      </nav>
    </aside>
  );
}

function SidebarSection({
  section,
  first,
}: {
  section: Section;
  first: boolean;
}) {
  return (
    <div
      className="qz-sidebar-section"
      style={{ padding: first ? "0 0 12px" : "12px 0" }}
    >
      <div
        className="qz-label"
        style={{ padding: "8px 24px", color: "var(--qz-ink-4)" }}
      >
        {section.label}
      </div>
      {section.items.map((item) => (
        <SidebarItem key={item.to} item={item} />
      ))}
    </div>
  );
}

function SidebarItem({ item }: { item: NavItem }) {
  const location = useLocation();
  const active = item.exact
    ? location.pathname === item.to
    : location.pathname === item.to ||
      location.pathname.startsWith(item.to + "/");

  return (
    <Link
      to={item.to}
      prefetch="intent"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 24px",
        textDecoration: "none",
        color: active ? "var(--qz-ink)" : "var(--qz-ink-2)",
        fontWeight: active ? 600 : 500,
        fontSize: 14,
        borderLeft: active
          ? "2px solid var(--qz-accent)"
          : "2px solid transparent",
        background: active ? "var(--qz-paper)" : "transparent",
        transition: "background 80ms, color 80ms",
      }}
    >
      <span>{item.label}</span>
      {typeof item.count === "number" && (
        <span
          className="qz-mono qz-tnum"
          style={{
            fontSize: 11,
            color: active ? "var(--qz-ink-3)" : "var(--qz-ink-4)",
            background: active ? "var(--qz-rule-2)" : "transparent",
            padding: active ? "2px 6px" : 0,
            borderRadius: 100,
          }}
        >
          {item.count}
        </span>
      )}
    </Link>
  );
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{SIDEBAR_MOBILE_CSS}</style>
      <div
        className="qz-sidebar-layout"
        style={{ display: "flex", minHeight: "100vh" }}
      >
        {children}
      </div>
    </>
  );
}
