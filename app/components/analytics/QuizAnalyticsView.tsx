// ANALYTICS P0 — the ONE per-quiz analytics view (spec Screen 2/3). Both admin
// surfaces mount this component over quizAnalyticsForShop() data, and it is
// the same view the Main Builder will host — so it is pure props + URL state,
// with zero surface-specific imports. Sections are URL-driven (?s=…) so links
// share; the range is ?r= (server-resolved).
//
// Honesty contract carried in the markup: every rate is SHOWN, and a rate that
// rests on a thin sample carries an asterisk whose hover states the sample size
// and the real swing (owner decision 2026-08-15, superseding the research doc's
// hard gates). Every count states its denominator.

import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "@remix-run/react";
import { QzCard, QzBadge, QzEmpty } from "../qz";
import { formatPct, formatPctRange, type GatedRate } from "../../lib/analyticsConfidence";
import type { QuizAnalyticsData, ContactRow } from "../../lib/quizAnalytics.server";
import type { InsightCard } from "../../lib/quizInsights";
import { formatDate } from "../../lib/formatDate";
import { AnalyticsControlBar, isLowConfidence, LowConfidence, MethodDrawer, MethodInfo } from "./AnalyticsControls";

export type AnalyticsSurface = "studio" | "app";

export const ANALYTICS_SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "revenue", label: "Revenue" },
  { key: "answers", label: "Questions & Answers" },
  { key: "products", label: "Products" },
  { key: "flow", label: "Quiz flow" },
  { key: "customers", label: "Customers" },
  { key: "compare", label: "Compare" },
] as const;

export type SectionKey = (typeof ANALYTICS_SECTIONS)[number]["key"];

function builderHref(surface: AnalyticsSurface, quizId: string): string {
  return surface === "studio" ? `/studio/${quizId}` : `/app/quizzes/${quizId}/studio`;
}

/** Keep every non-section param (range, embedded-app params) on section links. */
function sectionSearch(searchParams: URLSearchParams, s: SectionKey): string {
  const next = new URLSearchParams(searchParams);
  if (s === "overview") next.delete("s");
  else next.set("s", s);
  const str = next.toString();
  return str ? `?${str}` : "?";
}

// ── Small pieces ───────────────────────────────────────────────────────────

export function GatedTile({
  label,
  gated,
  detail,
  hero,
  unit,
  deltaPoints,
}: {
  label: ReactNode;
  gated: GatedRate;
  /** Sub-line for the confident state ("742 of 1,047 who started"). */
  detail?: ReactNode;
  hero?: boolean;
  unit: string;
  /** Period-over-period movement in POINTS (rates never move in percent). */
  deltaPoints?: number | null;
}) {
  // Owner decision 2026-08-15: always show the figure. A thin sample earns an
  // asterisk and a hover that says how thin — never a withheld number.
  // ZERO sessions is the one exception: there is no rate to show, and "0.0%"
  // would be a fabricated number rather than a thin one.
  if (gated.n === 0) {
    return (
      <div className={`qz-antile${hero ? " is-hero" : ""}`}>
        <div className="n qz-andash">—</div>
        <div className="l">{label}</div>
        <div className="d">no {unit} in this range yet</div>
      </div>
    );
  }
  const low = isLowConfidence(gated.state);
  return (
    <div className={`qz-antile${hero ? " is-hero" : ""}`}>
      <div className="n">
        {formatPct(gated.rate)}
        {low ? (
          <LowConfidence
            n={gated.n}
            showsAt={gated.showsAt}
            confidentAt={gated.confidentAt}
            unit={unit}
            lo={gated.interval.lo}
            hi={gated.interval.hi}
          />
        ) : null}
      </div>
      <div className="l">{label}</div>
      <div className="d">
        {low ? (
          <>
            {gated.n} {unit} so far · could be {formatPctRange(gated.interval)}
          </>
        ) : (
          <>
            {deltaPoints != null ? (
              <span className={deltaPoints >= 0 ? "qz-anup" : "qz-andown"}>
                {deltaPoints >= 0 ? "▲" : "▼"} {Math.abs(deltaPoints)} points{detail ? " · " : ""}
              </span>
            ) : null}
            {detail}
          </>
        )}
      </div>
    </div>
  );
}

export function CountTile({
  label,
  value,
  detail,
  hero,
}: {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  hero?: boolean;
}) {
  return (
    <div className={`qz-antile${hero ? " is-hero" : ""}`}>
      <div className="n">{value}</div>
      <div className="l">{label}</div>
      {detail ? <div className="d">{detail}</div> : null}
    </div>
  );
}

const SEV_LABEL: Record<InsightCard["severity"], string> = {
  crit: "Fix first",
  warn: "Worth fixing",
  info: "Good to know",
};

