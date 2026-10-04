import type { ReactNode } from "react";

/* Account & Billing — the mock's icons (24 viewBox, lucide paths). */

const PATHS = {
  back: (
    <>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  cross: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  external: (
    <>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export function AcctIc({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="acct-ic" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** "1 day left" / "18 days left" */
export function daysLeftText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"} left`;
}
