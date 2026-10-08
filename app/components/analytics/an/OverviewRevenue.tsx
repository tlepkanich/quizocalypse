// Overview and Revenue (ANALYTICS-HANDOFF.md "The screens").

import { useState, type ReactNode } from "react";
import { Link } from "@remix-run/react";
import type { QuizAnalyticsData } from "../../../lib/quizAnalytics.server";
import type { InsightCard } from "../../../lib/quizInsights";
import { gateRate } from "../../../lib/analyticsConfidence";
import {
  band,
  c,
  chgPct,
  chgPts,
  Chart,
  DASH,
  Delta,
  dmy,
  Empty,
  ExportBtn,
  Fig,
  Icon,
  Lead,
  LeadK,
  md,
  monLabel,
  money,
  More,
  num,
  pct0,
  Rate,
  rateText,
  Seg,
  SortTable,
  downloadCsv,
  useAn,
  type Bucket,
  type Col,
} from "./kit";
import { Insights } from "./chrome";

type D = QuizAnalyticsData;
const DAY = 86_400_000;

const shoppers = (n: number) => (n === 1 ? " shopper" : " shoppers");

/** A funnel row: label, bar out of the shoppers who started, "N of 1,053". */
function FnRow({ label, n, base, first, to }: { label: string; n: number; base: number; first?: boolean; to: string }) {
  return (
    <Link className={c("fn-row")} to={to} preventScrollReset>
      <span className={c("fn-l")}>{label}</span>
      <span className={c("fn-t")}>{n && base ? <i style={{ width: `${(n / base) * 100}%` }} /> : null}</span>
      <span className={c("fn-v")}>
        <b>{num(n)}</b>
        {first ? shoppers(n) : ` of ${num(base)}${shoppers(base)}`}
      </span>
      <Icon name="right" />
    </Link>
  );
}

