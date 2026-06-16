import { useEffect, useState } from "react";

// Light/dark toggle for the admin chrome. Flips data-theme on <html> instantly
// (no reload) and persists a cookie that root.tsx's loader reads so the next SSR
// render is already correct (FOUC-free). Admin-only: the dark token overrides are
// scoped to body[data-qz], so the shopper runtime is unaffected.
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);

  // The root loader has already set <html data-theme> from the cookie; sync our
  // icon to it on mount (server render shows the light icon by default).
  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    const el = document.documentElement;
    if (next) el.setAttribute("data-theme", "dark");
    else el.removeAttribute("data-theme");
    document.cookie = `qz-theme=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <button
      type="button"
      className={`qz-btn qz-btn-ghost qz-btn-sm${className ? ` ${className}` : ""}`}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={toggle}
    >
      <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>{dark ? "☀" : "☾"}</span>
    </button>
  );
}
