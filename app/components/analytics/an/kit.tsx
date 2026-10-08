// The analytics page kit (ANALYTICS-HANDOFF.md "Rules for every screen"):
// formatting, the KPI/figure shapes, the hover-intent tooltip, charts and
// sortable tables. Every class is the mock's, prefixed `an-` (see
// app/styles/analytics.css); `c("card lead")` writes "an-card an-lead".

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { GatedRate } from "../../../lib/analyticsConfidence";

/** The mock's class names, prefixed. */
export function c(names: string | false | null | undefined, ...more: Array<string | false | null | undefined>): string {
  return [names, ...more]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .flatMap((x) => x.split(/\s+/))
    .filter(Boolean)
    .map((x) => `an-${x}`)
    .join(" ");
}

// ── Numbers ────────────────────────────────────────────────────────────────

export const num = (n: number): string => Number(n).toLocaleString("en-US");
export const pct1 = (r: number): string => `${(r * 100).toFixed(1)}%`;
export const pct0 = (r: number): string => `${Math.round(r * 100)}%`;
export const plural = (n: number, one: string, many = `${one}s`): string => (n === 1 ? one : many);

/** Money in the quiz's currency; plain grouped digits when it is unknown. */
export function money(v: number, currency: string | null, digits = 2): string {
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(v);
    } catch {
      /* an unknown code falls through */
    }
  }
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * An order value from the server ("27.50 USD", or "20.00 USD + 9.50 USD" for a
 * session with two orders) in the page's money format; the raw text when the
 * currencies differ.
 */
export function orderValue(v: string | null, digits = 2): string | null {
  if (!v) return null;
  const parts = v.split(" + ").map((p) => {
    const [amount, currency] = p.trim().split(/\s+/);
    return { n: Number(amount), currency: currency ?? null };
  });
  const cur = parts[0]?.currency ?? null;
  if (parts.some((p) => !Number.isFinite(p.n) || p.currency !== cur)) return v;
  return money(parts.reduce((a, p) => a + p.n, 0), cur, digits);
}

