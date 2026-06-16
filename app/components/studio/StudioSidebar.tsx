import { NavLink } from "@remix-run/react";
import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";

// The Quizell-style persistent left sidebar for the standalone /studio surface.
// Icon + label nav, azure active state, Q badge up top, account + theme toggle
// at the bottom. Rendered by studio.tsx around every /studio child route.

const ICON: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  quizzes: <><rect x="3" y="4" width="18" height="5" rx="1.5" /><rect x="3" y="12" width="18" height="5" rx="1.5" /></>,
  analytics: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  products: <><path d="M3 8 12 3l9 5v8l-9 5-9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  customers: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.2a3.2 3.2 0 0 1 0 6M17.5 20a5.5 5.5 0 0 0-2-4.3" /></>,
  integrations: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M6 8.5v3a3 3 0 0 0 3 3h1.5M18 8.5v3a3 3 0 0 1-3 3h-1.5" /></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 7 8.5 6 8.5-6" /></>,
  ab: <><path d="M4 7h5l2 10M4 17h6M15 7h5M15 7l2 10h-4l-.7-3.5M17 7l-1 5" /></>,
  ai: <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3ZM18 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />,
};

interface NavItem {
  to: string;
  label: string;
  icon: keyof typeof ICON;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: "/studio", label: "Home", icon: "home", end: true },
  { to: "/studio/quizzes", label: "Quizzes", icon: "quizzes" },
  { to: "/studio/analytics", label: "Analytics", icon: "analytics" },
  { to: "/studio/products", label: "Products", icon: "products" },
  { to: "/studio/customers", label: "Customers", icon: "customers" },
  { to: "/studio/integrations", label: "Integrations", icon: "integrations" },
  { to: "/studio/email", label: "Email Automation", icon: "email" },
  { to: "/studio/ab", label: "AB Testing", icon: "ab" },
  { to: "/studio/ai-agent", label: "AI Agent", icon: "ai" },
];

function NavIcon({ name }: { name: keyof typeof ICON }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "0 0 auto" }}
    >
      {ICON[name]}
    </svg>
  );
}

export function StudioSidebar() {
  return (
    <aside className="qz-sidebar">
      <div className="qz-sidebar-brand">
        <NavLink to="/studio" end className="qz-brand-link" aria-label="Quizocalypse home">
          <span className="qz-brand-badge" aria-hidden="true">Q</span>
          <span className="qz-brand-word">Quizocalypse</span>
        </NavLink>
      </div>

      <nav className="qz-sidebar-nav" aria-label="Studio navigation">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className="qz-sidenav-item"
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="qz-sidebar-foot">
        <div className="qz-row qz-row-between" style={{ width: "100%" }}>
          <span className="qz-row" style={{ gap: 9 }}>
            <span className="qz-acct-avatar" aria-hidden="true" />
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>My account</span>
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
