// The Analytics Overview — every quiz, drafts included (ANALYTICS-HANDOFF.md
// "Analytics Overview (all quizzes)"). Both admin surfaces mount it over the
// SAME seam (shopAnalyticsForShop). The first card's figures are the totals of
// the live rows; Compare splits it into this period and the previous one.

import { useMemo, useState } from "react";
import { useNavigate } from "@remix-run/react";
import type { ShopAnalyticsData, ShopQuizRow } from "../../lib/quizAnalytics.server";
import type { InsightCard } from "../../lib/quizInsights";
import { gateRate } from "../../lib/analyticsConfidence";
import {
  AnContext,
  c,
  Cut,
  DASH,
  downloadCsv,
  ExportBtn,
  Fig,
  Icon,
  Lead,
  LeadK,
  money,
  num,
  pct1,
  Rate,
  rateText,
  TipLayer,
  type AnCtx,
} from "./an/kit";
import { Dock, Insights, RangeBar, useToast, type RangeBarProps } from "./an/chrome";
import { SplitCompare } from "./an/OverviewRevenue";
import { chgPct, chgPts } from "./an/kit";

type SortKey = "name" | "status" | "starts" | "rate" | "contacts" | "orders" | "rev" | "rpf";

export function AnalyticsHomeView({
  data,
  quizHref,
  analyticsHref,
}: {
  data: ShopAnalyticsData;
  /** A quiz in the builder (drafts open there). */
  quizHref: (id: string) => string;
  /** A live quiz's analytics. */
  analyticsHref: (id: string) => string;
  createHref?: string;
  exportBase?: string | null;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState<"all" | "live" | "draft">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(["rev", -1]);
  const t = data.tiles;
  const noRev = data.attribution === "none";
  const cur = data.currency;
  const P = data.compare ? t.prior : null;

  const ctx: AnCtx = useMemo(
    () => ({
      surface: "studio",
      currency: cur,
      compare: Boolean(P),
      openPanel: () => undefined,
      say: toast.say,
      tabHref: () => "?",
      builderHref: "",
      openMethod: () => undefined,
      exportServer: () => undefined,
    }),
    [cur, P, toast.say],
  );

  const barProps: RangeBarProps = {
    range: { preset: data.range.preset, from: data.range.from, to: data.range.to, widened: false },
    canCompare: true,
    compare: data.compare,
    prev: P && data.range.from ? prevDates(data.range.from, data.range.to) : null,
  };
  const bar = <RangeBar {...barProps} />;
  const comp = t.completion;

  const top = P ? (
    <SplitCompare
      bar={bar}
      dates={[data.range.from ?? data.range.to, data.range.to, barProps.prev?.from ?? "", barProps.prev?.to ?? ""]}
      big={[
        <Rate key="c" g={comp} unit="sessions" />,
        <Rate key="p" g={gateRate("completion_rate", P.finished, P.starts)} unit="sessions" />,
        "completion rate",
        chgPts(comp.rate, P.starts ? P.finished / P.starts : 0),
      ]}
      rows={[
        ["Started", t.sessions, P.starts, null],
        ["Finished", t.finished, P.finished, null],
        ["Left an email", t.contacts, P.contacts, null],
      ]}
      base={[t.sessions, P.starts]}
      extra={noRev ? null : ["Revenue influenced", money(t.revenueNumeric, cur, 0), money(P.revenueNumeric, cur, 0), chgPct(t.revenueNumeric, P.revenueNumeric), null]}
      foot={<span>Across your {t.liveQuizzes} live quiz{t.liveQuizzes === 1 ? "" : "zes"}. Open a quiz below to compare it month by month.</span>}
    />
  ) : (
    <Lead
      aria="All quizzes"
      bar={bar}
      main={
        <LeadK eyebrow="Quiz sessions" tip={`Across ${t.liveQuizzes} live quiz${t.liveQuizzes === 1 ? "" : "zes"} ${data.range.preset === "all" ? "since they went live" : data.range.preset === "custom" ? "in this range" : `in the ${data.range.label.toLowerCase()}`}.`}>
          <p className={c("lead-n")}>{num(t.sessions)}</p>
        </LeadK>
      }
      side={
        <div className={c("figs")}>
          <Fig
            value={<Rate g={comp} unit="sessions" />}
            long={false}
            label="Completion rate"
            tip={comp.state !== "confident" && comp.n ? `${num(t.finished)} finished · ${rateText(comp)} rests on ${num(comp.n)} sessions` : `${num(t.finished)} finished`}
          />
          <Fig
            value={num(t.contacts)}
            label="Contacts captured"
            tip={t.finished ? `${rateText(t.captureOfFinishers)} of completions` : "no completions yet"}
          />
          {noRev ? (
            <Fig value="Not measurable" label="Revenue influenced" tip="No Shopify order feed on this workspace." word />
          ) : (
            <Fig
              value={money(t.revenueNumeric, cur, 0)}
              label="Revenue influenced"
              tip={`${num(t.orders)} orders${t.perFinisher ? ` · ${t.finished ? money(t.revenueNumeric / t.finished, cur) : ""} per completion` : ""}`}
            />
          )}
        </div>
      }
    />
  );

  const val: Record<SortKey, (r: ShopQuizRow) => number | string | null> = {
    name: (r) => r.name.toLowerCase(),
    status: (r) => (r.live ? 1 : 0),
    starts: (r) => r.starts,
    rate: (r) => (r.live && r.completion && r.completion.n ? r.completion.rate : null),
    contacts: (r) => r.contacts,
    orders: (r) => r.orders,
    rev: (r) => r.revenueNumeric,
    rpf: (r) => r.perFinisherNumeric,
  };
  const q = query.trim().toLowerCase();
  const vis = data.rows
    .filter((r) => (status === "all" || (status === "live") === r.live) && (!q || r.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = val[sort[0]](a);
      const y = val[sort[0]](b);
      if (x == null && y == null) return a.name.localeCompare(b.name);
      if (x == null) return 1;
      if (y == null) return -1;
      return x < y ? -sort[1] : x > y ? sort[1] : a.name.localeCompare(b.name);
    });
  const th = (k: SortKey, label: string, r?: boolean) => (
    <th className={r ? c("r") : undefined} aria-sort={sort[0] === k ? (sort[1] === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort((s) => (s[0] === k ? [k, (-s[1]) as 1 | -1] : [k, k === "name" ? 1 : -1]))}>
        {label}
      </button>
    </th>
  );
  const go = (r: ShopQuizRow) => navigate(r.live ? analyticsHref(r.id) : quizHref(r.id));
  const dash = <td className={c("r none")}>—</td>;
  const exportRows = () =>
    downloadCsv("quizzes.csv", [
      ["Quiz", "Status", "Starts", "Completion", "Contacts", "Orders", "Revenue", "Per completion"],
      ...vis.map((r) => [
        r.name,
        r.live ? "Live" : "Draft",
        r.starts ?? "",
        r.completion && r.completion.n ? pct1(r.completion.rate) : "",
        r.contacts ?? "",
        r.orders ?? "",
        r.revenueNumeric != null ? r.revenueNumeric.toFixed(2) : "",
        r.perFinisherNumeric != null ? r.perFinisherNumeric.toFixed(2) : "",
      ]),
    ]);
  const table = (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <h2>Quizzes</h2>
        <div className={c("ctl")}>
          <div className={c("seg")} role="group" aria-label="Filter by status">
            {(
              [
                ["all", "All", data.counts.all],
                ["live", "Live", data.counts.live],
                ["draft", "Draft", data.counts.draft],
              ] as const
            ).map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
                {label} <b>{n}</b>
              </button>
            ))}
          </div>
          <label className={c("search")}>
            <Icon name="search" />
            <input type="search" placeholder="Search quizzes" aria-label="Search quizzes" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ExportBtn onClick={exportRows} />
        </div>
      </div>
      <div className={c("twrap")}>
        <table>
          <thead>
            <tr>
              {th("name", "Quiz")}
              {th("status", "Status")}
              {th("starts", "Starts", true)}
              {th("rate", "Completion", true)}
              {th("contacts", "Contacts", true)}
              {th("orders", "Orders", true)}
              {th("rev", "Revenue", true)}
              {th("rpf", "Per completion", true)}
              <th>
                <span className={c("sr")}>Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {vis.length ? (
              vis.map((r) => (
                <tr
                  key={r.id}
                  className={c("go")}
                  onClick={() => go(r)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") go(r);
                  }}
                >
                  <td>
                    <span className={c("qlink")}>
                      <Cut w={280}>{r.name}</Cut>
                    </span>
                  </td>
                  <td>
                    {r.live ? (
                      <span className={c("tag is-live")}>Live</span>
                    ) : r.flag ? (
                      <span className={c("tag is-warn")}>{r.flag}</span>
                    ) : (
                      <span className={c("tag is-draft")}>Draft</span>
                    )}
                  </td>
                  {r.live ? (
                    <>
                      <td className={c("r")}>{num(r.starts ?? 0)}</td>
                      <td className={c("r")}>{r.completion ? <Rate g={r.completion} unit="sessions" /> : DASH}</td>
                      <td className={c("r")}>{num(r.contacts ?? 0)}</td>
                      {noRev ? (
                        <>
                          {dash}
                          {dash}
                          {dash}
                        </>
                      ) : (
                        <>
                          <td className={c("r")}>{num(r.orders ?? 0)}</td>
                          <td className={c("r")}>{money(r.revenueNumeric ?? 0, cur)}</td>
                          <td className={c("r")}>{r.perFinisherNumeric != null ? money(r.perFinisherNumeric, cur) : "—"}</td>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {dash}
                      {dash}
                      {dash}
                      {dash}
                      {dash}
                      {dash}
                    </>
                  )}
                  <td className={c("r")}>
                    {r.live ? (
                      <span className={c("rv")}>
                        Review <Icon name="right" />
                      </span>
                    ) : (
                      <span className={c("rv is-quiet")}>
                        Edit <Icon name="right" />
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: 26, color: "var(--an-ink4)" }}>
                  No quizzes match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );

  // Findings across the shop, each headline starting with the quiz name.
  const items = data.findings.map((f) => ({
    quizId: f.quizId,
    quizName: f.quizName,
    card: {
      id: f.cardId,
      tier: "A",
      severity: f.severity,
      headline: f.headline,
      body: f.body,
      evidence: f.evidence,
      basis: f.basis,
      action: { label: "Open the quiz", kind: "builder" },
      excess: 0,
    } satisfies InsightCard,
  }));
  const shownItems = items.slice(0, 3);

  return (
    <AnContext.Provider value={ctx}>
      <div className="an">
        <header className={c("card head")}>
          <div className={c("head-top")}>
            <div className={c("head-id")}>
              <div className={c("head-title")}>
                <h1>Analytics Overview</h1>
              </div>
            </div>
          </div>
        </header>
        <div className={c("view")}>
          {top}
          {table}
          <Insights
            items={shownItems}
            more={items.length - shownItems.length}
            onAction={(card) => {
              const it = items.find((x) => x.card.id === card.id);
              if (it) navigate(quizHref(it.quizId));
            }}
            cleanNote="Every quiz's logic came back clean."
          />
        </div>
        <Dock title="Analytics Overview" bar={barProps} />
        <TipLayer />
        {toast.node}
      </div>
    </AnContext.Provider>
  );
}

/** The window before [from, to] of the same length, as the server counts it. */
function prevDates(from: string, to: string): { from: string; to: string } {
  const f = Date.parse(from);
  const span = Date.parse(to) - f;
  return { from: new Date(f - span).toISOString(), to: new Date(f - 1).toISOString() };
}
