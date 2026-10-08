// Customers and Compare (ANALYTICS-HANDOFF.md "The screens").

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "@remix-run/react";
import type { QuizAnalyticsData } from "../../../lib/quizAnalytics.server";
import type { ContactsPanelData } from "../../../lib/quizContacts.server";
import {
  c,
  Chart,
  Cut,
  DASH,
  Delta,
  dmy,
  downloadCsv,
  Empty,
  ExportBtn,
  Fig,
  Icon,
  Lead,
  LeadK,
  MONTH,
  money,
  More,
  num,
  orderValue,
  pct0,
  pct1,
  rateText,
  Seg,
  SortTable,
  tipProps,
  useAn,
  VTitle,
  type Bucket,
  type Col,
} from "./kit";

type D = QuizAnalyticsData;

const STATUS: Record<"bought" | "added" | "no-purchase", [string, string]> = {
  bought: ["Bought", "info"],
  added: ["Added, not bought", "warn"],
  "no-purchase": ["No purchase yet", "draft"],
};
type Cohort = "all" | "purchased" | "didnt_buy" | "no_match" | "back_in_stock";

// ── Customers ──────────────────────────────────────────────────────────────

function ByResult({ data }: { data: D }) {
  const an = useAn();
  const counts = data.contacts.counts;
  const groups = data.results.filter((r) => r.contacts > 0).sort((a, b) => b.contacts - a.contacts);
  const max = Math.max(1, ...groups.map((g) => g.contacts));
  const seg = (id: string, cls: string, n: number, status: "bought" | "added" | "no-purchase", word: string) =>
    n ? (
      <i
        key={cls}
        className={c(cls)}
        style={{ flex: `${n} 1 0` }}
        role="button"
        tabIndex={0}
        onClick={() => an.openPanel({ facet: id === "*" ? "all" : "result", id: id === "*" ? undefined : id, status })}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            an.openPanel({ facet: id === "*" ? "all" : "result", id: id === "*" ? undefined : id, status });
          }
        }}
        {...tipProps(`${num(n)} ${word}\nClick to see them`)}
      />
    ) : null;
  const row = (id: string, label: string, n: number, b: number, a: number, o: number, width: number, all = false) => {
    const open = () => an.openPanel(id === "*" ? { facet: "all" } : { facet: "result", id });
    return (
      <div key={id} className={c("cr-row", all && "is-all")}>
        <div
          className={c("cr-l")}
          role="button"
          tabIndex={0}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          }}
        >
          <b>{label}</b>
          <span>{num(n)} contacts</span>
        </div>
        <div>
          <div className={c("cr-bar")} style={{ width: `${width}%` }}>
            {seg(id, "c-b", b, "bought", "bought")}
            {seg(id, "c-a", a, "added", "added to cart, not bought")}
            {seg(id, "c-n", o, "no-purchase", "with no purchase yet")}
          </div>
        </div>
        <div className={c("cr-n")}>
          {n ? pct1(b / n) : "—"}
          {n && n < 50 ? (
            <abbr className={c("low")} title={`Based on ${n} contacts, so read this rate as a hint.`}>
              *
            </abbr>
          ) : null}
          <small>bought</small>
        </div>
      </div>
    );
  };
  return (
    <>
      <div className={c("cr")}>
        <div className={c("cr-key")}>
          <span>
            <i className={c("c-b")} />
            Bought
          </span>
          <span>
            <i className={c("c-a")} />
            Added, not bought
          </span>
          <span>
            <i className={c("c-n")} />
            No purchase yet
          </span>
        </div>
        {row("*", "All contacts", counts.all, counts.purchased, counts.added, counts.noPurchase, 100, true)}
        {groups
          .slice(0, 8)
          .map((g) => row(g.resultId, g.noMatch ? "No match (fallback)" : g.name, g.contacts, g.contactsBought, g.contactsAdded, g.contactsNoPurchase, (g.contacts / max) * 100))}
      </div>
      {groups.length > 8 ? (
        <More show={`Show all ${groups.length} results`} hide="Show the top 8">
          <div className={c("cr")} style={{ paddingTop: 14 }}>
            {groups
              .slice(8)
              .map((g) => row(g.resultId, g.noMatch ? "No match (fallback)" : g.name, g.contacts, g.contactsBought, g.contactsAdded, g.contactsNoPurchase, (g.contacts / max) * 100))}
          </div>
        </More>
      ) : null}
    </>
  );
}