export function InsightCardView({
  severity,
  headline,
  body,
  evidence,
  basis,
  action,
  action2,
  math,
}: {
  severity: InsightCard["severity"];
  headline: string;
  body: string;
  evidence: Array<{ label: string; value: string }>;
  basis: string;
  action?: { label: string; href: string } | null;
  action2?: { label: string; href: string } | null;
  /** "Show the math" — counts only, never a currency amount (§7.4). */
  math?: string;
}) {
  const [mathOpen, setMathOpen] = useState(false);
  return (
    <div className={`qz-insight is-${severity}`}>
      <div className="qz-insight-sev">{SEV_LABEL[severity]}</div>
      <h3 className="qz-insight-h">{headline}</h3>
      <p className="qz-insight-b">{body}</p>
      <div className="qz-insight-ev">
        {evidence.map((e) => (
          <span key={e.label}>
            <b>{e.label}</b> {e.value}
          </span>
        ))}
      </div>
      {math && mathOpen ? <p className="qz-insight-math">{math}</p> : null}
      <div className="qz-insight-foot">
        <span className="qz-insight-basis">{basis}</span>
        {math ? (
          <button type="button" className="qz-linkbtn" onClick={() => setMathOpen((v) => !v)}>
            {mathOpen ? "Hide the math" : "Show the math"}
          </button>
        ) : null}
        {action2 ? (
          <Link to={action2.href} className="qz-link">
            {action2.label} →
          </Link>
        ) : null}
        {action ? (
          <Link to={action.href} className="qz-link">
            {action.label} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function insightHref(
  card: InsightCard,
  surface: AnalyticsSurface,
  quizId: string,
  searchParams: URLSearchParams,
): string {
  switch (card.action.kind) {
    case "products":
      return sectionSearch(searchParams, "products");
    case "flow":
      return sectionSearch(searchParams, "flow");
    case "contacts":
      return sectionSearch(searchParams, "customers");
    default:
      return builderHref(surface, quizId);
  }
}

function Bar({ share }: { share: number }) {
  return (
    <div className="qz-anbar" role="presentation">
      <span style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

// ── The view ───────────────────────────────────────────────────────────────

export function QuizAnalyticsView({
  data,
  surface,
  exportBase,
}: {
  data: QuizAnalyticsData;
  surface: AnalyticsSurface;
  /** Contacts-CSV resource route base for this surface (null hides export). */
  exportBase: string | null;
}) {
  const [searchParams] = useSearchParams();
  const rawSection = searchParams.get("s");
  const section: SectionKey = (ANALYTICS_SECTIONS.some((s) => s.key === rawSection)
    ? rawSection
    : "overview") as SectionKey;
  const [methodOpen, setMethodOpen] = useState(false);
  const [cohort, setCohort] = useState<"all" | "purchased" | "didntBuy" | "noMatch" | "backInStock">("all");

  const { kpis, dataState } = data;

  // ── Control bar (the SHARED one — same component the home page mounts) ───
  const controlBar = (
    <AnalyticsControlBar
      rangeLabel={data.range.label}
      from={data.range.from}
      to={data.range.to}
      widened={data.range.widened}
      exports={
        exportBase
          ? [
              {
                label: `Contacts .csv (${cohortLabel(cohort)})`,
                href: `${exportBase}?quiz=${data.quiz.id}&segment=${exportSegment(cohort)}`,
              },
            ]
          : []
      }
      onMethod={() => setMethodOpen(true)}
    />
  );

  // ── Section tabs ─────────────────────────────────────────────────────────
  const tabs = (
    <nav className="qz-antabs" aria-label="Analytics sections">
      {ANALYTICS_SECTIONS.map((s) => (
        <Link
          key={s.key}
          to={sectionSearch(searchParams, s.key)}
          className={section === s.key ? "is-active" : ""}
          aria-current={section === s.key ? "page" : undefined}
        >
          {s.label}
          {s.key === "customers" && data.contacts.counts.all > 0 ? (
            <span className="qz-antab-n">{data.contacts.counts.all}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );

  // ── Data-state ladder (§8.4) ─────────────────────────────────────────────
  if (dataState === "draft") {
    return (
      <div className="qz-anwrap">
        {tabs}
        <QzCard style={{ marginBottom: 20 }}>
          <div className="qz-label">This quiz isn&rsquo;t live yet</div>
          <p className="qz-muted qz-mt-8" style={{ margin: "8px 0 0" }}>
            Numbers start the moment you publish. The checks below read your quiz&rsquo;s logic, so they work
            now — and they&rsquo;re worth clearing first.
          </p>
        </QzCard>
        <SectionHead title="Fix before you publish" sub="from your quiz logic" />
        <InsightList data={data} surface={surface} searchParams={searchParams} emptyCopy="Every path resolves. Publish when ready." />
      </div>
    );
  }

  if (dataState === "no-data") {
    return (
      <div className="qz-anwrap">
        {tabs}
        <QzCard style={{ marginBottom: 20 }}>
          <div className="qz-label">You&rsquo;re live — now get shoppers to it</div>
          <ul className="qz-anchecklist">
            <li className="is-done">✓ Quiz published{data.quiz.publishedAt ? ` · ${formatDate(data.quiz.publishedAt)}` : ""}</li>
            <li>⬜ First response — waiting</li>
          </ul>
          <p className="qz-muted" style={{ margin: "10px 0 0", fontSize: 13 }}>
            Every section turns on with the first response. We don&rsquo;t show rates until there are enough of
            them to mean something.
          </p>
        </QzCard>
        <SectionHead title="Checked before launch" sub="from your quiz logic" />
        <InsightList
          data={data}
          surface={surface}
          searchParams={searchParams}
          emptyCopy={`Every path resolves${data.productMeta ? `, and all ${data.productMeta.mapped} mapped products can be reached` : ""}.`}
        />
      </div>
    );
  }

  return (
    <div className="qz-anwrap">
      {controlBar}
      {tabs}
      {data.truncated ? (
        <p className="qz-dim" style={{ fontSize: 12, margin: "0 0 14px" }}>
          Showing the most recent {5000} sessions in this range — narrow the range for older activity.
        </p>
      ) : null}
      {dataState === "low" ? (
        <p className="qz-dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>
          {kpis.engaged} response{kpis.engaged === 1 ? "" : "s"} so far — rates unlock as volume grows, and each
          tile says what it needs.
        </p>
      ) : null}

      {section === "overview" ? (
        <>
          <div className="qz-antiles">
            <GatedTile
              label={<>Completion rate <MethodInfo onClick={() => setMethodOpen(true)} /></>}
              gated={kpis.completion}
              unit="sessions"
              hero
              deltaPoints={kpis.deltas.completionPoints}
              detail={`${kpis.completed} of ${kpis.engaged} who started`}
            />
            <CountTile
              label="Reached recommendations"
              value={kpis.completed.toLocaleString()}
              detail={
                kpis.deltas.sessionsPct != null ? (
                  <>
                    <span className={kpis.deltas.sessionsPct >= 0 ? "qz-anup" : "qz-andown"}>
                      {kpis.deltas.sessionsPct >= 0 ? "▲" : "▼"} {Math.abs(kpis.deltas.sessionsPct)}% sessions
                    </span>{" "}
                    · of {kpis.engaged.toLocaleString()} who started
                  </>
                ) : (
                  `of ${kpis.engaged.toLocaleString()} who started`
                )
              }
            />
            <GatedTile
              label="Email capture"
              gated={kpis.capture}
              unit="finishers"
              detail={`${kpis.captureSessions} of ${kpis.completed} finished`}
            />
            {data.attribution === "none" ? (
              // NOT the same as a thin sample: attribution is structurally
              // impossible here (W6), so there is no figure to disclose.
              <CountTile
                label="Revenue influenced"
                value={<span className="qz-annotmeas">Not measurable</span>}
                detail="No Shopify order feed on this workspace."
              />
            ) : (
              <CountTile
                label={<>Revenue influenced <MethodInfo onClick={() => setMethodOpen(true)} /></>}
                value={kpis.revenue.formatted}
                detail={kpis.revenue.orders > 0 ? `${kpis.revenue.orders} orders · 7-day window` : "no attributed orders yet"}
              />
            )}
          </div>

          <SectionHead title="What to fix" sub={data.insights.cards.length ? "ranked by shoppers affected" : undefined} />
          <InsightList
            data={data}
            surface={surface}
            searchParams={searchParams}
            emptyCopy={`Your quiz logic and the ${data.range.label.toLowerCase()} of activity both came back clean.`}
          />

          {data.abTests.length > 0 ? <AbSection abTests={data.abTests} /> : null}
        </>
      ) : null}

      {section === "revenue" ? (
        <RevenueSection data={data} onMethod={() => setMethodOpen(true)} />
      ) : null}

      {section === "answers" ? <AnswersSection data={data} /> : null}
      {section === "products" ? <ProductsSection data={data} /> : null}
      {section === "flow" ? <FlowSection data={data} /> : null}
      {section === "customers" ? (
        <CustomersSection data={data} cohort={cohort} setCohort={setCohort} exportBase={exportBase} />
      ) : null}
      {section === "compare" ? <CompareSection data={data} /> : null}

      <MethodDrawer open={methodOpen} onClose={() => setMethodOpen(false)} />
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="qz-anhead">
      <h2 className="qz-h1">{title}</h2>
      {sub ? <span className="qz-dim" style={{ fontSize: 12.5 }}>{sub}</span> : null}
    </div>
  );
}

function InsightList({
  data,
  surface,
  searchParams,
  emptyCopy,
}: {
  data: QuizAnalyticsData;
  surface: AnalyticsSurface;
  searchParams: URLSearchParams;
  emptyCopy: string;
}) {
  const { cards, more, clean } = data.insights;
  if (clean) {
    return (
      <div className="qz-anclean">
        <span className="qz-anclean-ic" aria-hidden>✓</span>
        <div>
          <div style={{ fontWeight: 600 }}>Nothing needs attention</div>
          <div className="qz-dim" style={{ fontSize: 13 }}>{emptyCopy}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="qz-col qz-gap-16" style={{ marginBottom: 28 }}>
      {cards.map((card) => (
        <InsightCardView
          key={card.id}
          severity={card.severity}
          headline={card.headline}
          body={card.body}
          evidence={card.evidence}
          basis={card.basis}
          math={card.math}
          action={{ label: card.action.label, href: insightHref(card, surface, data.quiz.id, searchParams) }}
          action2={
            card.action2
              ? {
                  label: card.action2.label,
                  href: insightHref({ ...card, action: card.action2 }, surface, data.quiz.id, searchParams),
                }
              : null
          }
        />
      ))}
      {more > 0 ? (
        <p className="qz-dim" style={{ fontSize: 12.5, margin: 0 }}>
          {more} more finding{more === 1 ? " is" : "s are"} waiting — we show three at a time so the list stays
          worth reading.
        </p>
      ) : null}
    </div>
  );
}

// ── Sections ───────────────────────────────────────────────────────────────

type Grain = "day" | "week" | "month";

interface RevBucket { key: string; label: string; total: number; orders: number; finishers: number; currency: string }

/** Roll daily buckets up to the chosen grain — every grain sums to the same
 *  total, and switching costs no round-trip. */
function rollUp(days: QuizAnalyticsData["revenueDays"], grain: Grain): RevBucket[] {
  const out = new Map<string, RevBucket>();
  for (const d of days) {
    const date = new Date(`${d.day}T00:00:00Z`);
    let key = d.day;
    if (grain === "week") {
      // ISO-ish week start (Monday) so buckets are stable across renders.
      const dow = (date.getUTCDay() + 6) % 7;
      key = new Date(+date - dow * 86_400_000).toISOString().slice(0, 10);
    } else if (grain === "month") {
      key = d.day.slice(0, 7);
    }
    const prev = out.get(key);
    if (prev) {
      prev.total += d.total;
      prev.orders += d.orders;
      prev.finishers += d.finishers;
      prev.currency = prev.currency || d.currency;
    } else {
      out.set(key, {
        key,
        label:
          grain === "month"
            ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
            : new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        total: d.total,
        orders: d.orders,
        finishers: d.finishers,
        currency: d.currency,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function money(v: number, currency: string): string {
  return `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

function RevenueSection({ data, onMethod }: { data: QuizAnalyticsData; onMethod: () => void }) {
  const { kpis } = data;
  const [grain, setGrain] = useState<Grain>("week");
  if (data.attribution === "none") {
    return (
      <QzEmpty title="Order attribution isn't measurable on this workspace — there is no Shopify order feed to read." />
    );
  }
  const buckets = rollUp(data.revenueDays, grain);
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total));
  const maxOrders = Math.max(1, ...buckets.map((b) => b.orders));
  const grainName: Record<Grain, string> = { day: "day", week: "week", month: "month" };

  return (
    <>
      <div className="qz-antiles">
        <CountTile
          label={<>Order value influenced <MethodInfo onClick={onMethod} /></>}
          value={kpis.revenue.formatted}
          hero
          detail={
            kpis.deltas.revenuePct != null ? (
              <span className={kpis.deltas.revenuePct >= 0 ? "qz-anup" : "qz-andown"}>
                {kpis.deltas.revenuePct >= 0 ? "▲" : "▼"} {Math.abs(kpis.deltas.revenuePct)}% vs previous period
              </span>
            ) : (
              data.range.label.toLowerCase()
            )
          }
        />
        <CountTile label="Attributed orders" value={kpis.revenue.orders} detail={`of ${kpis.completed} finishers`} />
        <GatedTile label="Finishers who bought" gated={kpis.conversion} unit="finishers" />
        <CountTile
          label="Revenue per finisher"
          value={kpis.revenue.perFinisher ?? "—"}
          detail={
            kpis.revenue.perFinisher
              ? `${kpis.revenue.formatted} ÷ ${kpis.completed}`
              : "needs a single currency"
          }
        />
      </div>

      {buckets.length > 0 ? (
        <>
          <div className="qz-anhead">
            <h2 className="qz-h1">Revenue by {grainName[grain]}</h2>
            <div className="qz-anseg" role="group" aria-label="Chart grain">
              {(["day", "week", "month"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={grain === g ? "is-on" : ""}
                  aria-pressed={grain === g}
                  onClick={() => setGrain(g)}
                >
                  {g[0]!.toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>
            <span className="qz-anattr">{data.attributionDays}-day attribution</span>
          </div>
          <QzCard flush>
            <div className="qz-anlegend">
              <span className="qz-anlegend-bar" aria-hidden /> Order value influenced
              <span className="qz-anlegend-dot" aria-hidden /> Attributed orders
            </div>
            <div className="qz-anchart">
              {buckets.map((b) => (
                <div key={b.key} className="qz-anbucket">
                  <div className="qz-anbucket-col" role="presentation">
                    <span className="qz-anbucket-fill" style={{ height: `${Math.max(3, Math.round((b.total / maxTotal) * 100))}%` }} />
                    {b.orders > 0 ? (
                      <i
                        className="qz-anbucket-dot"
                        style={{ bottom: `${Math.min(96, Math.round((b.orders / maxOrders) * 92))}%` }}
                        title={`${b.orders} order${b.orders === 1 ? "" : "s"}`}
                      />
                    ) : null}
                  </div>
                  <div className="qz-anbucket-l">{b.label}</div>
                </div>
              ))}
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="qz-table">
                <thead>
                  <tr>
                    <th>{grain === "day" ? "Day" : grain === "week" ? "Week of" : "Month"}</th>
                    <th>Finishers</th>
                    <th>Orders</th>
                    <th>Order value</th>
                    <th>Per finisher</th>
                  </tr>
                </thead>
                <tbody>
                  {[...buckets].reverse().map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="qz-mono qz-tnum">{b.finishers}</td>
                      <td className="qz-mono qz-tnum">{b.orders}</td>
                      <td className="qz-mono qz-tnum">{money(b.total, b.currency)}</td>
                      <td className="qz-mono qz-tnum">
                        {b.finishers > 0 ? money(b.total / b.finishers, b.currency) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QzCard>
        </>
      ) : (
        <QzEmpty title="No attributed orders in this range yet." />
      )}
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        These are whole order totals, not just the products we recommended.{" "}
        <button type="button" className="qz-linkbtn" onClick={onMethod}>
          How we count this →
        </button>
      </p>
    </>
  );
}

function AnswersSection({ data }: { data: QuizAnalyticsData }) {
  if (data.answers.length === 0) return <QzEmpty title="No questions in this quiz yet." />;
  return (
    <>
      <SectionHead title="What shoppers told you" sub={`${data.kpis.engaged} started · ${data.kpis.completed} finished`} />
      <div className="qz-col qz-gap-16">
        {data.answers.map((q) => (
          <QzCard key={q.questionId}>
            <div className="qz-row qz-row-between" style={{ gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <h3 className="qz-h2" style={{ margin: 0 }}>{q.text}</h3>
              <span className="qz-dim" style={{ fontSize: 12 }}>
                {q.multi ? "Pick any" : "Pick one"} · Answered {q.answered} · Skipped {q.skipped}
                {q.multi && q.answered > 0 ? ` · Avg ${q.avgPicks.toFixed(1)} picks` : ""}
              </span>
            </div>
            {q.freeform ? (
              <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>
                Free-typed answers — {q.answered} response{q.answered === 1 ? "" : "s"} collected.
              </p>
            ) : q.answered === 0 ? (
              <p className="qz-dim" style={{ margin: 0, fontSize: 13 }}>No answers in this range.</p>
            ) : (
              <>
                {q.options.map((o) => (
                  <div key={o.answerId} className="qz-anopt">
                    <span className="qz-anopt-l">{o.label}</span>
                    <Bar share={o.share} />
                    <span className="qz-anopt-n qz-mono qz-tnum">
                      {o.sessions} · {Math.round(o.share * 100)}%
                    </span>
                  </div>
                ))}
                <p className="qz-dim" style={{ margin: "10px 0 0", fontSize: 12 }}>
                  {q.multi
                    ? `Shoppers could pick more than one, so these don't total 100%. Base: ${q.answered}.`
                    : `Base: ${q.answered} shoppers who picked an answer.`}
                </p>
              </>
            )}
          </QzCard>
        ))}
      </div>
      {data.responses.rows.length > 0 ? (
        <>
          <SectionHead
            title="Individual responses"
            sub={`1–${data.responses.rows.length} of ${data.responses.total.toLocaleString()}`}
          />
          <QzCard flush>
            <div style={{ overflowX: "auto" }}>
              <table className="qz-table">
                <thead>
                  <tr>
                    <th>Shopper</th>
                    <th>When</th>
                    {data.answers.map((q) => (
                      <th key={q.questionId}>{q.text.length > 22 ? `${q.text.slice(0, 21)}…` : q.text}</th>
                    ))}
                    <th>Result</th>
                    <th>Bought</th>
                  </tr>
                </thead>
                <tbody>
                  {data.responses.rows.map((r) => (
                    <tr key={r.sessionId}>
                      <td className="qz-mono qz-dim">{r.short}</td>
                      <td style={{ whiteSpace: "nowrap" }} className="qz-dim">{formatDate(r.when)}</td>
                      {data.answers.map((q) => {
                        const a = r.answers.find((x) => x.questionId === q.questionId);
                        return (
                          <td key={q.questionId} className={a ? undefined : "qz-andash"}>
                            {a ? a.text : "—"}
                          </td>
                        );
                      })}
                      <td>{r.result ?? <span className="qz-dim">{r.leftAt ?? "—"}</span>}</td>
                      <td>{r.bought ? "Yes" : <span className="qz-andash">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QzCard>
          <p className="qz-dim" style={{ fontSize: 12, marginTop: 10 }}>
            Includes shoppers who left partway — their row stops where they did. Shopper ids are shortened; the
            export carries the full session and contact details.
          </p>
        </>
      ) : null}

      {data.outcomes.length > 0 ? (
        <>
          <SectionHead title="Where shoppers ended up" sub={`${data.kpis.completed} finishers`} />
          <QzCard>
            {data.outcomes.map((o) => {
              const total = data.outcomes.reduce((acc, x) => acc + x.count, 0);
              return (
                <div key={o.label} className="qz-anopt">
                  <span className="qz-anopt-l">{o.label}</span>
                  <Bar share={total > 0 ? o.count / total : 0} />
                  <span className="qz-anopt-n qz-mono qz-tnum">
                    {o.count} · {total > 0 ? Math.round((o.count / total) * 100) : 0}%
                  </span>
                </div>
              );
            })}
          </QzCard>
        </>
      ) : null}
    </>
  );
}

const PRODUCT_STATE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "crit" | "draft" }> = {
  healthy: { label: "Healthy", tone: "ok" },
  "over-shown": { label: "Over-shown", tone: "warn" },
  "never-clicked": { label: "Never clicked", tone: "warn" },
  unreachable: { label: "Unreachable", tone: "crit" },
  "no-data": { label: "—", tone: "draft" },
};

function ProductsSection({ data }: { data: QuizAnalyticsData }) {
  const [open, setOpen] = useState<string | null>(null);
  if (data.products.length === 0) {
    return <QzEmpty title="No product activity in this range yet — impressions appear once shoppers see recommendations." />;
  }
  const ec = data.effectiveCatalog;
  return (
    <>
      <SectionHead
        title="What your quiz recommends"
        sub={
          ec
            ? `effectively ${ec.effective} of ${ec.mapped} products`
            : data.productMeta
              ? `${data.productMeta.mapped} mapped · ${data.productMeta.unreachable} unreachable`
              : undefined
        }
      />
      <QzCard flush>
        <div style={{ overflowX: "auto" }}>
          <table className="qz-table qz-anprod">
            <thead>
              <tr>
                <th>Product</th>
                <th>Shown</th>
                <th>Share</th>
                <th>Clicks</th>
                <th>Click rate</th>
                <th>Added</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {data.products.map((p) => {
                const st = PRODUCT_STATE_LABEL[p.state] ?? PRODUCT_STATE_LABEL["no-data"]!;
                const expandable = p.paths.length > 0;
                const isOpen = open === p.productId;
                return [
                  <tr
                    key={p.productId}
                    className={expandable ? "qz-anprod-row" : undefined}
                    onClick={expandable ? () => setOpen(isOpen ? null : p.productId) : undefined}
                  >
                    <td className="qz-cell-name">
                      {expandable ? <span className="qz-anprod-caret" aria-hidden>{isOpen ? "▾" : "▸"}</span> : null}
                      {p.title}
                    </td>
                    <td className="qz-mono qz-tnum">{p.impressions || "—"}</td>
                    <td className="qz-mono qz-tnum">{p.share != null && p.impressions > 0 ? `${Math.round(p.share * 100)}%` : "—"}</td>
                    <td className="qz-mono qz-tnum">{p.impressions > 0 ? p.clicks : "—"}</td>
                    <td className="qz-mono qz-tnum">{p.impressions > 0 ? `${(p.ctr * 100).toFixed(1)}%` : "—"}</td>
                    <td className="qz-mono qz-tnum">{p.impressions > 0 ? p.addToCart : "—"}</td>
                    <td><QzBadge tone={st.tone}>{st.label}</QzBadge></td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${p.productId}-paths`} className="qz-anprod-detail">
                      <td colSpan={7}>
                        <div className="qz-anpaths-h">How shoppers reach this product</div>
                        {p.paths.map((path, i) => (
                          <div key={i} className="qz-anpath">
                            <span className="qz-anpath-q">{path.question}</span>
                            <span className="qz-anpath-a">{path.answer}</span>
                            <span aria-hidden>→</span>
                            <span className="qz-anpath-t">{path.target}</span>
                          </div>
                        ))}
                        {p.groupCount > 1 ? (
                          <p className="qz-dim" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
                            It appears in {p.groupCount} of your result groups, which is why its share is so high.
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </QzCard>
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        Click a product to see which answers lead to it. Only products your quiz has shown or mapped appear here.
        <b> Unreachable</b> means the product is mapped but no combination of answers can produce it — read from your
        quiz&rsquo;s own logic, not from traffic. Mid-quiz preview impressions are excluded from every count.
        We can&rsquo;t yet show which products were <i>bought</i>: the order webhook doesn&rsquo;t keep line items.
      </p>
    </>
  );
}

function stepKindLabel(kind: string, i: number, laneLabel: string | null): string {
  if (laneLabel) return `${laneLabel}`;
  switch (kind) {
    case "intro": return "Start";
    case "branch": return "Branch";
    case "email_gate": return "Email gate";
    case "result": return "Result";
    default: return `Question ${i}`;
  }
}

function FlowSection({ data }: { data: QuizAnalyticsData }) {
  const ledger = data.ledger;
  if (!ledger || ledger.steps.length === 0) return <QzEmpty title="No flow to show yet." />;

  let questionNo = 0;
  const nodes = ledger.steps.map((s) => {
    if (s.kind === "question" && !s.laneLabel) questionNo += 1;
    return { step: s, eyebrow: stepKindLabel(s.kind, questionNo, s.laneLabel) };
  });

  return (
    <>
      <SectionHead
        title="How shoppers move through your quiz"
        sub="drop-off is % of who reached each step — a worst-case figure (see How we count this)"
      />

      {/* The diagram: a node per step, the loss stated ON the edge between two
          nodes. A branch is a fork labelled "splits by answer", never a drop —
          routing a shopper is not losing one. */}
      <div className="qz-anflow">
        {nodes.map(({ step, eyebrow }, i) => {
          const next = nodes[i + 1]?.step;
          const showEdge = step.left != null && step.dropoff != null;
          return (
            <div key={step.nodeId} className={step.laneLabel ? "qz-anflow-lane" : undefined}>
              <div
                className={`qz-anflow-node${step.nodeId === ledger.steepestNodeId ? " is-worst" : ""}${step.splits ? " is-branch" : ""}`}
              >
                <div className="qz-anflow-eyebrow">
                  {eyebrow}
                  {step.nodeId === ledger.steepestNodeId ? <b> · steepest drop</b> : null}
                  {step.kind === "email_gate" ? <span className="qz-dim"> · skippable</span> : null}
                </div>
                <div className="qz-anflow-label">{step.label}</div>
                <div className="qz-anflow-n">{step.reached != null ? step.reached.toLocaleString() : "—"}</div>
              </div>
              {step.splits ? (
                <div className="qz-anflow-edge is-split">splits by answer</div>
              ) : showEdge && next ? (
                <div className="qz-anflow-edge">
                  {step.left!.toLocaleString()} left · {(step.dropoff! * 100).toFixed(1)}%
                </div>
              ) : i < nodes.length - 1 ? (
                <div className="qz-anflow-edge is-quiet" aria-hidden />
              ) : null}
            </div>
          );
        })}
      </div>

      <SectionHead title="Step by step" />
      <QzCard flush>
        <div style={{ overflowX: "auto" }}>
          <table className="qz-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Reached</th>
                <th>Continued</th>
                <th>Skipped</th>
                <th>Left</th>
                <th>Drop-off</th>
              </tr>
            </thead>
            <tbody>
              {ledger.steps.map((s) => (
                <tr key={s.nodeId} className={s.nodeId === ledger.steepestNodeId ? "qz-anworst" : ""}>
                  <td className="qz-cell-name">
                    {s.laneLabel ? <span className="qz-dim">{s.laneLabel} · </span> : null}
                    {s.label}
                    {s.splits ? <span className="qz-dim"> · splits by answer</span> : null}
                    {s.nodeId === ledger.steepestNodeId ? <span className="qz-anworst-tag"> steepest drop</span> : null}
                  </td>
                  <td className="qz-mono qz-tnum">{s.reached ?? "—"}</td>
                  <td className="qz-mono qz-tnum">{s.continued ?? "—"}</td>
                  <td className="qz-mono qz-tnum">{s.skipped ?? "—"}</td>
                  <td className="qz-mono qz-tnum">{s.left ?? "—"}</td>
                  <td className="qz-mono qz-tnum">{s.dropoff != null ? `${(s.dropoff * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QzCard>
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        {ledger.branching
          ? "This quiz branches, so per-lane rows show answer counts without cross-lane drop-off claims — a branch split is a route, not abandonment."
          : "Every row adds up: reached = continued + skipped + left."}
      </p>
    </>
  );
}

function cohortLabel(c: string): string {
  return c === "all" ? "All" : c === "purchased" ? "Purchased" : c === "didntBuy" ? "Didn't buy" : c === "noMatch" ? "Saw no match" : "Back-in-stock";
}

function exportSegment(c: string): string {
  return c === "purchased" ? "purchased" : c === "didntBuy" ? "didnt_buy" : c === "backInStock" ? "back_in_stock" : c === "noMatch" ? "no_match" : "all";
}

const CONTACT_STATUS: Record<ContactRow["status"], { label: string; tone: "ok" | "warn" | "draft" }> = {
  bought: { label: "Bought", tone: "ok" },
  abandoned: { label: "Abandoned", tone: "warn" },
  "no-purchase": { label: "No purchase yet", tone: "draft" },
  unknown: { label: "—", tone: "draft" },
};

function CustomersSection({
  data,
  cohort,
  setCohort,
  exportBase,
}: {
  data: QuizAnalyticsData;
  cohort: "all" | "purchased" | "didntBuy" | "noMatch" | "backInStock";
  setCohort: (c: "all" | "purchased" | "didntBuy" | "noMatch" | "backInStock") => void;
  exportBase: string | null;
}) {
  const { counts, rows, filterOptions } = data.contacts;
  const [resultFilter, setResultFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");

  const byCohort =
    cohort === "all"
      ? rows
      : cohort === "purchased"
        ? rows.filter((r) => r.status === "bought")
        : cohort === "didntBuy"
          ? rows.filter((r) => r.status !== "bought")
          : cohort === "noMatch"
            ? rows.filter((r) => r.noMatch)
            : rows.filter((r) => r.backInStock);
  // Result + Recommended narrow ON TOP of the cohort (§06), and the export
  // follows the same scope — what you see is what downloads.
  const filtered = byCohort.filter(
    (r) => (!resultFilter || r.result === resultFilter) && (!productFilter || r.recommended === productFilter),
  );
  const filtersOn = Boolean(resultFilter || productFilter);
  const exportHref = exportBase
    ? `${exportBase}?quiz=${data.quiz.id}&segment=${exportSegment(cohort)}`
    : null;

  return (
    <>
      <div className="qz-antiles">
        <CountTile
          label="Contacts captured"
          value={counts.all}
          hero
          detail={
            data.kpis.completed > 0
              ? `${Math.round((data.kpis.captureSessions / Math.max(1, data.kpis.completed)) * 100)}% of finishers`
              : undefined
          }
        />
        <CountTile
          label="Finished without an email"
          value={counts.noEmail}
          detail={`of ${data.kpis.completed} finishers`}
        />
        <CountTile label="Went on to buy" value={counts.purchased} detail={`of ${counts.all} contacts`} />
        <CountTile label="Back-in-stock requests" value={counts.backInStock} />
      </div>

      <SectionHead title="Contacts" sub={`${filtered.length} of ${counts.all}`} />
      <div className="qz-segpills" style={{ marginBottom: 10 }}>
        {(
          [
            ["all", counts.all],
            ["purchased", counts.purchased],
            ["didntBuy", counts.didntBuy],
            ["noMatch", counts.noMatch],
            ["backInStock", counts.backInStock],
          ] as const
        ).map(([key, n]) => (
          <button
            key={key}
            type="button"
            className={`qz-segpill${cohort === key ? " is-active" : ""}`}
            onClick={() => setCohort(key)}
          >
            {cohortLabel(key)} · {n}
          </button>
        ))}
        {exportHref ? (
          <a className="qz-btn qz-btn-ghost qz-btn-sm" style={{ marginLeft: "auto" }} href={exportHref}>
            Export this cohort (CSV)
          </a>
        ) : null}
      </div>

      <div className="qz-anfilters">
        <label>
          <span className="qz-dim">Result</span>
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} className="qz-anselect">
            <option value="">All results</option>
            {filterOptions.results.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="qz-dim">Recommended</span>
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="qz-anselect">
            <option value="">All products</option>
            {filterOptions.products.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        {filtersOn ? (
          <button
            type="button"
            className="qz-linkbtn"
            onClick={() => {
              setResultFilter("");
              setProductFilter("");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <QzEmpty
          title={
            filtersOn
              ? "No contacts match these filters."
              : "No contacts in this cohort yet — captures land here the moment a shopper submits an email."
          }
        />
      ) : (
        <QzCard flush>
          <div style={{ overflowX: "auto" }}>
            <table className="qz-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Captured</th>
                  <th>Result</th>
                  <th>Recommended</th>
                  <th>Status</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const st = CONTACT_STATUS[c.status];
                  return (
                    <tr key={c.id}>
                      <td className="qz-mono">{c.emailMasked}</td>
                      <td style={{ whiteSpace: "nowrap" }} className="qz-dim">{formatDate(c.capturedAt)}</td>
                      <td>{c.noMatch ? <span className="qz-dim">no match — fallback</span> : c.result ?? <span className="qz-dim">—</span>}</td>
                      <td>
                        {c.recommended ? (
                          <>
                            {c.recommended}
                            {c.recommendedMore > 0 ? <span className="qz-dim"> +{c.recommendedMore}</span> : null}
                          </>
                        ) : (
                          <span className="qz-dim">—</span>
                        )}
                      </td>
                      <td><QzBadge tone={st.tone}>{st.label}</QzBadge></td>
                      <td className="qz-mono qz-tnum">{c.value ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </QzCard>
      )}
      <p className="qz-dim" style={{ fontSize: 12, marginTop: 12 }}>
        Emails are masked on screen to keep the table scannable. Exports include them in full and follow the cohort
        you have selected. Contacts opted in by sharing their details in the quiz.
      </p>
    </>
  );
}

const COMPARE_METRICS = [
  { key: "engaged", label: "Started" },
  { key: "completed", label: "Finished" },
  { key: "completion", label: "Completion" },
  { key: "captures", label: "Contacts" },
  { key: "revenueNumeric", label: "Revenue" },
] as const;

type CompareMetric = (typeof COMPARE_METRICS)[number]["key"];

function CompareSection({ data }: { data: QuizAnalyticsData }) {
  const [metric, setMetric] = useState<CompareMetric>("engaged");
  if (data.months.length === 0) {
    return <QzEmpty title="No monthly history in this range yet — widen the range to compare months." />;
  }
  // Oldest → newest for the chart; the table reads newest first.
  const chron = [...data.months].reverse();
  const valueOf = (m: (typeof data.months)[number]): number | null => {
    if (metric === "completion") return m.engaged >= 20 ? (m.completed / m.engaged) * 100 : null;
    return m[metric] as number;
  };
  const max = Math.max(1, ...chron.map((m) => valueOf(m) ?? 0));

  return (
    <>
      <div className="qz-anhead">
        <h2 className="qz-h1">Metrics by month</h2>
        <div className="qz-anseg" role="group" aria-label="Metric">
          {COMPARE_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={metric === m.key ? "is-on" : ""}
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <QzCard flush>
        <div className="qz-anchart">
          {chron.map((m) => {
            const v = valueOf(m);
            return (
              <div key={m.key} className="qz-anbucket">
                <div className="qz-anbucket-col" role="presentation">
                  <span
                    className={`qz-anbucket-fill${m.partial ? " is-partial" : ""}`}
                    style={{ height: `${Math.max(3, Math.round(((v ?? 0) / max) * 100))}%` }}
                    title={v == null ? "too few sessions to rate" : String(Math.round(v))}
                  />
                </div>
                <div className="qz-anbucket-l">{m.label.replace(" ", "\u00a0")}</div>
              </div>
            );
          })}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="qz-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Completion</th>
                <th>Contacts</th>
                <th>Orders</th>
                <th>Revenue</th>
                <th>Per finisher</th>
              </tr>
            </thead>
            <tbody>
              {data.months.map((m) => (
                <tr key={m.key}>
                  <td className="qz-cell-name">
                    {m.label}
                    {m.partial ? <span className="qz-dim"> · partial</span> : null}
                  </td>
                  <td className="qz-mono qz-tnum">{m.engaged}</td>
                  <td className="qz-mono qz-tnum">{m.completed}</td>
                  <td className="qz-mono qz-tnum">
                    {m.engaged >= 20 ? `${Math.round((m.completed / m.engaged) * 100)}%` : <span className="qz-andash">—</span>}
                  </td>
                  <td className="qz-mono qz-tnum">{m.captures}</td>
                  <td className="qz-mono qz-tnum">{m.orders}</td>
                  <td className="qz-mono qz-tnum">{m.revenue}</td>
                  <td className="qz-mono qz-tnum">{m.perFinisher ?? <span className="qz-andash">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QzCard>
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        Rates are recomputed per month, never averaged across them — averaging rates weights a quiet month the same
        as a busy one. The current month is partial and carries no change figure; a month under 20 sessions shows
        counts only.
      </p>
    </>
  );
}

function AbSection({ abTests }: { abTests: QuizAnalyticsData["abTests"] }) {
  return (
    <>
      <SectionHead title="A/B variants" />
      <div className="qz-col qz-gap-16">
        {abTests.map((t) => (
          <QzCard key={t.id} flush>
            <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--qz-rule)", fontWeight: 600 }}>{t.label}</div>
            <table className="qz-table">
              <thead>
                <tr>
                  <th>Variant</th>
                  <th>Split</th>
                  <th>Entered</th>
                  <th>Completed</th>
                  <th>Clicked</th>
                </tr>
              </thead>
              <tbody>
                {t.slots.map((s) => (
                  <tr key={s.id}>
                    <td className="qz-cell-name">{s.label}</td>
                    <td className="qz-mono qz-dim">{s.share}%</td>
                    <td className="qz-mono qz-tnum">{s.funnel.entered}</td>
                    <td className="qz-mono qz-tnum">
                      {s.funnel.completed}
                      {s.funnel.entered >= 150 ? ` · ${Math.round((s.funnel.completed / s.funnel.entered) * 100)}%` : ""}
                    </td>
                    <td className="qz-mono qz-tnum">{s.funnel.clicked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QzCard>
        ))}
      </div>
    </>
  );
}
