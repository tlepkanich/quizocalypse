// Quiz flow (ANALYTICS-HANDOFF.md "Quiz flow" and "Branching quizzes"): the
// KPI card, the journey map (paths side by side), Step by step and the full
// table. Every count comes from the step ledger (stepLedger.ts); the steepest
// drop and the typical drop-off are the ledger's, the same figures Insights uses.

import { useState, type ReactNode } from "react";
import { Link } from "@remix-run/react";
import type { QuizAnalyticsData } from "../../../lib/quizAnalytics.server";
import type { LedgerFork, LedgerPath, LedgerStep } from "../../../lib/stepLedger";
import { c, DASH, downloadCsv, ExportBtn, Icon, Kpi, More, num, pct0, pct1, useAn, VTitle, chgPts } from "./kit";
import { whenText } from "./AnswersProducts";

type D = QuizAnalyticsData;
const MIN = 30;

interface Row {
  step: LedgerStep;
  eyebrow: string;
  path: LedgerPath | null;
}

/** Steps in flow order with their eyebrows ("Start", "Question 3", …). */
function rowsOf(data: D): Row[] {
  const ledger = data.ledger;
  if (!ledger) return [];
  const pathById = new Map<string, LedgerPath>();
  const walk = (forks: LedgerFork[]) => {
    for (const f of forks) for (const p of f.paths) {
      pathById.set(p.pathId, p);
      walk(p.forks);
    }
  };
  walk(ledger.paths ?? []);
  // The ledger makes no reach claim for the email gate or for one of several
  // result nodes; its counts already tie out (the last question's leavers are
  // the gap to Finished), so everyone who reaches the gate finishes. Show the
  // gate as reached by the finishers, skipped by those who left no email, and
  // ONE result node holding Finished ("the result equals Finished").
  const finished = data.kpis.completed;
  const resultRows = ledger.steps.filter((s) => s.kind === "result");
  // Results come from the results list (a legacy flow wires only one node).
  const nResults = data.results.filter((r) => !r.noMatch && r.count > 0).length;
  const many = resultRows.length > 1 || nResults > 1;
  const steps: LedgerStep[] = [];
  for (const s of ledger.steps) {
    if (s.kind === "result") {
      if (steps.some((x) => x.kind === "result")) continue;
      steps.push({ ...s, reached: finished, label: many ? `${Math.max(nResults, resultRows.length)} results` : s.label });
    } else if (s.kind === "email_gate" && s.reached == null) {
      const skipped = Math.max(0, finished - data.kpis.captureSessions);
      steps.push({ ...s, reached: finished, continued: finished - skipped, skipped, left: 0, dropoff: null });
    } else steps.push(s);
  }
  // Questions keep the quiz's own numbers (the Q1…Qn of Questions & Answers),
  // so a path question reads "Question 4" wherever it sits in the walk.
  const qNum = new Map(data.answers.map((a, i) => [a.questionId, i + 1]));
  let q = 0;
  return steps.map((s) => {
    if (s.kind === "question") q = qNum.get(s.nodeId) ?? q + 1;
    const eyebrow =
      s.kind === "intro" ? "Start" : s.kind === "question" ? `Question ${q}` : s.kind === "email_gate" ? "Email capture" : s.kind === "result" ? "Result" : s.laneLabel ?? "Step";
    return { step: s, eyebrow, path: s.pathId ? pathById.get(s.pathId) ?? null : null };
  });
}

const iconOf = (k: LedgerStep["kind"]) => (k === "intro" || k === "question" || k === "email_gate" || k === "result" ? k : "question");

