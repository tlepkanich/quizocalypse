// One quiz's analytics (ANALYTICS-HANDOFF.md; mock: docs/design/analytics/
// analytics-main.html). Both admin surfaces mount this view over the SAME
// server seam (quizAnalyticsForShop); nothing here may grow surface-specific
// logic beyond the hrefs below.
//
// Layout: a one-line header card, seven full-width folder tabs joined to the
// first card, the date range on that first card (with Compare where a tab has
// something to compare), and a slim bar that follows the reader once the
// range scrolls away. Every number that names a group of shoppers opens the
// contacts panel on exactly that group.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "@remix-run/react";
import type { QuizAnalyticsData } from "../../lib/quizAnalytics.server";
import { AnContext, c, Icon, num, saveBlob, TipLayer, type AnCtx, type AnalyticsSurface, type Facet } from "./an/kit";
import { Dock, MethodDrawer, RangeBar, useToast, type RangeBarProps } from "./an/chrome";
import { ContactsPanel } from "./an/ContactsPanel";
import { OverviewTab, RevenueTab } from "./an/OverviewRevenue";
import { AnswersTab, ProductsTab } from "./an/AnswersProducts";
import { FlowTab } from "./an/FlowTab";
import { CompareTab, CustomersTab } from "./an/CustomersCompare";

export type { AnalyticsSurface };

export const TABS = [
  ["overview", "Overview"],
  ["revenue", "Revenue"],
  ["answers", "Questions & Answers"],
  ["products", "Products"],
  ["flow", "Quiz flow"],
  ["customers", "Customers"],
  ["compare", "Compare"],
] as const;
export type TabKey = (typeof TABS)[number][0];

/** Compare appears on these screens only (handoff "Date range and Compare"). */
const CMP_TABS = new Set<TabKey>(["overview", "revenue", "answers", "flow", "customers"]);

export function analyticsHrefs(surface: AnalyticsSurface, quizId: string) {
  return surface === "studio"
    ? {
        home: "/studio/analytics",
        builder: `/studio/${quizId}`,
        contacts: `/studio/${quizId}/analytics/contacts`,
        integrations: "/studio/integrations",
      }
    : {
        home: "/app/analytics",
        builder: `/app/quizzes/${quizId}/studio`,
        contacts: `/app/quizzes/${quizId}/analytics/contacts`,
        integrations: "/app/integrations",
      };
}

