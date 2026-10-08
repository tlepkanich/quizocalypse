// Questions & Answers and Products (ANALYTICS-HANDOFF.md "The screens").

import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "@remix-run/react";
import type { QuizAnalyticsData, ProductRow } from "../../../lib/quizAnalytics.server";
import type { ReachWay } from "../../../lib/productReach";
import {
  c,
  DASH,
  dmy,
  downloadCsv,
  Empty,
  ExportBtn,
  Icon,
  money,
  More,
  num,
  pct0,
  pct1,
  SrTip,
  tipProps,
  useAn,
  VTitle,
  Cut,
} from "./kit";

type D = QuizAnalyticsData;
type Q = D["answers"][number];

/** The answer bar's eight shades, biggest answer darkest (analytics.css). */
const MIX = Array.from({ length: 8 }, (_, i) => `var(--an-mix-${i})`);

/** "If they pick Dry or Sensitive" — the path's entry answers as written. */
export function whenText(texts: string[], slotLabel: string | null): string {
  if (!texts.length) return slotLabel ?? "Everyone else";
  const t = texts.length > 1 ? `${texts.slice(0, -1).join(", ")} or ${texts[texts.length - 1]}` : texts[0]!;
  return `If they pick ${t}`;
}

/** Who a question is counted out of: its path's shoppers, or everyone who started. */
function qBase(data: D, q: Q): { n: number; path: string | null } {
  const p = data.answerPaths[q.questionId];
  return p ? { n: p.shoppers, path: p.letter } : { n: data.kpis.engaged, path: null };
}

function OptRows({
  opts,
  base,
  onOpen,
  prevShare,
}: {
  opts: Array<{ key: string; label: string; n: number }>;
  base: number;
  onOpen?: (key: string) => void;
  prevShare?: (key: string) => number | undefined;
}) {
  const top = Math.max(0, ...opts.map((o) => o.n));
  return (
    <>
      {opts.map((o) => {
        const open = onOpen && o.n ? () => onOpen(o.key) : undefined;
        const prev = prevShare?.(o.key);
        return (
          <div
            key={o.key}
            className={c("opt", o.n === top && top > 0 && "is-top", open && "is-click", prev !== undefined && "has-pp")}
            role={open ? "button" : undefined}
            tabIndex={open ? 0 : undefined}
            onClick={open}
            onKeyDown={
              open
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }
                : undefined
            }
          >
            <span className={c("opt-l")}>{o.label}</span>
            <span className={c("opt-t")}>{base && o.n ? <i style={{ width: `${(o.n / base) * 100}%` }} /> : null}</span>
            <span className={c("opt-n")}>
              {num(o.n)} · {base ? pct0(o.n / base) : "0%"}
              {prev !== undefined ? <span className={c("pp")}> was {pct0(prev)}</span> : null}
            </span>
          </div>
        );
      })}
    </>
  );
}

