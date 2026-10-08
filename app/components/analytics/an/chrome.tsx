// Page chrome shared by every analytics screen: the date strip on the first
// card (with Compare), the slim bar that follows the reader once it scrolls
// away, Insights, the "How we count this" drawer and the toast.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFetcher, useNavigate, useSearchParams } from "@remix-run/react";
import type { InsightCard } from "../../../lib/quizInsights";
import { ATTRIBUTION_WINDOW_DAYS } from "../../../lib/conversionAttribution";
import { c, dmy, Icon } from "./kit";

export type RangePresetKey = "7d" | "30d" | "90d" | "6m" | "12m" | "all" | "custom";

export const RANGES: Array<[RangePresetKey, string]> = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["6m", "Last 6 months"],
  ["12m", "Last 12 months"],
  ["all", "All time"],
  ["custom", "Custom range…"],
];

/** Params that only change what is on screen, never what the loader counts. */
export const VIEW_PARAMS = ["s", "pf", "cohort"];

/** True when two URLs differ only in view params: no need to recount. */
export function onlyViewParamsChanged(a: URL, b: URL): boolean {
  if (a.pathname !== b.pathname) return false;
  const strip = (u: URL) => {
    const p = new URLSearchParams(u.search);
    for (const k of VIEW_PARAMS) p.delete(k);
    p.sort();
    return p.toString();
  };
  return strip(a) === strip(b);
}

export interface RangeInfo {
  preset: RangePresetKey;
  from: string | null;
  to: string;
  widened: boolean;
}

export interface RangeBarProps {
  range: RangeInfo;
  /** Compare is offered on this screen. */
  canCompare: boolean;
  compare: boolean;
  /** The previous window's dates, when Compare is on. */
  prev?: { from: string; to: string } | null;
}

function useRangeNav() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  return {
    sp,
    go: (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(sp);
      mut(next);
      navigate(`?${next.toString()}`, { preventScrollReset: true });
    },
  };
}

function RangeControl({ range }: { range: RangeInfo }) {
  const { sp, go } = useRangeNav();
  const [custom, setCustom] = useState(range.preset === "custom");
  const value = range.widened ? "all" : custom ? "custom" : range.preset;
  return (
    <>
      <span className={c("dr")}>
        <span className={c("selwrap has-lead")}>
          <Icon name="cal" className={c("lead-ic")} />
          <select
            aria-label="Date range"
            value={value}
            onChange={(e) => {
              const v = e.target.value as RangePresetKey;
              if (v === "custom") {
                setCustom(true);
                return;
              }
              setCustom(false);
              go((p) => {
                p.set("r", v);
                p.delete("from");
                p.delete("to");
              });
            }}
          >
            {RANGES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <Icon name="chev" />
        </span>
        <span className={c("resolved")}>
          {range.from ? `${dmy(range.from)} – ${dmy(range.to)}` : `Everything to ${dmy(range.to)}`}
        </span>
      </span>
      {custom ? (
        <form
          className={c("custom")}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const from = String(f.get("from") ?? "");
            const to = String(f.get("to") ?? "");
            if (!from) return;
            go((p) => {
              p.set("r", "custom");
              p.set("from", from);
              if (to) p.set("to", to);
              else p.delete("to");
            });
          }}
        >
          <input type="date" name="from" aria-label="From" defaultValue={range.from?.slice(0, 10) ?? sp.get("from") ?? ""} required />
          <span className={c("resolved")}>to</span>
          <input type="date" name="to" aria-label="To" defaultValue={range.to.slice(0, 10)} />
          <button type="submit" className={c("btn btn-sm btn-quiet")}>
            Apply
          </button>
        </form>
      ) : null}
    </>
  );
}

function CompareToggle({ on }: { on: boolean }) {
  const { go } = useRangeNav();
  return (
    <button
      type="button"
      className={c("cmp")}
      aria-pressed={on}
      onClick={() =>
        go((p) => {
          if (on) p.delete("cmp");
          else p.set("cmp", "1");
        })
      }
    >
      <Icon name="check" />
      Compare to previous period
    </button>
  );
}

