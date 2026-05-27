// app/components/qz.tsx
// Tiny set of typed UI primitives for the redesigned admin screens.
// All styles live in app/styles/quizocalypse.css. No runtime CSS-in-JS.
//
// Usage: import { QzButton, QzCard, QzStat, ... } from "~/components/qz";

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