/** 9/30/2026 — the mock's date form, in UTC like the server buckets. */
export function dmy(iso: string | number | Date): string {
  const d = new Date(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const md = (t: number): string => {
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
export const monLabel = (t: number): string => {
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Counts move in percent: "+12%". */
export function chgPct(a: number, b: number): string {
  if (!b) return "—";
  const v = Math.round(((a - b) / b) * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}%`;
}
/** Rates move in points: "+1.2 pts". */
export function chgPts(a: number, b: number): string {
  const v = Math.round((a - b) * 1000) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)} pts`;
}

// ── Confidence ─────────────────────────────────────────────────────────────

export function band(g: GatedRate): string {
  return `${Math.round(g.interval.lo * 100)}–${Math.round(g.interval.hi * 100)}%`;
}

/** The asterisk a rate under its gate carries; its title gives the range. */
export function Star({ g, unit }: { g: GatedRate; unit: string }) {
  const t =
    g.state === "suppressed"
      ? `Based on ${g.n} ${unit}. At this volume the true figure could sit anywhere between ${band(g)}, so read it as a hint. It settles around ${g.confidentAt}.`
      : `Based on ${g.n} ${unit}. The true figure is likely between ${band(g)}; it firms up at ${g.confidentAt}.`;
  return (
    <abbr className={c("low")} title={t}>
      *
    </abbr>
  );
}

/** "71.2%", with the asterisk under the gate, or a dash with nothing to rate. */
export function Rate({ g, unit }: { g: GatedRate; unit: string }) {
  if (!g.n) return <span className={c("none")}>—</span>;
  return (
    <>
      {pct1(g.rate)}
      {g.state !== "confident" ? <Star g={g} unit={unit} /> : null}
    </>
  );
}

/** Plain text of a rate, for tooltips. */
export const rateText = (g: GatedRate): string => (g.n ? `${pct1(g.rate)}${g.state !== "confident" ? "*" : ""}` : "—");

// ── Page context ───────────────────────────────────────────────────────────

export type AnalyticsSurface = "studio" | "app";

export interface Facet {
  facet: "all" | "answer" | "result" | "product";
  id?: string;
  status?: "all" | "bought" | "added" | "no-purchase";
  consent?: boolean;
}

export interface AnCtx {
  surface: AnalyticsSurface;
  currency: string | null;
  /** Compare is on and the previous period was counted. */
  compare: boolean;
  openPanel: (f: Facet) => void;
  say: (msg: string) => void;
  /** A link to another tab of this quiz, keeping the range (and Compare). */
  tabHref: (tab: string, extra?: Record<string, string>) => string;
  /** The quiz in the builder (its Logic step for `logic`). */
  builderHref: string;
  openMethod: () => void;
  /** Download a server-built CSV (every row, full emails) for a section. */
  exportServer: (section: "contacts" | "responses", extra?: Record<string, string>) => void;
}

export const AnContext = createContext<AnCtx | null>(null);
export function useAn(): AnCtx {
  const ctx = useContext(AnContext);
  if (!ctx) throw new Error("analytics context missing");
  return ctx;
}

// ── Icons (the mock's, Lucide-style strokes) ───────────────────────────────

const P: Record<string, ReactNode> = {
  chev: <path d="m6 9 6 6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M3 10h18M8 2v4M16 2v4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  chart: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  intro: <path d="m7 4 13 8-13 8z" />,
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.5-2.7 3.8" />
      <path d="M12 17h.01" />
    </>
  ),
  email_gate: (
    <>
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </>
  ),
  result: <path d="M12 3l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.3l6-.7z" />,
};

export function Icon({ name, className, style }: { name: keyof typeof P | string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={[c("ic"), className].filter(Boolean).join(" ")} viewBox="0 0 24 24" aria-hidden="true" style={style}>
      {P[name] ?? P.question}
    </svg>
  );
}

// ── Hover-intent tooltip + full text for anything cut ──────────────────────

const TIP_WAIT = 350;
const TIP_FAST = 0.6;
const CUT_SELECTOR =
  ".an-cut, .an-rr-n, .an-opt-l, .an-rl-row b, .an-lg-r > span:first-child, .an-pn-t, .an-cr-l b, .an-jm-out > b, .an-fig b.an-is-name, .an-mx-t, .an-mx-h b, .an-jm-node b, .an-dock-t, .an-head h1, .an-typ b, .an-fx > summary h3, .an-aud h2";

/**
 * One tooltip for the page: it opens only after the pointer rests (or slows
 * below 0.6 px/ms) on one [data-tip] element for 350 ms, follows the pointer
 * once open, and closes on leave, scroll or redraw. Also gives any cut text
 * its full value as a title on hover.
 */
export function TipLayer() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current;
    if (!tip) return;
    let tipFor: Element | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let x = 0;
    let y = 0;
    let t = 0;
    const place = () => {
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
      tip.style.top = `${Math.max(8, y - tip.offsetHeight - 14)}px`;
    };
    const hide = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      tip.hidden = true;
    };
    const wait = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!tipFor || !document.body.contains(tipFor)) return;
        tip.textContent = tipFor.getAttribute("data-tip");
        tip.hidden = false;
        place();
      }, TIP_WAIT);
    };
    const onMove = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      const now = e.timeStamp || Date.now();
      const speed = t ? Math.hypot(e.clientX - x, e.clientY - y) / Math.max(1, now - t) : 0;
      x = e.clientX;
      y = e.clientY;
      t = now;
      if (!target) {
        tipFor = null;
        hide();
        return;
      }
      if (target !== tipFor) {
        tipFor = target;
        hide();
        wait();
        return;
      }
      if (!tip.hidden) {
        place();
        return;
      }
      if (speed > TIP_FAST) wait();
    };
    const onLeave = () => {
      tipFor = null;
      hide();
    };
    const onOver = (e: MouseEvent) => {
      const el = e.target instanceof Element ? (e.target.closest(CUT_SELECTOR) as HTMLElement | null) : null;
      if (el && !el.title && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        el.title = (el.textContent ?? "").trim();
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("click", onLeave, true);
    document.addEventListener("mouseover", onOver);
    window.addEventListener("scroll", onLeave, { passive: true });
    return () => {
      hide();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("click", onLeave, true);
      document.removeEventListener("mouseover", onOver);
      window.removeEventListener("scroll", onLeave);
    };
  }, []);
  return <div ref={ref} className={c("tip")} hidden />;
}

/** The [data-tip] attribute plus the screen-reader copy of the same text. */
export function tipProps(t: string | null | undefined): { "data-tip"?: string } {
  return t ? { "data-tip": t } : {};
}
export function SrTip({ t }: { t: string | null | undefined }) {
  return t ? <span className={c("sr")}>{t}</span> : null;
}

// ── Shapes ─────────────────────────────────────────────────────────────────

/** Comparison lines that stay on screen ("was 32%", ▲/▼). */
export function Was({ children }: { children: ReactNode }) {
  return <span className={c("pp")}>{children}</span>;
}