/** The strip at the top of the first card on every screen. */
export function RangeBar({ range, canCompare, compare, prev }: RangeBarProps) {
  return (
    <div className={c("rbar")}>
      <span className={c("lbl")}>Date range</span>
      <RangeControl range={range} />
      {canCompare && range.from ? <CompareToggle on={compare} /> : null}
      {canCompare && compare && prev ? (
        <span className={c("resolved")}>
          against {dmy(prev.from)} – {dmy(prev.to)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The slim bar: once the first card's date strip scrolls out of view, it
 * sticks to the top of the column, always on one line, title cut first.
 */
export function Dock({ title, bar }: { title: string; bar: RangeBarProps }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const strip = ref.current?.parentElement?.querySelector(".an-view .an-rbar");
    if (!strip || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      setShow(Boolean(entry && !entry.isIntersecting && entry.boundingClientRect.top < 0));
    });
    io.observe(strip);
    return () => io.disconnect();
  });
  useEffect(() => {
    if (!show) return;
    const place = () => {
      const root = ref.current?.parentElement;
      const dock = ref.current;
      if (!root || !dock) return;
      const r = root.getBoundingClientRect();
      dock.style.left = `${r.left}px`;
      dock.style.width = `${r.width}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [show]);
  return (
    <div ref={ref} className={c("dock")} aria-label="Date range" hidden={!show}>
      <span className={c("dock-t")}>{title}</span>
      <RangeControl range={bar.range} />
      {bar.canCompare && bar.range.from ? <CompareToggle on={bar.compare} /> : null}
    </div>
  );
}

// ── Insights ───────────────────────────────────────────────────────────────

export interface InsightItem {
  card: InsightCard;
  /** Headline prefix (the Analytics Overview names the quiz). */
  quizName?: string;
  quizId: string;
}

const CAT: Array<[RegExp, string]> = [
  [/^leak:/, "Drop-off"],
  [/^unreachable-products$/, "Products"],
  [/^email-no-match$/, "Contacts"],
  [/^traffic-starved$/, "Traffic"],
];

/** The tag, and the Impact box's figure, for a card. */
export function insightView(card: InsightCard): { cat: string; impact: [string, string, string] } {
  const cat = CAT.find(([re]) => re.test(card.id))?.[1] ?? "Logic";
  const ev = (label: string) => card.evidence.find((e) => e.label === label)?.value;
  if (cat === "Drop-off") {
    const about = ev("About");
    return {
      cat,
      impact: about
        ? [`~${about.replace(/ shoppers a month$/, "")}`, "shoppers a month", "leave here beyond what a typical step loses"]
        : [String(card.excess), "shoppers", "leave here beyond what a typical step loses"],
    };
  }
  if (cat === "Products") return { cat, impact: [ev("Unreachable") ?? "", "products", "that no shopper can be shown"] };
  if (cat === "Contacts") return { cat, impact: [ev("Contacts affected") ?? "", "leads", "captured without a matched recommendation"] };
  if (cat === "Traffic") {
    const n = Number(ev("Sessions") ?? 0);
    return { cat, impact: [String(Math.max(0, 200 - n)), "more sessions", "before rates are reliable"] };
  }
  const first = card.evidence[0];
  return { cat, impact: [card.chip ?? first?.value ?? "", first?.label.toLowerCase() ?? "", "read from the quiz's own logic"] };
}

function InsightRow({
  item,
  first,
  onAction,
}: {
  item: InsightItem;
  first: boolean;
  onAction: (card: InsightCard, which: 1 | 2) => void;
}) {
  const fetcher = useFetcher();
  const { card } = item;
  const v = insightView(card);
  if (fetcher.state !== "idle" || fetcher.data) return null; // dismissed: the next one moves up on reload
  const head = item.quizName ? `${item.quizName}: ${card.headline}` : card.headline;
  return (
    <details className={c("fx")} open={first}>
      <summary>
        <span className={c("tag is-draft")}>{v.cat}</span>
        <h3>{head}</h3>
        <span className={c("fx-i")}>
          <b>{v.impact[0]}</b> {v.impact[1]}
        </span>
        <Icon name="chev" />
      </summary>
      <div className={c("fx-b")}>
        <div className={c("fx-g")}>
          <div className={c("fx-c is-fig")}>
            <p className={c("lbl")}>Data</p>
            <div className={c("fx-d")}>
              {card.evidence.map((e) => (
                <span key={e.label}>
                  <b>{e.value}</b>
                  {e.label}
                </span>
              ))}
            </div>
          </div>
          <div className={c("fx-c is-fig is-imp")}>
            <p className={c("lbl")}>Impact</p>
            <div className={c("fx-d")}>
              <span>
                <b>{v.impact[0]}</b>
                <i>{v.impact[1]}</i>
                {v.impact[2]}
              </span>
            </div>
          </div>
          <div className={c("fx-c")}>
            <p className={c("lbl")}>Analysis</p>
            <p>{card.body}</p>
            {card.math ? <p style={{ marginTop: 8 }}>{card.math}</p> : null}
          </div>
          <div className={c("fx-c")}>
            <p className={c("lbl")}>Why we’re calling it out</p>
            <p>{card.basis}</p>
          </div>
        </div>
        <div className={c("fx-a")}>
          <button type="button" className={c("btn btn-sm")} onClick={() => onAction(card, 1)}>
            {card.action.label} <Icon name="arrow" />
          </button>
          {card.action2 ? (
            <button type="button" className={c("lnk")} onClick={() => onAction(card, 2)}>
              {card.action2.label}
            </button>
          ) : null}
          <fetcher.Form method="post" className={c("push")}>
            <input type="hidden" name="intent" value="dismiss-insight" />
            <input type="hidden" name="quizId" value={item.quizId} />
            <input type="hidden" name="cardId" value={card.id} />
            <button type="submit" className={c("lnk is-quiet")} title="Hides this for 14 days. If nothing changes, it comes back.">
              Dismiss
            </button>
          </fetcher.Form>
        </div>
      </div>
    </details>
  );
}

/** Collapsed on load; a count pill; up to three items, the first one open. */
export function Insights({
  items,
  more,
  onAction,
  cleanNote,
}: {
  items: InsightItem[];
  more: number;
  onAction: (card: InsightCard, which: 1 | 2) => void;
  cleanNote: string;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) {
    return (
      <section className={c("card sec ins")}>
        <div className={c("ins-h")}>
          <h2>Insights</h2>
          <span className={c("ins-b is-clear")}>
            <Icon name="check" />
            All clear
          </span>
          <span className={c("ins-note")}>{cleanNote}</span>
        </div>
      </section>
    );
  }
  return (
    <details className={c("card sec ins")} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={c("ins-h")}>
        <h2>Insights</h2>
        <span className={c("ins-b is-n")} aria-label={`${items.length} to look at`}>
          {items.length}
        </span>
        <span className={c("ins-t")}>
          <span className={c("show")}>Show</span>
          <span className={c("hide")}>Hide</span>
          <Icon name="chev" />
        </span>
      </summary>
      {items.map((it, i) => (
        <InsightRow key={`${it.quizId}:${it.card.id}`} item={it} first={i === 0} onAction={onAction} />
      ))}
      {more > 0 ? (
        <p className={c("sec-f")}>{more} more waiting. We show three at a time so the list stays worth reading.</p>
      ) : null}
    </details>
  );
}

// ── Drawers and toast ──────────────────────────────────────────────────────

export function Scrim({ onClose }: { onClose: () => void }) {
  return <div className={c("scrim")} onClick={onClose} aria-hidden="true" />;
}

export function MethodDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <>
      <Scrim onClose={onClose} />
      <aside className={c("drawer")} role="dialog" aria-modal="true" aria-labelledby="an-method-h">
        <header>
          <h2 id="an-method-h">How we count this</h2>
          <button ref={ref} type="button" className={c("x")} aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <p>Every number here comes from shoppers who actually used your quiz. Nothing is modelled or adjusted.</p>
        <div>
          <h3>Why this won’t match Shopify</h3>
          <p>
            Shopify credits the last marketing click a shopper made, looking back 30 days. We credit the quiz when an
            order holding a product it recommended is placed within {ATTRIBUTION_WINDOW_DAYS} days of the shopper
            starting it. Both are right; they answer different questions. Klaviyo, Meta and Google each use their own
            model too, so adding them together counts the same order several times.
          </p>
        </div>
        <div>
          <h3>What “reached” means</h3>
          <p>
            We know a shopper reached a question because they answered it. Someone who saw a question and left without
            answering isn’t counted as having reached it, which makes drop-off a worst-case figure, not an exact one.
          </p>
        </div>
        <div>
          <h3>What the asterisk means</h3>
          <p>
            A rate with an asterisk rests on a small sample. We still show it, with the range it could really sit in,
            and it firms up as more shoppers come through.
          </p>
        </div>
        <div>
          <h3>What we can’t see</h3>
          <p>
            Purchases on another device or in a private window. Orders placed after the window closes. Orders awaiting
            payment aren’t counted.
          </p>
        </div>
      </aside>
    </>
  );
}

export function useToast(): { node: ReactNode; say: (msg: string) => void } {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const say = (m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return {
    node: (
      <div className={c("toast", msg && "on")} role="status" aria-live="polite">
        {msg}
      </div>
    ),
    say,
  };
}

/** Escape closes whatever drawer is open. */
export function useEscape(onEscape: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onEscape, active]);
}
