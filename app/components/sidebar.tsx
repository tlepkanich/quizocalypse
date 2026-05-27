// app/components/sidebar.tsx
// Persistent in-iframe sidebar nav for the admin. Three sections grouped
// per the Grid Notebook redesign. Counts come from the app-route loader so
// they stay live across screens.

import { Link, useLocation } from "@remix-run/react";
import type { ReactNode } from "react";

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
    <div style={{ padding: first ? "0 0 12px" : "12px 0" }}>
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
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {children}
    </div>
  );
}
