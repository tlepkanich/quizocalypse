// ANALYTICS P0 — the ONE per-quiz analytics view (spec Screen 2/3). Both admin
// surfaces mount this component over quizAnalyticsForShop() data, and it is
// the same view the Main Builder will host — so it is pure props + URL state,
// with zero surface-specific imports. Sections are URL-driven (?s=…) so links
// share; the range is ?r= (server-resolved).
//
// Honesty contract carried in the markup: a suppressed rate never renders "—"
// alone or a fake 0.0% — it states its threshold and progress (§7.3.1). Every
// count states its denominator.

import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "@remix-run/react";
import { QzCard, QzBadge, QzEmpty } from "../qz";
import { QzDrawer, QzMenu } from "../qz-overlays";
import { formatPct, formatPctRange, type GatedRate } from "../../lib/analyticsConfidence";
import type { QuizAnalyticsData, ContactRow, RangePreset } from "../../lib/quizAnalytics.server";
import type { InsightCard } from "../../lib/quizInsights";
import { formatDate } from "../../lib/formatDate";

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

const RANGE_PRESETS: Array<{ value: RangePreset; label: string }> = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "all", label: "Since published" },
];

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

function rangeSearch(searchParams: URLSearchParams, r: RangePreset): string {
  const next = new URLSearchParams(searchParams);
  next.set("r", r);
  next.delete("from");
  next.delete("to");
  return `?${next.toString()}`;
}

// ── Small pieces ───────────────────────────────────────────────────────────

