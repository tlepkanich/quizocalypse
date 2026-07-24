import type { ReactNode, SVGProps } from "react";

/* questions-full-page mock (AUDIT-17) — the mock's SVG symbol set as tiny
   currentColor components (grip · kebab · trash · caret · chevrons · ✕ ·
   mail · target · mobile · desktop · expand). Sizing comes from the CSS
   context (`.qz-s3-* svg { width/height }`), matching the mock's per-slot
   sizes. All decorative: aria-hidden; icon-only buttons carry their own
   labels. */

function S({
  children,
  filled = false,
  strokeWidth = 2.2,
  ...rest
}: Omit<SVGProps<SVGSVGElement>, "stroke" | "strokeWidth" | "fill"> & {
  children: ReactNode;
  filled?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? undefined : "currentColor"}
      strokeWidth={filled ? undefined : strokeWidth}
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconGrip = () => (
  <S filled>
    <circle cx="9" cy="6" r="1.6" />
    <circle cx="15" cy="6" r="1.6" />
    <circle cx="9" cy="12" r="1.6" />
    <circle cx="15" cy="12" r="1.6" />
    <circle cx="9" cy="18" r="1.6" />
    <circle cx="15" cy="18" r="1.6" />
  </S>
);

export const IconDots = () => (
  <S filled>
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </S>
);

export const IconTrash = () => (
  <S strokeWidth={1.8}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </S>
);

export const IconCaret = () => (
  <S strokeWidth={2.6}>
    <path d="M6 9l6 6 6-6" />
  </S>
);

export const IconUp = () => (
  <S strokeWidth={2.6}>
    <path d="M6 15l6-6 6 6" />
  </S>
);

export const IconDown = () => (
  <S strokeWidth={2.6}>
    <path d="M6 9l6 6 6-6" />
  </S>
);

export const IconX = () => (
  <S>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
);

export const IconMail = () => (
  <S strokeWidth={1.7}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </S>
);

export const IconTarget = () => (
  <S strokeWidth={1.7}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
  </S>
);

export const IconMobile = () => (
  <S strokeWidth={1.8}>
    <rect x="7" y="3" width="10" height="18" rx="2" />
    <line x1="11" y1="18" x2="13" y2="18" />
  </S>
);

export const IconDesktop = () => (
  <S strokeWidth={1.8}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </S>
);

export const IconExpand = () => (
  <S strokeWidth={2}>
    <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" />
  </S>
);