function Meter({ n, marks, max }: { n: number; marks: Array<[number, string]>; max: number }) {
  return (
    <div className={c("meter")}>
      <div className={c("meter-t")}>
        <i style={{ width: `${Math.min(100, (n / max) * 100)}%` }} />
        {marks.map(([m]) => (m > 0 && m < max ? <s key={m} style={{ left: `${(m / max) * 100}%` }} /> : null))}
      </div>
      <div className={c("meter-l")}>
        {marks.map(([m, l]) => (
          <span key={m} style={{ left: `${(m / max) * 100}%` }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Compare on: the first card splits into This period | Previous period on one scale. */
export function SplitCompare({
  bar,
  big,
  rows,
  base,
  extra,
  foot,
  dates,
}: {
  bar: ReactNode;
  big: [ReactNode, ReactNode, string, string];
  rows: Array<[string, number, number, string | null]>;
  base: [number, number];
  extra: [string, string, string, string, string | null] | null;
  foot: ReactNode;
  dates: [string, string, string, string];
}) {
  const max = Math.max(base[0], base[1]) || 1;
  const col = (k: 0 | 1) => {
    const cur = k === 0;
    return (
      <div className={c("cv-col", cur ? "is-cur" : "is-prev")}>
        <div className={c("cv-h")}>
          <p className={c("lbl")}>{cur ? "This period" : "Previous period"}</p>
          <span>{cur ? `${dmy(dates[0])} – ${dmy(dates[1])}` : `${dmy(dates[2])} – ${dmy(dates[3])}`}</span>
        </div>
        <div className={c("cv-big")}>
          <b>{big[k]}</b>
          <span>{big[2]}</span>
          {cur ? <em>{big[3]}</em> : null}
        </div>
        <div className={c("fn")}>
          {rows.map((r, i) => {
            const v = r[1 + k] as number;
            const inner = (
              <>
                <span className={c("fn-l")}>{r[0]}</span>
                <span className={c("fn-t")}>{v ? <i style={{ width: `${(v / max) * 100}%` }} /> : null}</span>
                <span className={c("fn-v")}>
                  <b>{num(v)}</b>
                  {i === 0 ? shoppers(v) : ` of ${num(base[k])}`}
                </span>
                {cur ? (
                  <>
                    <span className={c("cv-c")}>{chgPct(r[1], r[2])}</span>
                    {r[3] ? <Icon name="right" /> : <span />}
                  </>
                ) : null}
              </>
            );
            return cur && r[3] ? (
              <Link key={r[0]} className={c("fn-row cv-row")} to={r[3]} preventScrollReset>
                {inner}
              </Link>
            ) : (
              <div key={r[0]} className={c("fn-row cv-row is-static")}>
                {inner}
              </div>
            );
          })}
          {extra ? (
            cur ? (
              extra[4] ? (
                <Link className={c("fn-row cv-row is-money")} to={extra[4]} preventScrollReset>
                  <span className={c("fn-l")}>{extra[0]}</span>
                  <span className={c("fn-t")} />
                  <span className={c("fn-v")}>
                    <b>{extra[1]}</b>
                  </span>
                  <span className={c("cv-c")}>{extra[3]}</span>
                  <Icon name="right" />
                </Link>
              ) : (
                <div className={c("fn-row cv-row is-money is-static")}>
                  <span className={c("fn-l")}>{extra[0]}</span>
                  <span className={c("fn-t")} />
                  <span className={c("fn-v")}>
                    <b>{extra[1]}</b>
                  </span>
                  <span className={c("cv-c")}>{extra[3]}</span>
                  <span />
                </div>
              )
            ) : (
              <div className={c("fn-row cv-row is-money is-static")}>
                <span className={c("fn-l")}>{extra[0]}</span>
                <span className={c("fn-t")} />
                <span className={c("fn-v")}>
                  <b>{extra[2]}</b>
                </span>
              </div>
            )
          ) : null}
        </div>
      </div>
    );
  };
  return (
    <section className={c("card lead cv")} aria-label="This period against the previous period">
      {bar}
      {col(0)}
      {col(1)}
      <p className={c("cv-f")}>{foot}</p>
    </section>
  );
}

export function insightTarget(
  card: InsightCard,
  which: 1 | 2,
  an: { tabHref: (t: string, x?: Record<string, string>) => string; builderHref: string },
): string {
  const action = which === 1 ? card.action : card.action2 ?? card.action;
  switch (action.kind) {
    case "products":
      return an.tabHref("products", { pf: "nologic" });
    case "flow":
      return an.tabHref("flow");
    case "contacts":
      return an.tabHref("customers", { cohort: "noMatch" });
    default:
      return an.builderHref;
  }
}

// ── Overview ───────────────────────────────────────────────────────────────

export function OverviewTab({ data, bar, onInsight }: { data: D; bar: ReactNode; onInsight: (to: string) => void }) {
  const an = useAn();
  const k = data.kpis;
  const noRev = data.attribution === "none";
  const P = an.compare ? k.prior : null;
  const comp = k.completion;
  const rev = (v: number) => money(v, data.currency, 0);
  let top: ReactNode;
  if (P) {
    const pcomp = gateRate("completion_rate", P.finished, P.started);
    top = (
      <SplitCompare
        bar={bar}
        dates={[data.range.from ?? data.range.to, data.range.to, P.from, P.to]}
        big={[<Rate key="c" g={comp} unit="sessions" />, <Rate key="p" g={pcomp} unit="sessions" />, "completion rate", chgPts(comp.rate, pcomp.rate)]}
        rows={[
          ["Started", k.engaged, P.started, an.tabHref("flow")],
          ["Finished", k.completed, P.finished, an.tabHref("flow")],
          ["Left an email", k.captureSessions, P.contacts, an.tabHref("customers")],
          ...(noRev ? [] : ([["Bought", k.buyers, P.bought, an.tabHref("revenue")]] as Array<[string, number, number, string]>)),
        ]}
        base={[k.engaged, P.started]}
        extra={noRev ? null : ["Revenue influenced", rev(k.revenue.numeric), rev(P.revenue), chgPct(k.revenue.numeric, P.revenue), an.tabHref("revenue")]}
        foot={
          <>
            <Link className={c("lnk")} to={an.tabHref("compare")}>
              Compare month by month
            </Link>
            <span>Click a row to open its tab.</span>
          </>
        }
      />
    );
  } else {
    const funnel = (
      <>
        <p className={c("lbl")} style={{ margin: "0 0 6px 10px" }}>
          Where shoppers go
        </p>
        <div className={c("fn")}>
          <FnRow label="Started" n={k.engaged} base={k.engaged} first to={an.tabHref("flow")} />
          <FnRow label="Finished" n={k.completed} base={k.engaged} to={an.tabHref("flow")} />
          <FnRow label="Left an email" n={k.captureSessions} base={k.engaged} to={an.tabHref("customers")} />
          {noRev ? (
            <div className={c("fn-row is-static")}>
              <span className={c("fn-l")}>Bought</span>
              <span className={c("fn-t")} />
              <span className={c("fn-v")}>Not measurable here</span>
              <span />
            </div>
          ) : (
            <FnRow label="Bought" n={k.buyers} base={k.engaged} to={an.tabHref("revenue")} />
          )}
        </div>
      </>
    );
    const revK = (
      <div className={c("lead-k2")}>
        {noRev ? (
          <LeadK eyebrow="Revenue influenced" tip="There is no Shopify order feed on this workspace.">
            <p className={c("lead-n is-text")}>Not measurable</p>
          </LeadK>
        ) : (
          <LeadK
            eyebrow="Revenue influenced"
            tip={
              k.revenue.orders
                ? `${num(k.revenue.orders)} order${k.revenue.orders === 1 ? "" : "s"} placed within ${data.attributionDays} days of starting the quiz.`
                : "No orders yet in this range."
            }
          >
            <p className={c("lead-n")}>{rev(k.revenue.numeric)}</p>
          </LeadK>
        )}
      </div>
    );
    const thin = k.engaged < 50;
    top = (
      <Lead
        aria="Completion"
        bar={bar}
        main={
          thin ? (
            <>
              <LeadK eyebrow="Sessions so far">
                <p className={c("lead-n")}>{num(k.engaged)}</p>
              </LeadK>
              <p className={c("lead-s")}>
                Too few to read a rate from yet. Completion shows <b>{rateText(comp)}</b> for now, and with {k.engaged}{" "}
                session{k.engaged === 1 ? "" : "s"} it could really be anywhere from {band(comp)}.
              </p>
              <Meter n={k.engaged} max={200} marks={[[50, "50 · rates firm up"], [200, "200 · reliable"]]} />
              {revK}
            </>
          ) : (
            <>
              <LeadK
                eyebrow="Completion rate"
                tip={`${num(k.completed)} of ${num(k.engaged)} shoppers who started reached their recommendations.`}
              >
                <p className={c("lead-n")}>
                  <Rate g={comp} unit="sessions" />
                </p>
              </LeadK>
              {revK}
            </>
          )
        }
        side={funnel}
      />
    );
  }
  const items = data.insights.cards.map((card) => ({ card, quizId: data.quiz.id }));
  return (
    <>
      {top}
      <Insights
        items={items}
        more={data.insights.more}
        onAction={(card, which) => onInsight(insightTarget(card, which, an))}
        cleanNote="Your quiz logic and this range's activity both came back clean."
      />
      {data.abTests.map((t) => (
        <section key={t.id} className={c("card sec")}>
          <div className={c("sec-h")}>
            <h2>A/B variants</h2>
          </div>
          <div className={c("twrap")}>
            <table>
              <thead>
                <tr>
                  <th>Variant</th>
                  <th className={c("r")}>Split</th>
                  <th className={c("r")}>Entered</th>
                  <th className={c("r")}>Completed</th>
                  <th className={c("r")}>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {t.slots.map((s) => (
                  <tr key={s.id}>
                    <td className={c("name")}>
                      <span className={c("cut")} style={{ maxWidth: 360 }}>
                        {s.label}
                      </span>
                    </td>
                    <td className={c("r dim")}>{s.share}%</td>
                    <td className={c("r")}>{num(s.funnel.entered)}</td>
                    <td className={c("r")}>
                      {num(s.funnel.completed)}
                      {s.funnel.entered >= 150 ? ` · ${pct0(s.funnel.completed / s.funnel.entered)}` : ""}
                    </td>
                    <td className={c("r")}>{num(s.funnel.clicked)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}

// ── Revenue ────────────────────────────────────────────────────────────────

type Grain = "day" | "week" | "month";
interface Period {
  key: number;
  label: string;
  rev: number;
  ord: number;
  fin: number;
  partial: boolean;
}

/** Days → periods of the grain, from the range's start, so the bars sit from the left edge. */
export function rollDays(
  days: Array<{ day: string; total: number; orders: number; finishers: number }>,
  grain: Grain,
  now: number,
): Period[] {
  const map = new Map<number, Period>();
  for (const d of days) {
    const t = Date.parse(`${d.day}T00:00:00Z`);
    const dt = new Date(t);
    let key: number;
    let label: string;
    if (grain === "day") {
      key = t;
      label = md(t);
    } else if (grain === "week") {
      key = t - ((dt.getUTCDay() + 6) % 7) * DAY;
      label = md(key);
    } else {
      key = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1);
      label = monLabel(key);
    }
    const p = map.get(key) ?? { key, label, rev: 0, ord: 0, fin: 0, partial: false };
    p.rev += d.total;
    p.ord += d.orders;
    p.fin += d.finishers;
    map.set(key, p);
  }
  const out = [...map.values()].sort((a, b) => a.key - b.key);
  // The period still in progress is drawn hatched.
  const span = grain === "day" ? DAY : grain === "week" ? 7 * DAY : 0;
  for (const p of out) {
    if (grain === "month") {
      const d = new Date(p.key);
      p.partial = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) > now;
    } else p.partial = p.key + span > now;
  }
  return out;
}

export function RevenueTab({ data, bar }: { data: D; bar: ReactNode }) {
  const an = useAn();
  const [grain, setGrain] = useState<Grain>("week");
  if (data.attribution === "none") {
    return (
      <Empty
        bar={bar}
        title="Revenue can’t be measured on this workspace"
        body="There is no Shopify order feed to read, so we can’t tell which shoppers who finished went on to buy. Everything else on the other tabs still counts."
        needs={
          <>
            <b>What turns this on:</b> a connected Shopify store. Order value, attributed orders and revenue per
            completion appear here from the first order.
          </>
        }
      />
    );
  }
  const k = data.kpis;
  const cur = data.currency;
  const m0 = (v: number) => money(v, cur, 0);
  const m2 = (v: number) => money(v, cur, 2);
  const P = an.compare ? k.prior : null;
  const now = Date.parse(data.range.to);
  const periods = rollDays(data.revenueDays, grain, now);
  const prevPeriods = P ? rollDays(P.revenueDays, grain, Date.parse(P.to)) : [];
  const withPrev = periods.map((p, i) => ({ ...p, prev: P ? prevPeriods[i] ?? null : undefined }));
  const gname = grain;
  const buckets: Bucket[] = withPrev.map((x) => ({
    key: x.key,
    label: x.label,
    v: x.rev,
    ...(x.prev !== undefined ? { pv: x.prev ? x.prev.rev : 0 } : {}),
    partial: x.partial,
    tip: `${grain === "week" ? "Week of " : ""}${x.label}${x.partial ? " (partial)" : ""}\n${m2(x.rev)} revenue\n${x.ord} orders · ${x.fin} completions${x.prev ? `\nPrevious (${x.prev.label}): ${m2(x.prev.rev)}` : ""}`,
  }));
  type Row = (typeof withPrev)[number];
  const cols: Array<Col<Row>> = [
    {
      h: grain === "day" ? "Day" : grain === "week" ? "Week of" : "Month",
      v: (x) => x.key,
      f: (x) => (
        <>
          {x.label}
          {x.partial ? <span style={{ color: "var(--an-ink4)", fontWeight: 500 }}> · partial</span> : null}
        </>
      ),
    },
    { h: "Completions", r: true, v: (x) => x.fin, f: (x) => num(x.fin) },
    { h: "Orders", r: true, v: (x) => x.ord, f: (x) => num(x.ord) },
    { h: "Revenue", r: true, v: (x) => x.rev, f: (x) => m2(x.rev) },
    ...(P
      ? ([
          { h: "Previous", r: true, v: (x) => (x.prev ? x.prev.rev : null), f: (x) => (x.prev ? m2(x.prev.rev) : DASH) },
          {
            h: "Change",
            r: true,
            v: (x) => (x.prev && x.prev.rev ? (x.rev - x.prev.rev) / x.prev.rev : null),
            f: (x) => (x.prev ? chgPct(x.rev, x.prev.rev) : DASH),
          },
        ] as Array<Col<Row>>)
      : []),
    { h: "Per completion", r: true, v: (x) => (x.fin ? x.rev / x.fin : null), f: (x) => (x.fin ? m2(x.rev / x.fin) : DASH) },
  ];
  const conv = k.conversion;
  const top = (
    <Lead
      aria="Revenue"
      bar={bar}
      main={
        <LeadK
          eyebrow="Revenue influenced"
          tip={`${num(k.revenue.orders)} orders from the ${num(k.completed)} shoppers who finished, placed within ${data.attributionDays} days of starting the quiz.`}
        >
          <p className={c("lead-n")}>
            {m0(k.revenue.numeric)}
            {P ? <Delta v={k.deltas.revenuePct} unit="%" /> : null}
          </p>
        </LeadK>
      }
      side={
        <div className={c("figs")}>
          <Fig
            value={num(k.revenue.orders)}
            label="Attributed orders"
            tip={`${rateText(conv)} of shoppers who finished bought`}
            keep={P ? <span className={c("pp")}>was {num(P.orders)}</span> : null}
          />
          <Fig value={k.revenue.orders ? m2(k.revenue.numeric / k.revenue.orders) : "—"} label="AOV" tip="Average order value: revenue influenced ÷ attributed orders" />
          <Fig
            value={k.completed ? m2(k.revenue.numeric / k.completed) : "—"}
            label="Revenue per completion"
            tip={`${m0(k.revenue.numeric)} ÷ ${num(k.completed)}`}
          />
        </div>
      }
    />
  );
  const time = (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <h2>Revenue by {gname}</h2>
        {P ? (
          <span className={c("ch-key")}>
            <i className={c("is-cur")} />
            This period
            <i className={c("is-prev")} />
            Previous period
          </span>
        ) : null}
        <div className={c("ctl")}>
          <Seg
            aria="Chart grain"
            value={grain}
            onChange={setGrain}
            options={[
              ["day", "Day"],
              ["week", "Week"],
              ["month", "Month"],
            ]}
          />
          <ExportBtn
            onClick={() =>
              downloadCsv(`revenue-by-${gname}.csv`, [
                [grain === "week" ? "Week of" : grain === "day" ? "Day" : "Month", "Completions", "Orders", "Revenue", ...(P ? ["Previous"] : []), "Per completion"],
                ...withPrev.map((x) => [
                  x.label,
                  x.fin,
                  x.ord,
                  x.rev.toFixed(2),
                  ...(P ? [x.prev ? x.prev.rev.toFixed(2) : ""] : []),
                  x.fin ? (x.rev / x.fin).toFixed(2) : "",
                ]),
              ])
            }
          />
        </div>
      </div>
      {periods.length ? (
        <Chart buckets={buckets} fmt={(v) => m0(v)} aria={`Revenue influenced by ${gname}`} />
      ) : (
        <p className={c("inline-empty")}>No orders in this range yet.</p>
      )}
      <More show="Show the table" hide="Hide the table">
        <SortTable cols={cols} rows={withPrev} def={[0, -1]} rowKey={(x) => String(x.key)} />
      </More>
    </section>
  );
  const byRes = data.results.filter((r) => r.count > 0 || r.orders > 0).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  const maxR = byRes[0]?.revenue || 1;
  const rrow = (r: (typeof byRes)[number]) => (
    <div
      key={r.resultId}
      className={c("rr")}
      role="button"
      tabIndex={0}
      onClick={() => an.openPanel({ facet: "result", id: r.resultId, status: "bought" })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          an.openPanel({ facet: "result", id: r.resultId, status: "bought" });
        }
      }}
    >
      <span className={c("rr-n")}>{r.noMatch ? "No match (fallback)" : r.name}</span>
      <span className={c("rr-t")}>{r.revenue ? <i style={{ width: `${(r.revenue / maxR) * 100}%` }} /> : null}</span>
      <span className={c("rr-v")}>
        <b>{m0(r.revenue)}</b>
      </span>
      <span className={c("rr-o")}>
        {num(r.orders)} order{r.orders === 1 ? "" : "s"}
      </span>
      <span className={c("rr-p")}>{r.orders ? `${m2(r.revenue / r.orders)} AOV` : "—"}</span>
    </div>
  );
  const resultsCard = (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <h2>Revenue by result</h2>
        <div className={c("ctl")}>
          <ExportBtn
            onClick={() =>
              downloadCsv("revenue-by-result.csv", [
                ["Result", "Orders", "Revenue", "AOV"],
                ...byRes.map((r) => [r.name, r.orders, r.revenue.toFixed(2), r.orders ? (r.revenue / r.orders).toFixed(2) : ""]),
              ])
            }
          />
        </div>
      </div>
      <div className={c("rrs")}>{byRes.slice(0, 8).map(rrow)}</div>
      {byRes.length > 8 ? (
        <More show={`Show all ${byRes.length} results`} hide="Show the top 8">
          <div className={c("rrs")}>{byRes.slice(8).map(rrow)}</div>
        </More>
      ) : null}
    </section>
  );
  const top5 = data.topProducts;
  const bmax = top5[0]?.revenue || 1;
  const basket = (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <h2>Top products by revenue</h2>
        <div className={c("ctl")}>
          <ExportBtn
            disabled={!top5.length}
            onClick={() =>
              downloadCsv("product-revenue.csv", [
                ["Product", "Revenue", "Orders"],
                ...top5.map((p) => [p.title, p.revenue.toFixed(2), p.orders]),
              ])
            }
          />
        </div>
      </div>
      <div className={c("sec-b bk")}>
        {top5.length ? (
          top5.map((p) => (
            <div key={p.productId} className={c("lg-r is-wide")}>
              <span>{p.title}</span>
              <span className={c("rr-t")}>
                <i style={{ width: `${(p.revenue / bmax) * 100}%` }} />
              </span>
              <span className={c("lg-v")}>
                <b>{m0(p.revenue)}</b> · {num(p.orders)} order{p.orders === 1 ? "" : "s"}
              </span>
            </div>
          ))
        ) : (
          <p className={c("inline-empty")} style={{ padding: 0 }}>
            {data.lineItemsSince === null
              ? "Product revenue is counted from each order’s own lines, saved from now on. The first attributed order fills this in."
              : "No attributed order in this range yet."}
          </p>
        )}
      </div>
      {data.lineItemsSince ? (
        <p className={c("sec-f")}>Counted from the order lines saved since {dmy(data.lineItemsSince)}.</p>
      ) : null}
    </section>
  );
  return (
    <>
      {top}
      {time}
      {byRes.length ? resultsCard : null}
      {basket}
    </>
  );
}