function AnswerMix({ data }: { data: D }) {
  const an = useAn();
  const prior = an.compare ? data.kpis.prior : null;
  return (
    <div className={c("mx")}>
      {data.answers.map((q, qi) => {
        const b = qBase(data, q);
        const opts = q.options.filter((o) => o.sessions > 0).sort((a, z) => z.sessions - a.sessions);
        const picks = opts.reduce((a, o) => a + o.sessions, 0);
        return (
          <div key={q.questionId} className={c("mx-row")}>
            <div className={c("mx-h")}>
              <span className={c("qn")}>Q{qi + 1}</span>
              {b.path ? <span className={c("qp")}>Path {b.path}</span> : null}
              <b>{q.text}</b>
              <span className={c("mx-n")}>
                {num(q.answered)} of {b.path ? `${num(b.n)} on this path answered` : `${num(b.n)} answered`}
                {q.multi ? " · pick any" : ""}
              </span>
            </div>
            {q.freeform ? (
              <div className={c("mx-none")}>{num(q.answered)} written answers</div>
            ) : !q.answered ? (
              <div className={c("mx-none")}>No answers in this range</div>
            ) : (
              <div className={c("mx-bar")}>
                {opts.map((o, i) => {
                  const room = (o.sessions / picks) * 1000 > 44;
                  const was = prior?.answerShares[o.answerId];
                  const tip = `${o.label}\n${num(o.sessions)} of ${num(q.answered)} shoppers · ${pct0(o.share)}${
                    was !== undefined ? `\nPrevious period: ${pct0(was)}` : ""
                  }\nClick to see their contacts`;
                  const open = () => an.openPanel({ facet: "answer", id: o.answerId });
                  return (
                    <div
                      key={o.answerId}
                      className={c("mx-col", i === 0 && "is-top")}
                      style={{ flex: `${o.sessions} 1 0` }}
                      role="button"
                      tabIndex={0}
                      onClick={open}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          open();
                        }
                      }}
                      {...tipProps(tip)}
                    >
                      <span className={c("mx-t")}>
                        {room ? (
                          <>
                            <b>{pct0(o.share)}</b> {o.label}
                          </>
                        ) : (
                          " "
                        )}
                      </span>
                      {prior ? <span className={c("mx-w")}>{room && was !== undefined ? `was ${pct0(was)}` : " "}</span> : null}
                      <i style={{ background: MIX[Math.min(i, MIX.length - 1)] }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AnswersTab({ data, bar }: { data: D; bar: ReactNode }) {
  const an = useAn();
  const [view, setView] = useState<"mix" | "cards">("mix");
  const k = data.kpis;
  const prior = an.compare ? k.prior : null;
  const any = data.answers.some((q) => q.answered > 0);
  const typ = data.answers
    .filter((q) => q.answered > 0 && !q.freeform && q.options.length)
    .map((q) => {
      const t = q.options.reduce((a, o) => (o.sessions > a.sessions ? o : a), q.options[0]!);
      const tip = `${q.text}\n${num(t.sessions)} of ${num(q.answered)} answered · ${pct0(t.share)}`;
      return (
        <div key={q.questionId} className={c("has-tip")} {...tipProps(tip)}>
          <b>{t.label}</b>
          <SrTip t={tip} />
        </div>
      );
    });
  const top = (
    <section className={c("card lead typ-card")} aria-label="The most common shopper">
      {bar}
      <div className={c("typ-side")}>
        <p className={c("lbl")}>The most common shopper</p>
        <p className={c("typ-tot")}>
          <span>
            <b>{num(k.engaged)}</b> started
          </span>
          <span>
            <b>{num(k.completed)}</b> finished
          </span>
        </p>
      </div>
      {any ? <div className={c("typ")}>{typ}</div> : <p className={c("lead-s")}>No answers in this range yet.</p>}
    </section>
  );
  const exportAnswers = () =>
    downloadCsv("answers.csv", [
      ["Question", "Answer", "Shoppers", "Share of those who answered", "Answered", "Out of"],
      ...data.answers.flatMap((q) => {
        const b = qBase(data, q);
        return q.options.map((o) => [q.text, o.label, o.sessions, pct1(o.share), q.answered, b.n]);
      }),
    ]);
  const switcher = any ? (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <VTitle
          value={view}
          onChange={setView}
          options={[
            ["mix", "Answer breakdown"],
            ["cards", "Question breakdown"],
          ]}
        />
        <div className={c("ctl")}>
          <ExportBtn onClick={exportAnswers} />
        </div>
      </div>
      {view === "mix" ? <AnswerMix data={data} /> : null}
    </section>
  ) : null;
  const cards =
    view === "cards" || !any ? (
      <div className={c("qgrid")}>
        {data.answers.map((q, i) => {
          const b = qBase(data, q);
          return (
            <section key={q.questionId} className={c("card qc")}>
              <div className={c("qc-h")}>
                <span className={c("qn")}>Q{i + 1}</span>
                {b.path ? <span className={c("qp")}>Path {b.path}</span> : null}
                <h3>{q.text}</h3>
              </div>
              {!q.answered ? (
                <p className={c("base")} style={{ marginTop: 0 }}>
                  No answers in this range.
                </p>
              ) : q.freeform ? (
                <p className={c("base")} style={{ marginTop: 0 }}>
                  {num(q.answered)} written answers.
                </p>
              ) : (
                <>
                  <OptRows
                    opts={q.options.map((o) => ({ key: o.answerId, label: o.label, n: o.sessions }))}
                    base={q.answered}
                    onOpen={(id) => an.openPanel({ facet: "answer", id })}
                    prevShare={prior ? (id) => prior.answerShares[id] : undefined}
                  />
                  <p className={c("base")}>
                    {num(q.answered)} of {b.path ? `${num(b.n)} shoppers on Path ${b.path}` : `${num(b.n)} total shoppers`} picked an
                    answer{q.multi ? " · pick any" : ""}.
                  </p>
                </>
              )}
            </section>
          );
        })}
      </div>
    ) : null;
  const outs = data.results.filter((r) => r.count > 0);
  const ranked = [...outs].sort((a, b) => b.count - a.count);
  const outCard = outs.length ? (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <h2>Where shoppers ended up</h2>
        <span className={c("sub")}>{num(k.completed)} completions</span>
      </div>
      <div className={c("sec-b")}>
        <OptRows
          opts={(outs.length > 8 ? ranked : outs).slice(0, 8).map((r) => ({ key: r.resultId, label: r.noMatch ? "No match (fallback)" : r.name, n: r.count }))}
          base={k.completed}
          onOpen={(id) => an.openPanel({ facet: "result", id })}
        />
      </div>
      {outs.length > 8 ? (
        <More show={`Show all ${outs.length} results`} hide="Show the top 8">
          <div className={c("sec-b")}>
            <OptRows
              opts={ranked.slice(8).map((r) => ({ key: r.resultId, label: r.noMatch ? "No match (fallback)" : r.name, n: r.count }))}
              base={k.completed}
              onOpen={(id) => an.openPanel({ facet: "result", id })}
            />
          </div>
        </More>
      ) : null}
    </section>
  ) : null;
  const resp = data.responses.rows.slice(0, 10);
  const qs = data.answers;
  const respCard = resp.length ? (
    <section className={c("card sec")}>
      <div className={c("sec-h")}>
        <h2>Individual responses</h2>
        <span className={c("sub")}>
          1–{resp.length} of {num(data.responses.total)}
        </span>
        <div className={c("ctl")}>
          <ExportBtn onClick={() => an.exportServer("responses")} />
        </div>
      </div>
      <More show="Show the responses" hide="Hide the responses" defaultOpen={data.responses.total <= 1}>
        <div className={c("twrap")}>
          <table>
            <thead>
              <tr>
                <th>Shopper</th>
                <th>When</th>
                {qs.map((q) => (
                  <th key={q.questionId}>
                    <span title={q.text}>{q.text.length > 26 ? `${q.text.slice(0, 25)}…` : q.text}</span>
                  </th>
                ))}
                <th>Result</th>
                <th>Bought</th>
              </tr>
            </thead>
            <tbody>
              {resp.map((r) => {
                const byQ = new Map(r.answers.map((a) => [a.questionId, a.text]));
                return (
                  <tr key={r.sessionId}>
                    <td className={c("dim")}>{r.short}</td>
                    <td className={c("dim")}>{dmy(r.when)}</td>
                    {qs.map((q) => (
                      <td key={q.questionId}>{byQ.has(q.questionId) ? <Cut w={200}>{byQ.get(q.questionId)}</Cut> : DASH}</td>
                    ))}
                    <td>{r.result ? <Cut w={220}>{r.result}</Cut> : <span style={{ color: "var(--an-ink4)" }}>{r.leftAt}</span>}</td>
                    <td>{r.bought ? "Yes" : DASH}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </More>
      <p className={c("sec-f")}>
        Includes shoppers who left partway; their row stops where they did. Shopper ids are shortened. The export carries
        every response in the range.
      </p>
    </section>
  ) : null;
  return (
    <>
      {top}
      {switcher}
      {cards}
      {outCard}
      {respCard}
    </>
  );
}

// ── Products ───────────────────────────────────────────────────────────────

const MIN_VIEWS = 30;
const FIRM_VIEWS = 100;
const KIND: Record<ReachWay["kind"], string> = { starting_set: "Starting set", narrows: "Narrows", rule: "Rule" };

function wayTag(w: ReachWay): string {
  return w.kind === "rule" ? `Rule ${w.ruleNumber}` : KIND[w.kind];
}

export function ProductsTab({ data, bar }: { data: D; bar: ReactNode }) {
  const an = useAn();
  const [sp] = useSearchParams();
  const [pf, setPf] = useState<"all" | "nologic">(sp.get("pf") === "nologic" ? "nologic" : "all");
  const [q, setQ] = useState("");
  const [shownN, setShownN] = useState(25);
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<[number, 1 | -1]>([1, -1]);
  const products = data.products;
  if (!products.length) {
    return (
      <Empty
        bar={bar}
        title="No product activity yet"
        body="Impressions appear here once shoppers reach their recommendations. Nobody has finished this quiz in the selected range."
        needs={
          <>
            <b>What turns this on:</b> the first shopper who finishes. You’ll see which products the quiz shows and which
            get clicked.
          </>
        }
      />
    );
  }
  const cur = data.currency;
  const shown = products.filter((p) => p.impressions > 0);
  const firm = shown.filter((p) => p.impressions >= FIRM_VIEWS);
  const best = (list: ProductRow[], f: (p: ProductRow) => number) =>
    list.length ? list.reduce((a, p) => (f(p) > f(a) ? p : a), list[0]!) : null;
  const a = best(shown, (p) => p.share ?? 0);
  const b = best(firm, (p) => p.ctr);
  const cB = best(shown, (p) => p.bought ?? 0);
  const pfig = (p: ProductRow, label: string, detail: string) => {
    const tip = `${p.title}\n${detail}`;
    return (
      <div className={c("fig has-tip")} {...tipProps(tip)}>
        <b className={c("is-name")}>{p.title}</b>
        <p className={c("lbl")}>{label}</p>
        <SrTip t={detail} />
      </div>
    );
  };
  const top = (
    <section className={c("card lead is-wide")} aria-label="Product highlights">
      {bar}
      <div className={c("lead-side")}>
        <div className={c("figs")}>
          {a ? pfig(a, "Most shown", `shown to ${pct0(a.share ?? 0)} of shoppers who finished`) : null}
          {b ? pfig(b, "Highest click rate", `${pct1(b.ctr)} · ${num(b.clicks)} clicks from ${num(b.impressions)} views`) : null}
          {cB && cB.bought ? pfig(cB, "Most bought", `${num(cB.bought)} order${cB.bought === 1 ? "" : "s"}`) : null}
        </div>
      </div>
    </section>
  );
  // The context an opened row compares against: the quiz's click rate and the median product's reach.
  const P = products.filter((p) => p.impressions >= MIN_VIEWS);
  const avg = P.length >= 2 ? P.reduce((s, p) => s + p.clicks, 0) / P.reduce((s, p) => s + p.impressions, 0) : null;
  const shares = P.map((p) => p.share ?? 0).sort((x, y) => x - y);
  const med = shares.length >= 2 ? shares[Math.floor((shares.length - 1) / 2)]! : null;
  const sales = products.reduce((s, p) => s + (p.revenue ?? 0), 0) || 1;
  const isFirm = (p: ProductRow) => p.impressions >= MIN_VIEWS;
  const two = (n: ReactNode, sub?: ReactNode) => (
    <>
      <b>{n}</b>
      <small>{sub ?? " "}</small>
    </>
  );
  const cols: Array<{ h: string; sub?: string; t?: string; v: (p: ProductRow) => number | string | null; f?: (p: ProductRow) => ReactNode; asc?: boolean }> = [
    { h: "Product", asc: true, v: (p) => p.title.toLowerCase() },
    {
      h: "Shown",
      sub: "% who finished",
      t: "Times the product was on a shopper’s results page, and the share of shoppers who finished that saw it.",
      v: (p) => p.impressions,
      f: (p) => (p.impressions ? two(num(p.impressions), pct0(p.share ?? 0)) : DASH),
    },
    { h: "Clicked", sub: "% of shown", t: "Clicks; the rate shows from 30 views.", v: (p) => p.clicks, f: (p) => (p.impressions ? two(num(p.clicks), isFirm(p) ? pct1(p.ctr) : "") : DASH) },
    {
      h: "Added to cart",
      sub: "% of shown",
      t: "Added with the quiz’s own Add to cart button (Add all counts for each product). Adds made later on the product page aren’t visible to the quiz.",
      v: (p) => p.addToCart,
      f: (p) => (p.impressions ? two(num(p.addToCart), isFirm(p) ? pct1(p.addToCart / p.impressions) : "") : DASH),
    },
    {
      h: "Bought",
      sub: "% of shown",
      t: "Attributed orders that contained this product.",
      v: (p) => p.bought,
      f: (p) => (p.bought == null ? DASH : p.impressions ? two(num(p.bought), isFirm(p) ? pct1(p.bought / p.impressions) : "") : num(p.bought)),
    },
    {
      h: "Revenue",
      sub: "% of sales",
      t: "This product’s line items (price × quantity, after discounts) in attributed orders, and its share of all the quiz’s product sales.",
      v: (p) => p.revenue,
      f: (p) => (p.revenue == null ? DASH : two(money(p.revenue, cur, 0), pct0(p.revenue / sales))),
    },
    {
      h: "Returned",
      sub: "% of bought",
      t: "Units on refunds Shopify marks as returned, matched to the quiz’s attributed orders. Orders from the last 30 days can still come back.",
      v: (p) => p.returned,
      f: (p) => (p.bought ? two(num(p.returned ?? 0), pct0((p.returned ?? 0) / p.bought)) : DASH),
    },
    {
      h: "Days to return",
      sub: "median",
      t: "Days from the order to the refund, middle value.",
      v: (p) => p.daysToReturn,
      f: (p) => (p.daysToReturn != null ? two(String(p.daysToReturn), "days") : DASH),
    },
  ];
  const ql = q.trim().toLowerCase();
  const list = products.filter((p) => (!ql || p.title.toLowerCase().includes(ql)) && (pf === "all" || p.noLogic));
  const sc = cols[sort[0]]!;
  list.sort((x, y) => {
    const u = sc.v(x);
    const w = sc.v(y);
    if (u == null && w == null) return 0;
    if (u == null) return 1;
    if (w == null) return -1;
    return (u < w ? -1 : u > w ? 1 : 0) * sort[1];
  });
  const page = list.slice(0, shownN);
  const nNo = products.filter((p) => p.noLogic).length;
  const detail = (p: ProductRow) => (
    <div className={c("pd")}>
      <div className={c("pd-c")}>
        {p.impressions >= MIN_VIEWS && avg != null ? (
          <p>
            Clicked by <b>{pct1(p.ctr)}</b> of the shoppers who see it; the quiz’s rate is <b>{pct1(avg)}</b>.
          </p>
        ) : (
          <p>Its click rate shows once {MIN_VIEWS} shoppers have seen it.</p>
        )}
        {med != null && p.share != null ? (
          <p>
            Shown to <b>{pct0(p.share)}</b> of shoppers who finish; the median product reaches <b>{pct0(med)}</b>.
          </p>
        ) : null}
      </div>
      <div className={c("pd-c")}>
        {p.ways.map((w, i) => (
          <div key={i} className={c("pd-r")}>
            <span className={c("tag is-draft")}>{wayTag(w)}</span>
            <p>
              {w.sentence}
              <span className={c("pd-res")}> → {w.results.map((r) => r.name).join(", ")}</span>
            </p>
          </div>
        ))}
        <p className={c("pd-a")}>
          <Link className={c("lnk")} to={an.builderHref}>
            Open in Logic <Icon name="arrow" />
          </Link>
        </p>
      </div>
    </div>
  );
  const exportProducts = () =>
    downloadCsv("products.csv", [
      ["Product", "Shown", "Clicked", "Added to cart", "Bought", "Revenue", "Returned", "Days to return", "No logic"],
      ...list.map((p) => [
        p.title,
        p.impressions,
        p.clicks,
        p.addToCart,
        p.bought ?? "",
        p.revenue != null ? p.revenue.toFixed(2) : "",
        p.returned ?? "",
        p.daysToReturn ?? "",
        p.noLogic ? "Yes" : "",
      ]),
    ]);
  return (
    <>
      {shown.length ? top : null}
      <section className={c("card sec")}>
        <div className={c("sec-h")}>
          <h2>Product table</h2>
          <div className={c("ctl")}>
            {products.length > 12 ? (
              <label className={c("search")}>
                <Icon name="search" />
                <input
                  type="search"
                  placeholder="Find a product"
                  aria-label="Find a product"
                  autoComplete="off"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setShownN(25);
                  }}
                />
              </label>
            ) : null}
            <ExportBtn onClick={exportProducts} />
          </div>
        </div>
        <div className={c("pills")}>
          <div className={c("seg")} role="group" aria-label="Show">
            <button type="button" aria-pressed={pf === "all"} onClick={() => setPf("all")}>
              All <b>{num(products.length)}</b>
            </button>
            {nNo ? (
              <button
                type="button"
                aria-pressed={pf === "nologic"}
                title="No combination of answers leads to these products."
                onClick={() => {
                  setPf(pf === "nologic" ? "all" : "nologic");
                  setOpen(null);
                  setShownN(25);
                }}
              >
                No logic <b>{num(nNo)}</b>
              </button>
            ) : null}
          </div>
        </div>
        {pf === "nologic" ? (
          <p className={c("p-note")}>No combination of answers leads to these, so no shopper is shown them. Fix them in the Logic step.</p>
        ) : null}
        {list.length ? (
          <div className={c("twrap")}>
            <table className={c("ptab")}>
              <colgroup>
                <col className={c("pc-name")} />
                {cols.slice(1).map((_, i) => (
                  <col key={i} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {cols.map((cl, i) => (
                    <th key={cl.h} title={cl.t} aria-sort={sort[0] === i ? (sort[1] === 1 ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        onClick={() => setSort((s) => (s[0] === i ? [i, (-s[1]) as 1 | -1] : [i, cl.asc ? 1 : -1]))}
                      >
                        <span className={c("th-h")}>{cl.h}</span>
                        {cl.sub ? <small>{cl.sub}</small> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.map((p) => {
                  const has = p.ways.length > 0;
                  const isOpen = open === p.productId;
                  return [
                    <tr
                      key={p.productId}
                      className={has ? c("go", isOpen && "is-open") : undefined}
                      onClick={has ? () => setOpen(isOpen ? null : p.productId) : undefined}
                    >
                      <td className={c("name")}>
                        <div className={c("pnw")}>
                          <span className={c("caret")} aria-hidden="true">
                            {has ? (isOpen ? "▾" : "▸") : ""}
                          </span>
                          <span className={c("pn")}>
                            <span className={c("pn-t")}>{p.title}</span>
                            {p.noLogic ? (
                              <span className={c("pn-g")}>
                                <span className={c("tag is-warn")}>No logic</span>
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      {cols.slice(1).map((cl) => (
                        <td key={cl.h} className={c("pt")}>
                          {p.noLogic && !p.impressions ? DASH : cl.f!(p)}
                        </td>
                      ))}
                    </tr>,
                    isOpen ? (
                      <tr key={`${p.productId}-sub`} className={c("sub")}>
                        <td colSpan={cols.length}>{detail(p)}</td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={c("inline-empty")}>{q ? `No products match “${q}”.` : "No products here."}</p>
        )}
        {list.length > shownN ? (
          <div className={c("more")}>
            <button type="button" className={c("morebtn")} onClick={() => setShownN((n) => n + 25)}>
              Show 25 more <Icon name="chev" />
            </button>
          </div>
        ) : null}
      </section>
    </>
  );
}
