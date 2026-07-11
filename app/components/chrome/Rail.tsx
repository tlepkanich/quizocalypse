import { Form, NavLink } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  FlaskConical,
  Home,
  Layers,
  LogOut,
  Mail,
  Package,
  Palette,
  Plug,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Wordmark } from "./Wordmark";
import { ThemeToggle } from "../studio/ThemeToggle";

/* Design-system-V2 §7.7 — the left nav rail for the standalone /studio shell.
   Expanded 240px / collapsed 60px; width animates 300ms var(--qz-ease), labels
   fade 140ms (out first on collapse, in after expand — CSS transition delays).
   Collapse preference persists in localStorage ("qz-rail-collapsed"), read in
   a mount effect so SSR always renders the expanded default (no hydration
   mismatch). Collapsed items expose their label via the `title` attribute —
   a documented v1 simplification (a QzPopover per item is overkill for hover
   tooltips). Replaces the QD-1 StudioSidebar. */

const STORAGE_KEY = "qz-rail-collapsed";

interface RailItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/* Same 10 destinations as the old StudioSidebar. Icon rules (§7.7): lucide
   20px stroke 1.5; never a diamond/gem glyph (◆ is the wordmark's), and
   Sparkles only for AI (✦ is reserved for AI moments). */
const NAV: RailItem[] = [
  { to: "/studio", label: "Home", icon: Home, end: true },
  { to: "/studio/quizzes", label: "Quizzes", icon: Layers },
  { to: "/studio/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/studio/products", label: "Products", icon: Package },
  // Ported (handoff bundle) — account-level Groups & Personas (P3 Edit 5/§J1).
  { to: "/studio/groups", label: "Personas & Groups", icon: Boxes },
  { to: "/studio/brand", label: "Brand Identity", icon: Palette },
  { to: "/studio/customers", label: "Customers", icon: Users },
  { to: "/studio/integrations", label: "Integrations", icon: Plug },
  // Ported (handoff bundle) — account-level defaults (engagement §L Layer 2).
  { to: "/studio/settings", label: "Settings", icon: Settings },
  { to: "/studio/email", label: "Email Automation", icon: Mail },
  { to: "/studio/ab", label: "AB Testing", icon: FlaskConical },
  { to: "/studio/ai-agent", label: "AI Agent", icon: Sparkles },
];

export function Rail() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      // Storage unavailable (private mode etc.) — stay expanded.
    }
  }, []);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Non-persistent is fine; the toggle still works for this session.
      }
      return next;
    });
  };

  return (
    <aside className={collapsed ? "qz-rail is-collapsed" : "qz-rail"}>
      <div className="qz-rail-head">
        <Wordmark compact={collapsed} />
      </div>

      <nav className="qz-rail-nav" aria-label="Studio navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className="qz-rail-item"
              title={collapsed ? item.label : undefined}
            >
              <Icon size={20} strokeWidth={1.5} aria-hidden="true" className="qz-rail-icon" />
              <span className="qz-rail-label">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        className="qz-rail-collapse"
        onClick={toggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        title={collapsed ? "Expand" : "Collapse"}
      >
        {collapsed ? (
          <ChevronsRight size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronsLeft size={16} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>

      <div className="qz-rail-foot">
        <div className="qz-rail-account">
          <span className="qz-rail-avatar" aria-hidden="true">
            M
          </span>
          <span className="qz-rail-label">My account</span>
          <ThemeToggle className="qz-rail-theme" />
        </div>
        {/* BIC-2 A2(b) — sign out (POST /studio/logout clears both studio
            cookies). Reuses the nav item styling; the inline resets only strip
            the native button chrome (no colors — DS tokens via the class). */}
        <Form method="post" action="/studio/logout" style={{ margin: "8px 0 0" }}>
          <button
            type="submit"
            className="qz-rail-item"
            title={collapsed ? "Sign out" : undefined}
            style={{
              width: "100%",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}
          >
            <LogOut size={20} strokeWidth={1.5} aria-hidden="true" className="qz-rail-icon" />
            <span className="qz-rail-label">Sign out</span>
          </button>
        </Form>
      </div>
    </aside>
  );
}
