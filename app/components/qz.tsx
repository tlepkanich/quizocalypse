// app/components/qz.tsx
// Tiny set of typed UI primitives for the redesigned admin screens.
// All styles live in app/styles/quizocalypse.css. No runtime CSS-in-JS.
//
// Usage: import { QzButton, QzCard, QzStat, ... } from "~/components/qz";

import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

type Variant = "default" | "primary" | "accent" | "ghost";
type Size = "sm" | "md" | "lg";

interface QzButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "variant"> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export function QzButton({
  variant = "default",
  size = "md",
  icon,
  iconRight,
  className,
  children,
  ...rest
}: QzButtonProps) {
  const v = {
    default: "",
    primary: " qz-btn-primary",
    accent: " qz-btn-accent",
    ghost: " qz-btn-ghost",
  }[variant];
  const s = { sm: " qz-btn-sm", md: "", lg: " qz-btn-lg" }[size];
  return (
    <button className={`qz-btn${v}${s}${className ? " " + className : ""}`} {...rest}>
      {icon}
      <span>{children}</span>
      {iconRight}
    </button>
  );
}

export function QzCard({
  flush,
  dashed,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { flush?: boolean; dashed?: boolean }) {
  const cls = ["qz-card", flush && "qz-flush", dashed && "qz-dash", className]
    .filter(Boolean)
    .join(" ");
  return <div className={cls} {...rest}>{children}</div>;
}

type BadgeTone = "ok" | "draft" | "warn" | "crit";
export function QzBadge({ tone = "draft", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`qz-badge qz-${tone}`}>{children}</span>;
}

type BannerTone = "default" | "ok" | "warn" | "crit";
export function QzBanner({
  tone = "default",
  title,
  children,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
}) {
  const cls = tone === "default" ? "qz-banner" : `qz-banner qz-banner-${tone}`;
  return (
    <div className={cls}>
      <div>
        {title && <div className="qz-banner-title">{title}</div>}
        {children && <div className="qz-banner-body">{children}</div>}
      </div>
    </div>
  );
}

export function QzStatGrid({ children }: { children: ReactNode }) {
  return <div className="qz-stat-grid">{children}</div>;
}
export function QzStat({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: "up" | "down";
}) {
  return (
    <div className="qz-stat">
      <span className="qz-label">{label}</span>
      <span className="qz-stat-value">{value}</span>
      {delta && (
        <span className={`qz-stat-delta${deltaTone ? " " + deltaTone : ""}`}>{delta}</span>
      )}
    </div>
  );
}

export function QzField({
  label,
  hint,
  children,
  meta,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="qz-field">
      {(label || meta) && (
        <div className="qz-row qz-row-between" style={{ alignItems: "baseline" }}>
          {label && <span className="qz-field-label">{label}</span>}
          {meta && <span className="qz-mono qz-dim">{meta}</span>}
        </div>
      )}
      {children}
      {hint && <div className="qz-field-hint">{hint}</div>}
    </div>
  );
}

export function QzInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`qz-input ${props.className ?? ""}`} />;
}
export function QzTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`qz-textarea ${props.className ?? ""}`} />;
}
export function QzSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`qz-select ${props.className ?? ""}`} />;
}

export function QzPage({ children }: { children: ReactNode }) {
  return <div className="qz-page">{children}</div>;
}

export function QzPageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="qz-page-header">
      <div className="qz-row qz-row-between" style={{ alignItems: "flex-end" }}>
        <div style={{ maxWidth: 720 }}>
          {eyebrow && <div className="qz-label qz-eyebrow">{eyebrow}</div>}
          <h1 className="qz-display qz-mt-8">{title}</h1>
          {subtitle && <p className="qz-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="qz-actions">{actions}</div>}
      </div>
    </header>
  );
}

// Hover-or-tap tooltip. Desktop: mouse over the trigger to show, away to
// hide. Touch: tap toggles open; tapping outside or pressing Escape closes
// it. The body is an absolutely-positioned card sized to ~280px wide so
// short feature blurbs read comfortably without dominating the viewport.
export function QzTooltip({
  children,
  content,
}: {
  children: ReactNode;
  content: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={wrapRef}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={(e) => {
        // Tap-toggle for touch devices. stopPropagation so the
        // document-click listener doesn't immediately close us.
        e.stopPropagation();
        setOpen((o) => !o);
      }}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            zIndex: 50,
            background: "var(--qz-ink)",
            color: "var(--qz-paper)",
            padding: "10px 12px",
            borderRadius: "var(--qz-radius)",
            fontSize: 12,
            lineHeight: 1.4,
            maxWidth: 280,
            minWidth: 200,
            boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            // Render the tooltip below the trigger so it doesn't get clipped
            // by parent cards. left:0 keeps it left-aligned with the chip.
            pointerEvents: "auto",
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// Responsive 16:9 video embed (YouTube/Vimeo/mp4 iframe). When `url` is null it
// renders a tidy placeholder, so onboarding steps can ship the structure now and
// have real walkthrough videos dropped in later.
export function QzEmbed({
  url,
  title,
  caption,
}: {
  url: string | null;
  title: string;
  caption?: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        paddingBottom: "56.25%",
        borderRadius: "var(--qz-radius)",
        overflow: "hidden",
        background: url ? "#000" : "var(--qz-cream-2, #f3f0ea)",
        border: "1px solid var(--qz-rule, #00000014)",
      }}
    >
      {url ? (
        <iframe
          src={url}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            textAlign: "center",
            padding: 16,
          }}
        >
          <span aria-hidden style={{ fontSize: 26, opacity: 0.45 }}>
            ▶
          </span>
          <span className="qz-dim" style={{ fontSize: 13, fontWeight: 600 }}>
            {title}
          </span>
          <span className="qz-dim" style={{ fontSize: 11.5 }}>
            Walkthrough video coming soon
          </span>
          {caption ? (
            <span className="qz-dim" style={{ fontSize: 11.5, maxWidth: 360 }}>
              {caption}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