export function FlowTab({ data, bar }: { data: D; bar: ReactNode }) {
  const an = useAn();
  const [view, setView] = useState<"map" | "list">("map");
  const ledger = data.ledger;
  const k = data.kpis;
  const E = k.engaged;
  const P = an.compare ? k.prior : null;
  const rows = rowsOf(data);
  const worstId = ledger?.steepestNodeId ?? null;
  const worst = rows.find((r) => r.step.nodeId === worstId) ?? null;
  const typical = ledger?.typicalDropoff ?? null;
  const prevDrop = (id: string) => P?.steps[id]?.dropoff ?? null;

  const kpis = (
    <section className={c("card lead is-wide kcard")} aria-label="Quiz flow totals">
      {bar}
      <div className={c("kpis")}>
        <Kpi value={num(E)} label="started" was={P ? `was ${num(P.started)}` : undefined} />
        <Kpi
          value={num(k.completed)}
          label="finished"
          was={P ? `was ${num(P.finished)}` : undefined}
          tip={`${E ? pct1(k.completed / E) : "0%"} of the ${num(E)} shoppers who started`}
        />
        {worst && worst.step.dropoff != null ? (
          <Kpi
            value={pct1(worst.step.dropoff)}
            label="steepest drop"
            was={P && prevDrop(worst.step.nodeId) != null ? `was ${pct1(prevDrop(worst.step.nodeId)!)}` : undefined}
            tip={`${worst.path ? `Path ${worst.path.letter} · ` : ""}${worst.eyebrow}: ${worst.step.label}\n${num(worst.step.left ?? 0)} of ${num(worst.step.reached ?? 0)} left here`}
          />
        ) : null}
        {worst && typical != null ? (
          <Kpi
            value={pct1(typical)}
            label="typical step drop-off"
            was={P && P.typicalDropoff != null ? `was ${pct1(P.typicalDropoff)}` : undefined}
            tip="The middle drop-off across all the steps"
          />
        ) : null}
      </div>
      {worst ? null : (
        <p className={c("kcard-n")}>
          Drop-off percentages appear once {MIN} shoppers have reached a step. Until then each step shows counts only.
        </p>
      )}
    </section>
  );

  const exitChip = (s: LedgerStep, isWorst: boolean, inLane = false) => (
    <span className={c("jm-exit", isWorst && "is-worst")}>
      {s.left ? (
        <>
          <i />
          <span className={c("jm-chip", isWorst && "is-worst")}>
            {num(s.left)} left{(s.reached ?? 0) >= MIN && s.dropoff != null ? ` · ${pct1(s.dropoff)}` : ""}
          </span>
          {P && (s.reached ?? 0) >= MIN && prevDrop(s.nodeId) != null ? (
            <span className={c("pp")}> was {pct1(prevDrop(s.nodeId)!)}</span>
          ) : null}
        </>
      ) : null}
      {isWorst ? (
        <Link className={c("lnk jm-open")} to={an.builderHref} style={inLane ? undefined : undefined}>
          Open in builder
        </Link>
      ) : null}
    </span>
  );
  const node = (r: Row, width: number) => {
    const s = r.step;
    const idle = s.reached == null;
    return (
      <div
        className={c("jm-node", s.nodeId === worstId && "is-worst", idle && "is-idle", s.kind === "result" && "is-result")}
        style={{ ["--an-w" as string]: `${width}px` }}
      >
        <i className={c("jm-ic")}>
          <Icon name={iconOf(s.kind)} />
        </i>
        <div className={c("jm-t")}>
          <span className={c("lbl")}>
            {r.eyebrow}
            {s.skipped ? ` · ${num(s.skipped)} skipped` : ""}
          </span>
          <b>{s.label}</b>
        </div>
        <span className={c("jm-n")}>{idle ? "—" : num(s.reached ?? 0)}</span>
      </div>
    );
  };
  const W = 460;
  const RAD = 14;
  const nodeW = (reached: number | null) => Math.max(290, Math.round(W * (reached == null || !E ? 0 : reached / E)));
  const half = (px: number) => Math.max(1, px / 2 - RAD);
  const poly = (a: number, b: number) =>
    `polygon(calc(50% - ${a}px) 0, calc(50% + ${a}px) 0, calc(50% + ${b}px) 100%, calc(50% - ${b}px) 100%)`;

  const rowByNode = new Map(rows.map((r) => [r.step.nodeId + (r.step.pathId ?? ""), r]));
  const rowOf = (s: LedgerStep): Row => rowByNode.get(s.nodeId + (s.pathId ?? "")) ?? { step: s, eyebrow: "Step", path: null };

  const laneSteps = (p: LedgerPath, split: number, nPaths: number): ReactNode => {
    const LW = (r: number) => Math.min(320, Math.max(200, Math.round(320 * (r / (split || 1)) * nPaths)));
    return (
      <>
        {p.steps.map((s, i) => {
          const nx = p.steps[i + 1];
          return (
            <div key={s.nodeId}>
              <div className={c("jm-row is-lane")}>
                <span />
                {node(rowOf(s), LW(s.reached ?? 0))}
                {exitChip(s, s.nodeId === worstId, true)}
              </div>
              {nx ? (
                <div className={c("jm-pipe")}>
                  <i style={{ clipPath: poly(half(LW(s.reached ?? 0)), half(LW(nx.reached ?? 0))), width: 320 }} />
                </div>
              ) : null}
            </div>
          );
        })}
        {p.forks.map((f) => (
          <div key={f.splitNodeId}>{lanes(f)}</div>
        ))}
      </>
    );
  };
  const lanes = (f: LedgerFork): ReactNode => {
    const ranked = [...f.paths].sort((a, b) => b.shoppers - a.shoppers);
    const side = f.paths.length > 3 ? ranked.slice(0, 3) : f.paths;
    const rest = f.paths.length > 3 ? ranked.slice(3) : [];
    const n = side.length + (rest.length ? 1 : 0);
    return (
      <>
        <div className={c("jm-fork")}>
          <i />
        </div>
        <div className={c("jm-lanes")} style={{ ["--an-n" as string]: n }}>
          {side.map((p) => (
            <div key={p.pathId} className={c("jm-lane")}>
              <div className={c("jm-lane-h")}>
                <span className={c("lbl")}>Path {p.letter}</span>
                <b>{whenText(p.entryAnswerTexts, p.slotLabel)}</b>
                <span>
                  {num(p.shoppers)} shoppers · {pct0(f.started ? p.shoppers / f.started : 0)}
                </span>
              </div>
              {laneSteps(p, f.started, side.length)}
              <p className={c("jm-lane-f")}>
                {num(p.continue)} {f.joinNodeId ? "continue" : "finish"}
              </p>
            </div>
          ))}
          {rest.length ? (
            <div className={c("jm-lane")}>
              <div className={c("jm-lane-h")}>
                <span className={c("lbl")}>More paths</span>
                <b>+{rest.length} more paths</b>
              </div>
              {rest.map((p) => (
                <p key={p.pathId} className={c("jm-lane-f")}>
                  Path {p.letter} · {whenText(p.entryAnswerTexts, p.slotLabel)} · {num(p.shoppers)} shoppers
                </p>
              ))}
            </div>
          ) : null}
        </div>
        {f.joinNodeId ? <div className={c("jm-join")} style={{ ["--an-n" as string]: n }} /> : null}
      </>
    );
  };

  const forkOfPath = new Map<string, LedgerFork>();
  for (const f of ledger?.paths ?? []) for (const p of f.paths) forkOfPath.set(p.pathId, f);

  const journey = () => {
    const out: ReactNode[] = [];
    const drawn = new Set<string>();
    rows.forEach((r, i) => {
      const s = r.step;
      if (s.pathId) {
        const f = forkOfPath.get(s.pathId);
        if (f && !drawn.has(f.splitNodeId)) {
          drawn.add(f.splitNodeId);
          out.push(<div key={`fork-${f.splitNodeId}`}>{lanes(f)}</div>);
        }
        return;
      }
      const isWorst = s.nodeId === worstId;
      const idle = s.reached == null;
      const res = s.kind === "result";
      const share = idle || !E ? 0 : (s.reached ?? 0) / E;
      const next = rows.slice(i + 1).find((x) => !x.step.pathId);
      const nextIsLane = rows[i + 1]?.step.pathId != null;
      out.push(
        <div key={s.nodeId} className={c("jm-row")}>
          <span className={c("jm-pct")}>
            {idle || !E ? null : (
              <>
                <b>{pct0(share)}</b>
                {s.kind === "intro" ? "started" : res ? "finished" : "still here"}
              </>
            )}
          </span>
          {node(r, nodeW(s.reached))}
          {exitChip(s, isWorst)}
        </div>,
      );
      if (!res && !nextIsLane && next) {
        out.push(
          <div key={`${s.nodeId}-pipe`} className={c("jm-pipe")}>
            {share && next.step.reached ? (
              <i style={{ clipPath: poly(half(nodeW(s.reached)), half(nodeW(next.step.reached))) }} />
            ) : (
              <i className={c("is-idle")} />
            )}
          </div>,
        );
      }
    });
    const outs = data.results.filter((r) => r.count > 0);
    if (outs.length && k.completed) {
      const ranked = [...outs].sort((a, b) => b.count - a.count);
      const many = outs.length > 6;
      const cards = many ? ranked.filter((o) => !o.noMatch).slice(0, 4) : outs;
      const maxO = ranked[0]!.count;
      const restN = k.completed - cards.reduce((s, o) => s + o.count, 0);
      const noRev = data.attribution === "none";
      out.push(
        <div key="spout" className={c("jm-pipe is-spout")}>
          <i style={{ clipPath: poly(half(nodeW(k.completed)), 1.5) }} />
        </div>,
      );
      out.push(
        <div key="split" className={c("jm-split")} style={{ ["--an-n" as string]: cards.length + (many ? 1 : 0) }}>
          {cards.map((o) => {
            const open = o.contacts ? () => an.openPanel({ facet: "result", id: o.resultId }) : undefined;
            return (
              <div
                key={o.resultId}
                className={c("jm-out", o.noMatch && "is-none")}
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
                <span className={c("lbl")}>{o.noMatch ? "No match" : "Result"}</span>
                <b>{o.noMatch ? "Fallback products" : o.name}</b>
                <strong>
                  {num(o.count)} <small>{pct0(o.count / k.completed)}</small>
                </strong>
                <span className={c("opt-t")}>
                  <i style={{ width: `${(o.count / maxO) * 100}%` }} />
                </span>
                <p>{noRev ? `${num(o.contacts)} left an email` : `${num(o.contactsBought)} of ${num(o.contacts)} contacts bought`}</p>
              </div>
            );
          })}
          {many ? (
            <div className={c("jm-out is-more")}>
              <span className={c("lbl")}>Plus</span>
              <b>{outs.length - cards.length} more results</b>
              <strong>
                {num(restN)} <small>{pct0(restN / k.completed)}</small>
              </strong>
              <p>Every result is in the list below</p>
            </div>
          ) : null}
        </div>,
      );
      if (many) out.push(<ResultList key="rl" data={data} ranked={ranked} />);
    }
    return <div className={c("jm")}>{out}</div>;
  };

  const steps = () => {
    const out: ReactNode[] = [];
    let prev: Row | null = null;
    for (const r of rows) {
      const s = r.step;
      if (r.path && (!prev || prev.step.pathId !== s.pathId)) {
        out.push(
          <div key={`ph-${r.path.pathId}`} className={c("st-path")}>
            <span className={c("lbl")}>Path {r.path.letter}</span>
            <b>{whenText(r.path.entryAnswerTexts, r.path.slotLabel)}</b>
            <span>{num(r.path.shoppers)} shoppers</span>
          </div>,
        );
      }
      if (!r.path && prev?.path) {
        const f = forkOfPath.get(prev.path.pathId);
        if (f?.joinNodeId) {
          out.push(
            <div key={`join-${f.splitNodeId}`} className={c("st-path is-join")}>
              <span className={c("lbl")}>Paths join</span>
              <b>{f.paths.map((p) => `${num(p.continue)} from Path ${p.letter}`).join(" + ")}</b>
              <span>{num(f.joined)} shoppers</span>
            </div>,
          );
        }
      }
      const isWorst = s.nodeId === worstId && (!worst || worst.step.pathId === s.pathId);
      const reached = s.reached ?? 0;
      const drop =
        s.left == null ? "" : reached >= MIN && s.dropoff != null ? `${num(s.left)} left · ${pct1(s.dropoff)}` : s.left ? `${num(s.left)} left` : "nobody left";
      out.push(
        <div key={`${s.nodeId}${s.pathId ?? ""}`} className={c("st", isWorst && "is-worst", r.path && "is-lane")}>
          <span className={c("st-e")}>{r.eyebrow}</span>
          <span className={c("st-l")}>
            {s.label}
            {isWorst ? (
              <>
                {" "}
                <span className={c("tag is-crit")}>Steepest drop</span>
                <Link className={c("lnk st-open")} to={an.builderHref}>
                  Open in builder
                </Link>
              </>
            ) : null}
            {s.kind === "email_gate" ? <small>skippable</small> : null}
          </span>
          <span className={c("st-t")}>{s.reached && E ? <i style={{ width: `${(reached / E) * 100}%` }} /> : null}</span>
          <span className={c("st-n")}>{s.reached != null ? num(reached) : DASH}</span>
          <span className={c("st-d")}>
            {drop}
            {P && reached >= MIN && prevDrop(s.nodeId) != null ? <span className={c("pp")}> was {pct1(prevDrop(s.nodeId)!)}</span> : null}
          </span>
        </div>,
      );
      prev = r;
    }
    return out;
  };

  const d = (v: number | null) => (v == null ? DASH : num(v));
  const table = (
    <div className={c("twrap")}>
      <table>
        <thead>
          <tr>
            <th>Step</th>
            <th className={c("r")}>Reached</th>
            <th className={c("r")}>Continued</th>
            <th className={c("r")}>Skipped</th>
            <th className={c("r")}>Left</th>
            <th className={c("r")}>Drop-off</th>
            {P ? (
              <>
                <th className={c("r")}>Previous</th>
                <th className={c("r")}>Change</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = r.step;
            const ok = s.dropoff != null && (s.reached ?? 0) >= MIN;
            const pd = prevDrop(s.nodeId);
            return (
              <tr key={`${s.nodeId}${s.pathId ?? ""}`} className={s.nodeId === worstId ? c("is-worst") : undefined}>
                <td className={c("name")}>
                  {r.path ? (
                    <>
                      <span className={c("tag is-draft")}>Path {r.path.letter}</span>{" "}
                    </>
                  ) : null}
                  {s.label}
                </td>
                <td className={c("r")}>{d(s.reached)}</td>
                <td className={c("r")}>{d(s.continued)}</td>
                <td className={c("r")}>{d(s.skipped)}</td>
                <td className={c("r")}>{d(s.left)}</td>
                <td className={c("r")}>{ok ? pct1(s.dropoff!) : DASH}</td>
                {P ? (
                  <>
                    <td className={c("r")}>{ok && pd != null ? pct1(pd) : DASH}</td>
                    <td className={c("r")}>{ok && pd != null ? chgPts(s.dropoff!, pd) : DASH}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  const exportSteps = () =>
    downloadCsv("quiz-flow.csv", [
      ["Step", "Path", "Question", "Reached", "Continued", "Skipped", "Left", "Drop-off"],
      ...rows.map((r) => [
        r.eyebrow,
        r.path ? `Path ${r.path.letter}` : "",
        r.step.label,
        r.step.reached ?? "",
        r.step.continued ?? "",
        r.step.skipped ?? "",
        r.step.left ?? "",
        r.step.dropoff != null && (r.step.reached ?? 0) >= MIN ? pct1(r.step.dropoff) : "",
      ]),
    ]);

  return (
    <>
      {kpis}
      <section className={c("card sec")}>
        <div className={c("sec-h")}>
          <VTitle
            value={view}
            onChange={setView}
            options={[
              ["map", "Journey map"],
              ["list", "Step by step"],
            ]}
          />
          <div className={c("ctl")}>
            <ExportBtn onClick={exportSteps} disabled={!rows.length} />
          </div>
        </div>
        {!rows.length ? <p className={c("inline-empty")}>This quiz has no steps to show yet.</p> : view === "map" ? journey() : steps()}
        <More show="Show the step-by-step table" hide="Hide the step-by-step table">
          {table}
        </More>
      </section>
    </>
  );
}

/** More than six results: a searchable list of every one, biggest first. */
function ResultList({ data, ranked }: { data: D; ranked: D["results"] }) {
  const an = useAn();
  const [q, setQ] = useState("");
  const maxO = ranked[0]?.count || 1;
  const ql = q.trim().toLowerCase();
  return (
    <div className={c("rl")}>
      <div className={c("rl-h")}>
        <b>All {ranked.length} results</b>
        <span>biggest first · scroll for the rest</span>
        <label className={c("search")}>
          <Icon name="search" />
          <input type="search" placeholder="Find a result" aria-label="Find a result" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className={c("rl-s")}>
        {ranked
          .filter((o) => !ql || o.name.toLowerCase().includes(ql))
          .map((o) => {
            const open = o.contacts ? () => an.openPanel({ facet: "result", id: o.resultId }) : undefined;
            return (
              <div
                key={o.resultId}
                className={c("rl-row")}
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
                <b>{o.noMatch ? "Fallback products" : o.name}</b>
                <span className={c("opt-t")}>
                  <i style={{ width: `${(o.count / maxO) * 100}%` }} />
                </span>
                <span className={c("rl-n")}>{num(o.count)}</span>
                <span className={c("rl-p")}>{pct1(o.count / (data.kpis.completed || 1))}</span>
                <span className={c("rl-c")}>
                  {num(o.contactsBought)} of {num(o.contacts)} contacts bought
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