export function Delta({ v, unit, tail }: { v: number | null | undefined; unit: string; tail?: string }) {
  if (v == null) return null;
  return (
    <span className={c("delta", v < 0 && "is-down")}>
      {v < 0 ? "▼" : "▲"} {Math.abs(v)}
      {unit}
      {tail ? ` ${tail}` : ""}
    </span>
  );
}

/**
 * A figure: number and name only; the explanation is its tooltip. `onOpen`
 * makes it open the contacts panel. Nine characters and up step down a size.
 */
export function Fig({
  value,
  label,
  tip,
  keep,
  onOpen,
  word,
  long,
}: {
  value: ReactNode;
  label: ReactNode;
  tip?: string | null;
  keep?: ReactNode;
  onOpen?: () => void;
  word?: boolean;
  long?: boolean;
}) {
  const text = typeof value === "string" ? value : "";
  const isLong = !word && (long ?? text.length >= 9);
  const inner = (
    <>
      <b className={c(word ? "is-word" : isLong ? "is-long" : "")}>
        <span className={c("fig-v")}>
          {value}
          {onOpen ? <Icon name="right" /> : null}
        </span>
      </b>
      <p className={c("lbl")}>{label}</p>
      {keep ? <p>{keep}</p> : null}
      <SrTip t={tip} />
    </>
  );
  const cls = c("fig", onOpen && "is-go", tip && "has-tip");
  return onOpen ? (
    <button type="button" className={cls} onClick={onOpen} {...tipProps(tip)}>
      {inner}
    </button>
  ) : (
    <div className={cls} {...tipProps(tip)}>
      {inner}
    </div>
  );
}

/** The headline KPI: its name and number; the sentence is its hover. */
export function LeadK({ eyebrow, children, tip }: { eyebrow: ReactNode; children: ReactNode; tip?: string | null }) {
  return (
    <div className={c("lead-k", tip && "has-tip")} {...tipProps(tip)}>
      <p className={c("lbl")}>{eyebrow}</p>
      {children}
      <SrTip t={tip} />
    </div>
  );
}

export function Lead({
  aria,
  bar,
  main,
  side,
  className,
}: {
  aria: string;
  bar: ReactNode;
  main?: ReactNode;
  side?: ReactNode;
  className?: string;
}) {
  return (
    <section className={[c("card lead", !side && "is-wide"), className].filter(Boolean).join(" ")} aria-label={aria}>
      {bar}
      {main ? <div className={c("lead-main")}>{main}</div> : null}
      {side ? <div className={c("lead-side")}>{side}</div> : null}
    </section>
  );
}

export function Kpi({ value, label, was, tip }: { value: ReactNode; label: string; was?: ReactNode; tip?: string | null }) {
  return (
    <div className={c("kpi", tip && "has-tip")} {...tipProps(tip)}>
      <b>{value}</b>
      <span>{label}</span>
      {was ? <em>{was}</em> : null}
      <SrTip t={tip} />
    </div>
  );
}

export function More({
  show,
  hide,
  children,
  defaultOpen,
}: {
  show: ReactNode;
  hide: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <details className={c("more")} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className={c("show")}>{show}</span>
        <span className={c("hide")}>{hide}</span>
        <Icon name="chev" />
      </summary>
      {open ? children : null}
    </details>
  );
}

export function Empty({ bar, title, body, needs }: { bar: ReactNode; title: string; body: string; needs?: ReactNode }) {
  return (
    <section className={c("card")}>
      {bar}
      <div className={c("empty")}>
        <i>
          <Icon name="chart" />
        </i>
        <div>
          <h2>{title}</h2>
          <p>{body}</p>
          {needs ? <p className={c("needs")}>{needs}</p> : null}
        </div>
      </div>
    </section>
  );
}

/** Title tabs: the card's own title switches its view. */
export function VTitle<K extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<[K, string]>;
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className={c("vt")} role="group" aria-label="View">
      {options.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {value === k ? <h2>{label}</h2> : label}
        </button>
      ))}
    </div>
  );
}

export function Seg<K extends string>({
  options,
  value,
  onChange,
  aria,
}: {
  options: Array<[K, ReactNode, number?]>;
  value: K;
  onChange: (k: K) => void;
  aria: string;
}) {
  return (
    <div className={c("seg")} role="group" aria-label={aria}>
      {options.map(([k, label, n]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {label}
          {n != null ? <b>{num(n)}</b> : null}
        </button>
      ))}
    </div>
  );
}