export function QuizAnalyticsView({
  data,
  surface,
}: {
  data: QuizAnalyticsData;
  surface: AnalyticsSurface;
  /** Kept for the routes' call sites; exports now come from the contacts route. */
  exportBase?: string | null;
}) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const raw = sp.get("s");
  const tab: TabKey = (TABS.some(([k]) => k === raw) ? raw : "overview") as TabKey;
  const hrefs = analyticsHrefs(surface, data.quiz.id);
  const [panel, setPanel] = useState<{ facet: Facet; n: number } | null>(null);
  const [method, setMethod] = useState(false);
  const toast = useToast();
  const say = toast.say;

  const tabHref = useCallback(
    (t: string, extra?: Record<string, string>) => {
      const next = new URLSearchParams(sp);
      next.delete("pf");
      next.delete("cohort");
      if (t === "overview") next.delete("s");
      else next.set("s", t);
      for (const [k, v] of Object.entries(extra ?? {})) next.set(k, v);
      const q = next.toString();
      return q ? `?${q}` : "?";
    },
    [sp],
  );
  const exportServer = useCallback(
    async (section: "contacts" | "responses", extra?: Record<string, string>) => {
      const q = new URLSearchParams();
      for (const k of ["r", "from", "to"]) {
        const v = sp.get(k);
        if (v) q.set(k, v);
      }
      q.set("format", "csv");
      q.set("section", section);
      for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
      try {
        const r = await fetch(`${hrefs.contacts}?${q.toString()}`);
        if (!r.ok) throw new Error();
        saveBlob(`${section}-${new Date().toISOString().slice(0, 10)}.csv`, await r.blob());
      } catch {
        say("The export didn't download. Try again in a moment.");
      }
    },
    [sp, hrefs.contacts, say],
  );

  const ctx: AnCtx = useMemo(
    () => ({
      surface,
      currency: data.currency,
      compare: data.compare && Boolean(data.kpis.prior) && CMP_TABS.has(tab),
      openPanel: (f) => setPanel((p) => ({ facet: f, n: (p?.n ?? 0) + 1 })),
      say,
      tabHref,
      builderHref: hrefs.builder,
      openMethod: () => setMethod(true),
      exportServer: (s, x) => void exportServer(s, x),
    }),
    [surface, data.currency, data.compare, data.kpis.prior, tab, say, tabHref, hrefs.builder, exportServer],
  );

  const barProps: RangeBarProps = {
    range: { preset: data.range.preset, from: data.range.from, to: data.range.to, widened: data.range.widened },
    canCompare: CMP_TABS.has(tab),
    compare: data.compare,
    prev: data.kpis.prior ? { from: data.kpis.prior.from, to: data.kpis.prior.to } : null,
  };
  const bar = <RangeBar {...barProps} />;
  const label = TABS.find(([k]) => k === tab)![1];

  let view: ReactNode;
  switch (tab) {
    case "revenue":
      view = <RevenueTab data={data} bar={bar} />;
      break;
    case "answers":
      view = <AnswersTab data={data} bar={bar} />;
      break;
    case "products":
      view = <ProductsTab data={data} bar={bar} />;
      break;
    case "flow":
      view = <FlowTab data={data} bar={bar} />;
      break;
    case "customers":
      view = <CustomersTab data={data} bar={bar} contactsBase={hrefs.contacts} />;
      break;
    case "compare":
      view = <CompareTab data={data} bar={bar} />;
      break;
    default:
      view = <OverviewTab data={data} bar={bar} onInsight={(to) => navigate(to)} />;
  }

  const live = data.quiz.status === "published";
  return (
    <AnContext.Provider value={ctx}>
      <div className={["an", c("quiz")].join(" ")}>
        <header className={c("card head")}>
          <div className={c("head-top")}>
            <div className={c("head-id")}>
              <nav className={c("crumb")} aria-label="Breadcrumb">
                <Link className={c("lnk is-quiet")} to={hrefs.home}>
                  Analytics
                </Link>
                <Icon name="right" />
                <h1>{data.quiz.name}</h1>
                <span className={c("tag", live ? "is-live" : "is-draft")}>{live ? "Live" : "Draft"}</span>
              </nav>
            </div>
            <div className={c("head-ctl")}>
              <button type="button" className={c("lnk is-quiet")} onClick={() => setMethod(true)}>
                How we count this
              </button>
              <Link className={c("btn btn-sm btn-quiet")} to={hrefs.builder}>
                Open in builder
              </Link>
            </div>
          </div>
        </header>
        {data.truncated ? (
          <p className={c("card notice")}>
            This range holds more sessions than one page reads at once, so the figures cover the most recent 5,000.
            Pick a shorter range for exact totals.
          </p>
        ) : null}
        <nav className={c("strip is-folder")} aria-label="Analytics sections">
          {TABS.map(([k, l]) => (
            <Link key={k} className={c("ftab")} to={tabHref(k)} aria-current={tab === k ? "page" : undefined} preventScrollReset>
              {l}
              {k === "customers" && data.contacts.counts.all ? <b>{num(data.contacts.counts.all)}</b> : null}
            </Link>
          ))}
        </nav>
        <div className={c("view")}>{view}</div>
        <Dock title={`${data.quiz.name} · ${label}`} bar={barProps} />
        <TipLayer />
        {toast.node}
        {panel ? (
          <ContactsPanel
            key={panel.n}
            base={hrefs.contacts}
            initial={panel.facet}
            klaviyoConnected={data.klaviyoConnected}
            integrationsHref={hrefs.integrations}
            onClose={() => setPanel(null)}
            say={say}
          />
        ) : null}
        {method ? <MethodDrawer onClose={() => setMethod(false)} /> : null}
      </div>
    </AnContext.Provider>
  );
}