export function GatedTile({
  label,
  gated,
  detail,
  hero,
  unit,
}: {
  label: ReactNode;
  gated: GatedRate;
  /** Sub-line for the confident state ("742 of 1,047 who started"). */
  detail?: ReactNode;
  hero?: boolean;
  unit: string;
}) {
  if (gated.state === "suppressed") {
    const pct = Math.min(100, Math.round((gated.n / gated.showsAt) * 100));
    return (
      <div className={`qz-antile is-gated${hero ? " is-hero" : ""}`}>
        <div className="l">{label}</div>
        <div className="qz-antile-gate">
          <div className="g">Unlocks at {gated.showsAt} {unit}</div>
          <div className="qz-antile-bar" role="presentation">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="g2">{gated.n} so far</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`qz-antile${hero ? " is-hero" : ""}`}>
      <div className="n">{gated.state === "provisional" ? formatPctRange(gated.interval) : formatPct(gated.rate)}</div>
      <div className="l">{label}</div>
      {gated.state === "provisional" ? (
        <div className="d">a range until {gated.confidentAt} {unit} — {gated.n} so far</div>
      ) : detail ? (
        <div className="d">{detail}</div>
      ) : null}
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
}: {
  severity: InsightCard["severity"];
  headline: string;
  body: string;
  evidence: Array<{ label: string; value: string }>;
  basis: string;
  action?: { label: string; href: string } | null;
}) {
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
      <div className="qz-insight-foot">
        <span className="qz-insight-basis">{basis}</span>
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

// ── Method drawer copy (ships verbatim from the spec) ──────────────────────

function MethodDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <QzDrawer open={open} onClose={onClose} title="How we count this">
      <div className="qz-col qz-gap-16" style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <p style={{ margin: 0 }}>
          Every number here comes from shoppers who actually used your quiz. Nothing is modelled or adjusted.
        </p>
        <div>
          <h3 className="qz-h2" style={{ marginBottom: 6 }}>Why this won&rsquo;t match Shopify</h3>
          <p style={{ margin: 0 }}>
            Shopify credits the last marketing click a shopper made, looking back 30 days. We credit a completed
            quiz, looking back 7. Both are right — they answer different questions. Klaviyo, Meta and Google each
            use their own model too, so adding them together counts the same order several times.
          </p>
        </div>
        <div>
          <h3 className="qz-h2" style={{ marginBottom: 6 }}>What &ldquo;reached&rdquo; means</h3>
          <p style={{ margin: 0 }}>
            We know a shopper reached a question because they answered it. So someone who saw a question and left
            without answering isn&rsquo;t counted as having reached it — which makes drop-off a worst-case figure,
            not an exact one. We say so rather than round it away.
          </p>
        </div>
        <div>
          <h3 className="qz-h2" style={{ marginBottom: 6 }}>What we can&rsquo;t see</h3>
          <p style={{ margin: 0 }}>
            Purchases on another device or in a private window. Orders placed after the window closes. Orders
            awaiting payment aren&rsquo;t counted.
          </p>
        </div>
      </div>
    </QzDrawer>
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
  const [customOpen, setCustomOpen] = useState(data.range.preset === "custom");
  const [cohort, setCohort] = useState<"all" | "purchased" | "didntBuy" | "noMatch" | "backInStock">("all");

  const { kpis, dataState } = data;

  // ── Control bar ──────────────────────────────────────────────────────────
  const controlBar = (
    <div className="qz-anbar-row">
      <QzMenu
        trigger={
          <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm">
            {data.range.label} ▾
          </button>
        }
        items={[
          ...RANGE_PRESETS.map((p) => ({
            label: p.label,
            onSelect: () => {
              window.location.search = rangeSearch(searchParams, p.value);
            },
          })),
          { label: "Custom range…", onSelect: () => setCustomOpen(true) },
        ]}
      />
      <span className="qz-dim" style={{ fontSize: 12 }}>
        {data.range.from ? `${formatDate(data.range.from)} – ${formatDate(data.range.to)}` : "All activity"}
        {data.range.widened ? " · widened — too little data in the last 90 days" : ""}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        {exportBase ? (
          <QzMenu
            trigger={
              <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm">
                Export ▾
              </button>
            }
            items={[
              {
                label: `Contacts .csv (${cohortLabel(cohort)})`,
                onSelect: () => {
                  window.location.href = `${exportBase}?quiz=${data.quiz.id}&segment=${exportSegment(cohort)}`;
                },
              },
            ]}
          />
        ) : null}
        <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={() => setMethodOpen(true)}>
          How we count this
        </button>
      </span>
    </div>
  );

  const customRange = customOpen ? (
    <form method="get" className="qz-row" style={{ gap: 8, alignItems: "center", fontSize: 12, marginBottom: 14 }}>
      <input type="hidden" name="r" value="custom" />
      {section !== "overview" ? <input type="hidden" name="s" value={section} /> : null}
      <span className="qz-dim">From</span>
      <input type="date" name="from" defaultValue={data.range.from ? data.range.from.slice(0, 10) : ""} className="qz-andate" />
      <span className="qz-dim">to</span>
      <input type="date" name="to" defaultValue={data.range.to.slice(0, 10)} className="qz-andate" />
      <button type="submit" className="qz-btn qz-btn-ghost qz-btn-sm">Apply this range</button>
    </form>
  ) : null;

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
      {customRange}
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
              label={<>Completion rate</>}
              gated={kpis.completion}
              unit="sessions"
              hero
              detail={`${kpis.completed} of ${kpis.engaged} who started`}
            />
            <CountTile label="Reached recommendations" value={kpis.completed} detail={`of ${kpis.engaged} who started`} />
            <GatedTile
              label="Email capture"
              gated={kpis.capture}
              unit="finishers"
              detail={`${kpis.captureSessions} of ${kpis.completed} finished`}
            />
            {data.attribution === "none" ? (
              <div className="qz-antile is-gated">
                <div className="l">Revenue influenced</div>
                <div className="qz-antile-gate">
                  <div className="g">Not measurable</div>
                  <div className="g2">No Shopify order feed on this workspace.</div>
                </div>
              </div>
            ) : (
              <CountTile
                label="Revenue influenced"
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
          action={{ label: card.action.label, href: insightHref(card, surface, data.quiz.id, searchParams) }}
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

function RevenueSection({ data, onMethod }: { data: QuizAnalyticsData; onMethod: () => void }) {
  const { kpis } = data;
  if (data.attribution === "none") {
    return (
      <QzEmpty title="Order attribution isn't measurable on this workspace — there is no Shopify order feed to read." />
    );
  }
  const maxWeek = Math.max(1, ...data.revenueWeeks.map((w) => w.total));
  return (
    <>
      <div className="qz-antiles">
        <CountTile label="Order value influenced" value={kpis.revenue.formatted} hero detail={`${data.range.label.toLowerCase()}`} />
        <CountTile label="Attributed orders" value={kpis.revenue.orders} detail={`of ${kpis.completed} finishers`} />
        <GatedTile label="Finishers who bought" gated={kpis.conversion} unit="finishers" />
        <CountTile label="Revenue per finisher" value={kpis.revenue.perFinisher ?? "—"} detail={kpis.revenue.perFinisher ? `${kpis.revenue.formatted} ÷ ${kpis.completed}` : "needs a single currency"} />
      </div>
      {data.revenueWeeks.length > 0 ? (
        <>
          <SectionHead title="Revenue by week" />
          <QzCard flush>
            <div className="qz-anweeks">
              {data.revenueWeeks.map((w) => (
                <div key={w.label} className="qz-anweek">
                  <div className="qz-anweek-col" role="presentation">
                    <span style={{ height: `${Math.max(4, Math.round((w.total / maxWeek) * 100))}%` }} />
                  </div>
                  <div className="qz-anweek-l">{w.label}</div>
                </div>
              ))}
            </div>
            <table className="qz-table">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th>Orders</th>
                  <th>Order value</th>
                </tr>
              </thead>
              <tbody>
                {data.revenueWeeks.map((w) => (
                  <tr key={w.label}>
                    <td>{w.label}</td>
                    <td className="qz-mono qz-tnum">{w.orders}</td>
                    <td className="qz-mono qz-tnum">
                      {w.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      {w.currency ? ` ${w.currency}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </QzCard>
        </>
      ) : (
        <QzEmpty title="No attributed orders in this range yet." />
      )}
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        These are whole order totals, not just the products we recommended.{" "}
        <button type="button" className="qz-link" style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }} onClick={onMethod}>
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
  if (data.products.length === 0) {
    return <QzEmpty title="No product activity in this range yet — impressions appear once shoppers see recommendations." />;
  }
  return (
    <>
      <SectionHead
        title="What your quiz recommends"
        sub={data.productMeta ? `${data.productMeta.mapped} mapped products · ${data.productMeta.unreachable} unreachable` : undefined}
      />
      <QzCard flush>
        <div style={{ overflowX: "auto" }}>
          <table className="qz-table">
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
                return (
                  <tr key={p.productId}>
                    <td className="qz-cell-name">{p.title}</td>
                    <td className="qz-mono qz-tnum">{p.impressions}</td>
                    <td className="qz-mono qz-tnum">{p.share != null ? `${Math.round(p.share * 100)}%` : "—"}</td>
                    <td className="qz-mono qz-tnum">{p.clicks}</td>
                    <td className="qz-mono qz-tnum">{p.impressions > 0 ? `${(p.ctr * 100).toFixed(1)}%` : "—"}</td>
                    <td className="qz-mono qz-tnum">{p.addToCart}</td>
                    <td><QzBadge tone={st.tone}>{st.label}</QzBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </QzCard>
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        Only products your quiz has shown (or mapped) appear here. <b>Unreachable</b> means the product is
        mapped but no combination of answers can produce it — read from your quiz&rsquo;s own logic, not from
        traffic. Mid-quiz preview impressions are excluded from every count.
      </p>
    </>
  );
}

function FlowSection({ data }: { data: QuizAnalyticsData }) {
  const ledger = data.ledger;
  if (!ledger || ledger.steps.length === 0) return <QzEmpty title="No flow to show yet." />;
  return (
    <>
      <SectionHead
        title="How shoppers move through your quiz"
        sub="drop-off is % of who reached each step — a worst-case figure (see How we count this)"
      />
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
  const { counts, rows } = data.contacts;
  const filtered =
    cohort === "all"
      ? rows
      : cohort === "purchased"
        ? rows.filter((r) => r.status === "bought")
        : cohort === "didntBuy"
          ? rows.filter((r) => r.status !== "bought")
          : cohort === "noMatch"
            ? rows.filter((r) => r.noMatch)
            : rows.filter((r) => r.backInStock);
  return (
    <>
      <div className="qz-antiles">
        <CountTile
          label="Contacts captured"
          value={counts.all}
          hero
          detail={data.kpis.completed > 0 ? `${Math.round((data.kpis.captureSessions / Math.max(1, data.kpis.completed)) * 100)}% of finishers` : undefined}
        />
        <CountTile label="Went on to buy" value={counts.purchased} detail={`of ${counts.all} contacts`} />
        <CountTile label="Saw no match" value={counts.noMatch} detail="finished, gave an email, got fallback products" />
        <CountTile label="Back-in-stock requests" value={counts.backInStock} />
      </div>

      <SectionHead title="Contacts" sub={`${filtered.length} of ${counts.all}`} />
      <div className="qz-segpills" style={{ marginBottom: 14 }}>
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
        {exportBase ? (
          <a className="qz-btn qz-btn-ghost qz-btn-sm" style={{ marginLeft: "auto" }} href={`${exportBase}?quiz=${data.quiz.id}&segment=${exportSegment(cohort)}`}>
            Export this cohort (CSV)
          </a>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <QzEmpty title="No contacts in this cohort yet — captures land here the moment a shopper submits an email." />
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
        Emails are masked on screen to keep the table scannable. Exports include them in full. Contacts opted
        in by sharing their details in the quiz.
      </p>
    </>
  );
}

function CompareSection({ data }: { data: QuizAnalyticsData }) {
  if (data.months.length === 0) return <QzEmpty title="No monthly history in this range yet — widen the range to compare months." />;
  return (
    <>
      <SectionHead title="Metrics by month" sub="rates are recomputed per month, never averaged across months" />
      <QzCard flush>
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
                    {m.engaged >= 20 ? `${Math.round((m.completed / m.engaged) * 100)}%` : "—"}
                  </td>
                  <td className="qz-mono qz-tnum">{m.captures}</td>
                  <td className="qz-mono qz-tnum">{m.orders}</td>
                  <td className="qz-mono qz-tnum">{m.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QzCard>
      <p className="qz-dim" style={{ fontSize: 12.5, marginTop: 12 }}>
        The current month is partial and carries no change figure. A month under 20 sessions shows counts only.
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