export function Cut({ children, w }: { children: ReactNode; w?: number }) {
  return (
    <span className={c("cut")} style={w ? { maxWidth: w } : undefined}>
      {children}
    </span>
  );
}

export const DASH = <span className={c("none")}>—</span>;

// ── Charts over time ───────────────────────────────────────────────────────

export interface Bucket {
  key: number;
  label: string;
  v: number | null;
  pv?: number | null;
  partial?: boolean;
  tip: string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 8 ? 8 : 10) * p;
}

/** Bars close together from the left; ≤96px slots, ≤48px bars; partial hatched. */
export function Chart({ buckets, fmt, aria }: { buckets: Bucket[]; fmt: (v: number) => string; aria: string }) {
  const max = niceMax(Math.max(0, ...buckets.map((b) => Math.max(b.v ?? 0, b.pv ?? 0))));
  const every = Math.max(1, Math.ceil(buckets.length / 13));
  const h = (v: number | null | undefined) => (v ? Math.max(1.5, (v / max) * 100) : 0);
  return (
    <div className={c("chart")} role="img" aria-label={aria}>
      <div className={c("ch-y")}>
        <span>{fmt(max)}</span>
        <span>{fmt(max / 2)}</span>
        <span>{fmt(0)}</span>
      </div>
      <div className={c("ch-plot")}>
        <div className={c("ch-grid")}>
          <i />
          <i />
          <i />
        </div>
        <div className={c("ch-bars")}>
          {buckets.map((b) => (
            <div key={b.key} className={c("ch-col", b.pv !== undefined && "is-pair")} {...tipProps(b.tip)}>
              {b.pv !== undefined ? <span className={c("ch-bar is-prev")} style={{ height: `${h(b.pv)}%` }} /> : null}
              <span className={c("ch-bar", b.partial && "is-partial")} style={{ height: `${h(b.v)}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className={c("ch-x")}>
        {buckets.map((b, i) => (
          <span key={b.key}>{i % every === 0 ? b.label : ""}</span>
        ))}
      </div>
    </div>
  );
}

// ── Sortable tables ────────────────────────────────────────────────────────

export interface Col<T> {
  h: ReactNode;
  /** Sort key; absent = the column doesn't sort. */
  v?: (row: T) => number | string | null;
  f: (row: T) => ReactNode;
  r?: boolean;
  cls?: string;
  /** Ascending first (names); numbers open highest first. */
  asc?: boolean;
}

export function SortTable<T>({
  cols,
  rows,
  def,
  limit,
  rowKey,
  className,
}: {
  cols: Array<Col<T>>;
  rows: T[];
  def: [number, 1 | -1];
  limit?: number;
  rowKey: (row: T, i: number) => string;
  className?: string;
}) {
  const [sort, setSort] = useState<[number, 1 | -1]>(def);
  const col = cols[sort[0]]?.v ? cols[sort[0]]! : cols[def[0]]!;
  const sorted = [...rows].sort((a, b) => {
    const x = col.v!(a);
    const y = col.v!(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sort[1];
  });
  const shown = limit ? sorted.slice(0, limit) : sorted;
  return (
    <div className={c("twrap")}>
      <table className={className}>
        <thead>
          <tr>
            {cols.map((cl, i) => (
              <th
                key={i}
                className={cl.r ? c("r") : undefined}
                aria-sort={cl.v ? (col === cl ? (sort[1] === 1 ? "ascending" : "descending") : "none") : undefined}
              >
                {cl.v ? (
                  <button
                    type="button"
                    onClick={() => setSort((s) => (s[0] === i ? [i, (-s[1]) as 1 | -1] : [i, cl.asc ? 1 : -1]))}
                  >
                    {cl.h}
                  </button>
                ) : (
                  cl.h
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, ri) => (
            <tr key={rowKey(row, ri)}>
              {cols.map((cl, i) => (
                <td key={i} className={cl.r ? c("r") : cl.cls ? c(cl.cls) : undefined}>
                  {cl.f(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Exports (a CSV of what is on screen) ───────────────────────────────────

function csvCell(v: string): string {
  const guarded = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  const text = `﻿${rows.map((r) => r.map((v) => csvCell(v == null ? "" : String(v))).join(",")).join("\n")}`;
  saveBlob(filename, new Blob([text], { type: "text/csv;charset=utf-8" }));
}

export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={c("btn btn-sm btn-quiet")} onClick={onClick} disabled={disabled}>
      Export
    </button>
  );
}