function ContactList({ data, base }: { data: D; base: string }) {
  const an = useAn();
  const [sp] = useSearchParams();
  const initial = sp.get("cohort");
  const [cohort, setCohort] = useState<Cohort>(
    initial === "noMatch" ? "no_match" : initial === "purchased" ? "purchased" : initial === "backInStock" ? "back_in_stock" : "all",
  );
  const [result, setResult] = useState("");
  const [product, setProduct] = useState("");
  const [shown, setShown] = useState(12);
  const [page, setPage] = useState<ContactsPanelData | null>(null);
  const [error, setError] = useState(false);
  const counts = data.contacts.counts;
  const query = useCallback(
    (extra: Record<string, string>) => {
      const q = new URLSearchParams();
      for (const k of ["r", "from", "to"]) {
        const v = sp.get(k);
        if (v) q.set(k, v);
      }
      if (result) {
        q.set("facet", "result");
        q.set("id", result);
      } else if (product) {
        q.set("facet", "product");
        q.set("id", product);
      }
      q.set("segment", cohort);
      for (const [k, v] of Object.entries(extra)) q.set(k, v);
      return `${base}?${q.toString()}`;
    },
    [sp, base, cohort, result, product],
  );
  useEffect(() => {
    let live = true;
    setError(false);
    fetch(query({ limit: String(shown) }))
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return (await r.json()) as ContactsPanelData;
      })
      .then((d) => live && setPage(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [query, shown]);
  // A result and a product can't both narrow: the newest pick wins.
  const results = data.results.filter((r) => r.contacts > 0 && !r.noMatch);
  const products = data.products.filter((p) => p.impressions > 0).sort((a, b) => a.title.localeCompare(b.title));
  const chips: Array<[Cohort, string, number]> = [
    ["all", "All", counts.all],
    ["purchased", "Purchased", counts.purchased],
    ["didnt_buy", "Didn't buy", counts.didntBuy],
    ["no_match", "Saw no match", counts.noMatch],
    ["back_in_stock", "Back-in-stock", counts.backInStock],
  ];
  type R = ContactsPanelData["rows"][number];
  const cols: Array<Col<R>> = [
    { h: "Contact", v: (r) => r.emailMasked, asc: true, f: (r) => <Cut w={210}>{r.emailMasked}</Cut> },
    { h: "Captured", cls: "dim", v: (r) => r.capturedAt, f: (r) => dmy(r.capturedAt) },
    {
      h: "Result",
      v: (r) => r.result ?? "",
      asc: true,
      f: (r) =>
        r.noMatch ? (
          <span style={{ color: "var(--an-ink4)" }}>no match — fallback</span>
        ) : r.result ? (
          <Cut w={190}>{r.result}</Cut>
        ) : (
          <span style={{ color: "var(--an-ink4)" }}>left before a result</span>
        ),
    },
    {
      h: "Recommended",
      v: (r) => r.recommended ?? "",
      asc: true,
      f: (r) =>
        r.recommended ? (
          <>
            <Cut w={170}>{r.recommended}</Cut>
            {r.recommendedMore ? <span style={{ color: "var(--an-ink4)" }}> +{r.recommendedMore}</span> : null}
          </>
        ) : (
          DASH
        ),
    },
    {
      h: "Status",
      v: (r) => r.status,
      asc: true,
      f: (r) => <span className={c(`tag is-${STATUS[r.status][1]}`)}>{STATUS[r.status][0]}</span>,
    },
    {
      h: "Consent",
      v: (r) => (r.consent ? 1 : 0),
      f: (r) => (r.consent ? "Yes" : <span style={{ color: "var(--an-ink4)" }}>{r.consent === false ? "No" : "Not asked"}</span>),
    },
    { h: "Value", r: true, v: (r) => (r.value ? Number(r.value.split(" ")[0]) : null), f: (r) => orderValue(r.value) ?? DASH },
  ];
  return (
    <>
      <div className={c("pills")}>
        <div className={c("seg")} role="group" aria-label="Cohort">
          {chips.map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              aria-pressed={cohort === k}
              onClick={() => {
                setCohort(k);
                setShown(12);
              }}
            >
              {label} <b>{num(n)}</b>
            </button>
          ))}
        </div>
        <label className={c("push")}>
          Result{" "}
          <span className={c("selwrap")}>
            <select
              value={result}
              onChange={(e) => {
                setResult(e.target.value);
                setProduct("");
                setShown(12);
              }}
            >
              <option value="">All results</option>
              {results.map((r) => (
                <option key={r.resultId} value={r.resultId}>
                  {r.name}
                </option>
              ))}
            </select>
            <Icon name="chev" />
          </span>
        </label>
        <label>
          Recommended{" "}
          <span className={c("selwrap")}>
            <select
              value={product}
              onChange={(e) => {
                setProduct(e.target.value);
                setResult("");
                setShown(12);
              }}
            >
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.productId} value={p.productId}>
                  {p.title}
                </option>
              ))}
            </select>
            <Icon name="chev" />
          </span>
        </label>
        {result || product ? (
          <button
            type="button"
            className={c("lnk")}
            onClick={() => {
              setResult("");
              setProduct("");
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {error ? (
        <p className={c("inline-empty err")}>The contacts didn’t load. Try again in a moment.</p>
      ) : !page ? (
        <p className={c("inline-empty")}>Loading…</p>
      ) : page.rows.length ? (
        <SortTable cols={cols} rows={page.rows} def={[1, -1]} rowKey={(r) => r.id} />
      ) : (
        <p className={c("inline-empty")}>No contacts match these filters.</p>
      )}
      {page && page.total > page.rows.length ? (
        <div className={c("more")}>
          <button type="button" className={c("morebtn")} onClick={() => setShown((n) => n + 25)}>
            Show 25 more <Icon name="chev" />
          </button>
        </div>
      ) : null}
      <div className={c("sec-h")} style={{ paddingTop: 0 }}>
        <span className={c("sub")}>{page ? `${num(page.total)} of ${num(counts.all)}` : ""}</span>
        <div className={c("ctl")}>
          <ExportBtn
            onClick={() =>
              an.exportServer("contacts", {
                segment: cohort,
                ...(result ? { facet: "result", id: result } : product ? { facet: "product", id: product } : {}),
              })
            }
          />
        </div>
      </div>
      <p className={c("sec-f")}>
        Emails are masked on screen. Exports include them in full and follow the cohort and filters you have selected.
      </p>
    </>
  );
}

export function CustomersTab({ data, bar, contactsBase }: { data: D; bar: ReactNode; contactsBase: string }) {
  const an = useAn();
  const [sp] = useSearchParams();
  const [view, setView] = useState<"result" | "list">(sp.get("cohort") ? "list" : "result");
  const counts = data.contacts.counts;
  const k = data.kpis;
  const P = an.compare ? k.prior : null;
  if (!counts.all) {
    return (
      <Empty
        bar={bar}
        title="No contacts yet"
        body="Captures land here the moment a shopper submits an email. Nobody has reached the email step in the selected range."
        needs={
          <>
            <b>What turns this on:</b> the first shopper who finishes and leaves an email. You’ll see who they are, what
            they were recommended and whether they bought.
          </>
        }
      />
    );
  }
  const top = (
    <Lead
      aria="Contacts"
      bar={bar}
      main={
        <LeadK eyebrow="Contacts captured" tip={`${rateText(k.capture)} of the ${num(k.completed)} shoppers who finished left an email.`}>
          <p className={c("lead-n")}>
            {num(counts.all)}
            {P && P.contacts ? <Delta v={Math.round(((counts.all - P.contacts) / P.contacts) * 100)} unit="%" /> : null}
          </p>
        </LeadK>
      }
      side={
        <div className={c("figs")}>
          <Fig
            value={num(counts.canEmail)}
            label="Can be emailed"
            tip={`${pct0(counts.canEmail / counts.all)} said yes to marketing`}
            keep={P ? <span className={c("pp")}>was {num(P.canEmail)}</span> : null}
            onOpen={() => an.openPanel({ facet: "all", consent: true })}
          />
          <Fig
            value={num(counts.purchased)}
            label="Bought"
            tip={`${pct1(counts.purchased / counts.all)} of contacts`}
            onOpen={() => an.openPanel({ facet: "all", status: "bought" })}
          />
          <Fig
            value={num(counts.noPurchaseCanEmail)}
            label="No purchase yet"
            tip="and can be emailed"
            onOpen={() => an.openPanel({ facet: "all", status: "no-purchase", consent: true })}
          />
          <Fig
            value={num(counts.addedCanEmail)}
            label="Added, not bought"
            tip="added to cart through the quiz, no order yet, and can be emailed"
            onOpen={() => an.openPanel({ facet: "all", status: "added", consent: true })}
          />
        </div>
      }
    />
  );
  return (
    <>
      {top}
      <section className={c("card sec")}>
        <div className={c("sec-h")}>
          <VTitle
            value={view}
            onChange={setView}
            options={[
              ["result", "Contacts by result"],
              ["list", "Contact list"],
            ]}
          />
          {view === "result" ? (
            <div className={c("ctl")}>
              <ExportBtn onClick={() => an.exportServer("contacts")} />
            </div>
          ) : null}
        </div>
        {view === "result" ? <ByResult data={data} /> : <ContactList data={data} base={contactsBase} />}
      </section>
    </>
  );
}

// ── Compare ────────────────────────────────────────────────────────────────

type Metric = "engaged" | "completed" | "rate" | "captures" | "rev";
const METRICS: Array<[Metric, string]> = [
  ["engaged", "Started"],
  ["completed", "Finished"],
  ["rate", "Completion"],
  ["captures", "Contacts"],
  ["rev", "Revenue"],
];

export function CompareTab({ data, bar }: { data: D; bar: ReactNode }) {
  const [metric, setMetric] = useState<Metric>("engaged");
  const noRev = data.attribution === "none";
  const cur = data.currency;
  const months = [...data.months].sort((a, b) => a.key.localeCompare(b.key)); // oldest first
  type M = (typeof months)[number] & { before: (typeof months)[number] | null };
  const m: M[] = months.map((x, i) => ({ ...x, before: i > 0 && !x.partial ? months[i - 1]! : null }));
  const full = m.filter((x) => !x.partial);
  const mname = METRICS.find((x) => x[0] === metric)![1];
  const val = (x: (typeof months)[number]): number | null =>
    metric === "rate" ? (x.engaged >= 20 ? (x.completed / x.engaged) * 100 : null) : metric === "rev" ? x.revenueNumeric : x[metric];
  const fmt = (v: number) =>
    metric === "rate" ? (v % 1 ? "" : `${v}%`) : metric === "rev" ? money(v, cur, 0) : v % 1 ? "" : num(v);
  const monthName = (key: string) => MONTH[Number(key.slice(5, 7)) - 1] ?? key;
  let top: ReactNode;
  if (full.length >= 2) {
    const a = full[full.length - 1]!;
    const b = full[full.length - 2]!;
    const ch = (x: number, y: number) => (y ? Math.round(((x - y) / y) * 100) : null);
    const pts = a.engaged && b.engaged ? Math.round((a.completed / a.engaged - b.completed / b.engaged) * 1000) / 10 : null;
    top = (
      <Lead
        aria="Latest full month"
        bar={bar}
        main={
          <LeadK
            eyebrow="Latest full month"
            tip={`${num(a.completed)} shoppers finished in ${monthName(a.key)}, against ${num(b.completed)} in ${monthName(b.key)}.`}
          >
            <p className={c("lead-n is-text")}>
              {monthName(a.key)}
              <Delta v={ch(a.completed, b.completed)} unit="%" tail="finished" />
            </p>
          </LeadK>
        }
        side={
          <div className={c("figs")}>
            <Fig value={num(a.engaged)} label="Started" keep={<Delta v={ch(a.engaged, b.engaged)} unit="%" />} />
            <Fig
              value={a.engaged ? pct0(a.completed / a.engaged) : "—"}
              label="Completion"
              keep={<Delta v={pts} unit={Math.abs(pts ?? 0) === 1 ? " point" : " points"} />}
            />
            {noRev ? (
              <Fig value="Not measurable" label="Revenue" word />
            ) : (
              <Fig value={money(a.revenueNumeric, cur, 0)} label="Revenue" keep={<Delta v={ch(a.revenueNumeric, b.revenueNumeric)} unit="%" />} />
            )}
          </div>
        }
      />
    );
  } else {
    const first = months[0];
    const next = first ? MONTH[Number(first.key.slice(5, 7)) % 12] : null;
    top = (
      <Lead
        aria="Months"
        bar={bar}
        main={
          <>
            <LeadK eyebrow="Month over month">
              <p className={c("lead-n")}>
                {months.length} <small>month{months.length === 1 ? "" : "s"} of history</small>
              </p>
            </LeadK>
            <p className={c("lead-s")}>
              A comparison needs <b>two full months</b>.{next ? ` The first one appears here when ${next} ends.` : ""}
            </p>
          </>
        }
      />
    );
  }
  const buckets: Bucket[] = m.map((x) => {
    const v = val(x);
    return {
      key: Date.parse(`${x.key}-01T00:00:00Z`),
      label: x.label,
      v,
      partial: x.partial,
      tip: `${x.label}${x.partial ? " (partial)" : ""}\n${mname}: ${v == null ? "too few sessions to rate" : metric === "rate" ? `${Math.round(v)}%` : fmt(v)}`,
    };
  });
  const cols: Array<Col<M>> = [
    {
      h: "Month",
      cls: "name",
      v: (x) => x.key,
      f: (x) => (
        <>
          {x.label}
          {x.partial ? <span style={{ color: "var(--an-ink4)", fontWeight: 500 }}> · partial</span> : null}
        </>
      ),
    },
    { h: "Started", r: true, v: (x) => x.engaged, f: (x) => num(x.engaged) },
    { h: "Finished", r: true, v: (x) => x.completed, f: (x) => num(x.completed) },
    {
      h: "Completion",
      r: true,
      v: (x) => (x.engaged >= 20 ? x.completed / x.engaged : null),
      f: (x) => (x.engaged >= 20 ? pct0(x.completed / x.engaged) : DASH),
    },
    { h: "Contacts", r: true, v: (x) => x.captures, f: (x) => num(x.captures) },
    { h: "Orders", r: true, v: noRev ? undefined : (x) => x.orders, f: (x) => (noRev ? DASH : num(x.orders)) },
    { h: "Revenue", r: true, v: noRev ? undefined : (x) => x.revenueNumeric, f: (x) => (noRev ? DASH : money(x.revenueNumeric, cur)) },
    {
      h: "Per completion",
      r: true,
      v: noRev ? undefined : (x) => (x.completed ? x.revenueNumeric / x.completed : null),
      f: (x) => (!noRev && x.completed ? money(x.revenueNumeric / x.completed, cur) : DASH),
    },
    {
      h: `${mname} vs month before`,
      r: true,
      v: (x) => {
        const a = val(x);
        const b = x.before ? val(x.before) : null;
        return a != null && b ? (a - b) / b : null;
      },
      f: (x) => {
        const a = val(x);
        const b = x.before ? val(x.before) : null;
        if (a == null || !b) return DASH;
        const v = Math.round(((a - b) / b) * 100);
        return `${v < 0 ? "▼ " : "▲ "}${Math.abs(v)}%`;
      },
    },
  ];
  return (
    <>
      {top}
      <section className={c("card sec")}>
        <div className={c("sec-h")}>
          <h2>{mname} by month</h2>
          {m.some((x) => x.partial) ? (
            <span className={c("ch-key")}>
              <i />
              partial month
            </span>
          ) : null}
          <div className={c("ctl")}>
            <Seg aria="Metric" value={metric} onChange={setMetric} options={METRICS.filter((x) => !(noRev && x[0] === "rev"))} />
            <ExportBtn
              onClick={() =>
                downloadCsv("months.csv", [
                  ["Month", "Started", "Finished", "Completion", "Contacts", "Orders", "Revenue", "Per completion"],
                  ...[...m].reverse().map((x) => [
                    x.label + (x.partial ? " (partial)" : ""),
                    x.engaged,
                    x.completed,
                    x.engaged >= 20 ? pct0(x.completed / x.engaged) : "",
                    x.captures,
                    noRev ? "" : x.orders,
                    noRev ? "" : x.revenueNumeric.toFixed(2),
                    !noRev && x.completed ? (x.revenueNumeric / x.completed).toFixed(2) : "",
                  ]),
                ])
              }
            />
          </div>
        </div>
        {m.length ? <Chart buckets={buckets} fmt={fmt} aria={`${mname} by month`} /> : <p className={c("inline-empty")}>No months to show yet.</p>}
        <SortTable cols={cols} rows={m} def={[0, -1]} rowKey={(x) => x.key} />
      </section>
    </>
  );
}


