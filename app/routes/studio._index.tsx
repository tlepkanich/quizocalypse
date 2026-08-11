import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useRef, useState, type ReactNode } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { computeBenchmarks, type BenchmarkEventRow } from "../lib/quizBenchmarks";
import { Quiz } from "../lib/quizSchema";
import { stepNumber, TOTAL_STEPS } from "../lib/funnelStages";
import { MIN_GOAL_CHARS } from "../lib/funnelDraft.server";
import { QzStat, QzSectionHeader } from "../components/qz";
import { formatDate } from "../lib/formatDate";
import type { action as goalAction } from "./studio.goal";

// QRTZ-S1 — Home rebuilt to the Quartz mock (docs/design/brand-2026/_src/
// home.mjs, s09): ONE page, two states. Before the first quiz the goal
// composer sits optically centred with a first-run design nudge; after it the
// SAME composer (byte-identical) tops three sections — the "Pick up where you
// left off" checklist, "Last 30 days" stats, and "Your quizzes". The old
// dashboard (welcome banner, hero art, gradient, sparkle, week chart) is gone
// per the mock — flat Quartz has none of them.
//
// FLOW-1 stays the contract (owner 2026-07-25): the composer POSTS
// goal/audience/factors/length to /studio/goal's action, which claims the
// decider draft, kicks the AI product pre-pick and redirects into onboarding.
// The brief (audience/factors/length) is folded inline behind the
// "Audience, factors, length" disclosure; length NEVER blocks the draft.

const fmtNum = (n: number) => n.toLocaleString("en-US");

type Delta = { text: string; up: boolean } | null;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  // Owner correction (2026-08-01) — mid-funnel drafts (buildState "step1") are
  // VISIBLE in the lists; their rows route back into the funnel.
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id },
    select: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
      buildState: true,
      draftJson: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const quizIds = quizzes.map((q) => q.id);

  // Two rolling 30-day windows: current (for the stat values) and previous
  // (for the deltas). All-time rows still feed the per-quiz meta + todos.
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 3600 * 1000);
  const since60 = new Date(now - 60 * 24 * 3600 * 1000);
  const funnelWhere = {
    quizId: { in: quizIds },
    eventType: { in: ["quiz_engaged", "quiz_completed"] },
  };
  const funnelSelect = { quizId: true, eventType: true, sessionId: true } as const;
  const funnelDistinct = ["quizId", "eventType", "sessionId"] as const;

  const [allRows, curRows, prevRows, contacts, emailsCur, emailsPrev] = await Promise.all([
    prisma.event.findMany({
      where: funnelWhere,
      select: funnelSelect,
      distinct: [...funnelDistinct],
    }),
    prisma.event.findMany({
      where: { ...funnelWhere, ts: { gte: since30 } },
      select: funnelSelect,
      distinct: [...funnelDistinct],
    }),
    prisma.event.findMany({
      where: { ...funnelWhere, ts: { gte: since60, lt: since30 } },
      select: funnelSelect,
      distinct: [...funnelDistinct],
    }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id } } }),
    prisma.emailCapture.count({
      where: { quiz: { shopId: shop.id }, capturedAt: { gte: since30 } },
    }),
    prisma.emailCapture.count({
      where: { quiz: { shopId: shop.id }, capturedAt: { gte: since60, lt: since30 } },
    }),
  ]);

  const benchmarks = computeBenchmarks(allRows);
  const tally = (rows: BenchmarkEventRow[]) => {
    const b = computeBenchmarks(rows);
    let started = 0;
    let completed = 0;
    for (const q of Object.values(b.byQuiz)) {
      started += q.started;
      completed += q.completed;
    }
    return { started, completed };
  };
  const cur = tally(curRows);
  const prev = tally(prevRows);

  // Deltas render only when the previous window has signal — no "+∞%".
  const startsDelta: Delta =
    prev.started > 0 && cur.started !== prev.started
      ? {
          text: `${cur.started > prev.started ? "+" : "−"}${Math.abs(
            Math.round(((cur.started - prev.started) / prev.started) * 100),
          )}%`,
          up: cur.started > prev.started,
        }
      : null;
  const curRate = cur.started > 0 ? Math.round((cur.completed / cur.started) * 100) : null;
  const prevRate = prev.started > 0 ? Math.round((prev.completed / prev.started) * 100) : null;
  const completionDelta: Delta =
    curRate != null && prevRate != null && curRate !== prevRate
      ? {
          text: `${curRate > prevRate ? "+" : "−"}${Math.abs(curRate - prevRate)} pts`,
          up: curRate > prevRate,
        }
      : null;
  const emailsDelta: Delta =
    emailsCur !== emailsPrev
      ? {
          text: `${emailsCur > emailsPrev ? "+" : "−"}${Math.abs(emailsCur - emailsPrev)}`,
          up: emailsCur > emailsPrev,
        }
      : null;

  // One light doc peek per quiz (same Quiz.safeParse pattern as the
  // integrations loader): the funnel stage for "K of 4 steps" + whether any
  // integration node has a destination wired.
  const peek = new Map<string, { stage: string | null; hasIntegration: boolean }>();
  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.draftJson);
    if (!parsed.success) {
      peek.set(q.id, { stage: null, hasIntegration: false });
      continue;
    }
    peek.set(q.id, {
      stage: parsed.data.build_session?.stage ?? null,
      hasIntegration: parsed.data.nodes.some(
        (n) => n.type === "integration" && n.data.actions.length > 0,
      ),
    });
  }
  const anyIntegration = [...peek.values()].some((p) => p.hasIntegration);
  const designSet = shop.brandIdentity != null;

  // "Pick up where you left off" — mock order (distance to revenue): a
  // built-but-unpublished quiz earns nothing → published-with-zero-starts →
  // captured emails going nowhere → design polish that cascades.
  const publishCandidate = quizzes.find(
    (q) => q.status !== "published" && q.buildState == null,
  );
  const embedCandidate = quizzes.find(
    (q) => q.status === "published" && (benchmarks.byQuiz[q.id]?.started ?? 0) === 0,
  );
  const todos: Array<{
    kind: "publish" | "embed" | "emails" | "design";
    title: string;
    sub: string;
    href: string;
  }> = [];
  if (publishCandidate) {
    todos.push({
      kind: "publish",
      title: `Publish “${publishCandidate.name}”`,
      sub: `Edited ${formatDate(publishCandidate.updatedAt)} · nothing is live until you publish`,
      href: `/studio/${publishCandidate.id}`,
    });
  }
  if (embedCandidate) {
    todos.push({
      kind: "embed",
      title: `Add “${embedCandidate.name}” to your store`,
      sub: "Published, but no shopper has reached it yet",
      href: `/studio/${embedCandidate.id}/embed`,
    });
  }
  if (contacts > 0 && !anyIntegration) {
    todos.push({
      kind: "emails",
      title: "Send captured emails somewhere",
      sub: `${contacts} address${contacts === 1 ? "" : "es"} collected, no destination connected`,
      href: "/studio/integrations",
    });
  }
  if (!designSet) {
    todos.push({
      kind: "design",
      title: "Set up your global design",
      sub: "Colors and fonts flow into every quiz you build",
      href: "/studio/brand",
    });
  }

  return json({
    hasQuizzes: quizzes.length > 0,
    totalQuizzes: quizzes.length,
    minGoalChars: MIN_GOAL_CHARS,
    designSet,
    todos,
    stats: {
      starts: cur.started,
      startsDelta,
      completion: curRate,
      completionDelta,
      emails: emailsCur,
      emailsDelta,
      published: quizzes.filter((q) => q.status === "published").length,
    },
    rows: quizzes.slice(0, 4).map((q) => {
      const b = benchmarks.byQuiz[q.id];
      const inSetup = q.buildState === "step1";
      const meta = inSetup
        ? `Edited ${formatDate(q.updatedAt)} · ${stepNumber(
            peek.get(q.id)?.stage ?? "grouping",
          )} of ${TOTAL_STEPS} steps`
        : b && b.started > 0 && b.rate != null
          ? `${fmtNum(b.started)} starts · ${b.rate}% completion`
          : `Edited ${formatDate(q.updatedAt)}`;
      return {
        id: q.id,
        name: q.name,
        href: inSetup ? `/studio/onboarding/${q.id}` : `/studio/${q.id}`,
        meta,
        chip: q.status === "published" ? ("live" as const) : inSetup ? ("setup" as const) : ("draft" as const),
      };
    }),
  });
};

/* ── Icons — verbatim paths from home.mjs (24 viewBox, stroke 1.7) ────────── */

function HmIcon({
  d,
  className,
  width,
  height,
}: {
  d: ReactNode;
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      width={width}
      height={height}
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

const I = {
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </>
  ),
  box: (
    <>
      <path d="M4 7.5 12 3.5l8 4v9l-8 4-8-4Z" />
      <path d="M4 7.5 12 11.5l8-4" />
      <path d="M12 11.5v9" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.6 6.5 8.4 6 8.4-6" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-1.4-1-1.6-1-2.6 0-.8.7-1.4 1.5-1.4H16a5 5 0 0 0 5-5c0-4-4-7.5-9-7.5Z" />
      <circle cx="8" cy="11" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 4.5v15" />
      <path d="M4.5 12h15" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 4.5h-9a2 2 0 0 0-2 2v9" />
    </>
  ),
  chev: <path d="m9 6 6 6-6 6" />,
  chevDown: <path d="m6 9 6 6 6-6" />,
  arrow: (
    <>
      <path d="M5 12h13" />
      <path d="m12.5 6 6 6-6 6" />
    </>
  ),
};

const TODO_ICON = { publish: I.globe, embed: I.box, emails: I.mail, design: I.palette };

/* ── The composer — byte-identical between the two page states ────────────── */

function Composer({ minGoalChars }: { minGoalChars: number }) {
  const fetcher = useFetcher<typeof goalAction>();
  const busy = fetcher.state !== "idle";
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [factors, setFactors] = useState("");
  // "How long" defaults from the goal shape and NEVER blocks the draft — the
  // action treats an unparseable length as "let the AI decide" (null).
  const [lengthText, setLengthText] = useState("5–7 questions");
  const [briefOpen, setBriefOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ready = goal.trim().length >= minGoalChars;
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  // rows=1, grows with the goal.
  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const draft = () => {
    if (!ready || busy) return;
    const fields: Record<string, string> = {
      goal: goal.trim(),
      audience: audience.trim(),
      factors: factors.trim(),
    };
    // First 3–7 digit in the free-text length maps onto the existing numeric
    // contract; anything else simply omits it (the action nulls it).
    const num = lengthText.match(/[3-7]/);
    if (num) fields.length = num[0];
    fetcher.submit(fields, { method: "post", action: "/studio/goal" });
  };

  return (
    <>
      <div className="hm-composer">
        <label className="qz-sr-only" htmlFor="hm-goal">
          Your goal
        </label>
        <textarea
          id="hm-goal"
          ref={taRef}
          rows={1}
          value={goal}
          placeholder="Help first-time buyers pick the right snowboard for their terrain and skill level"
          onChange={(e) => {
            setGoal(e.target.value);
            grow();
          }}
        />
        <div className={briefOpen ? "hm-brief is-open" : "hm-brief"}>
          <div className="hm-brief-row">
            <label htmlFor="hm-aud">Who is it for</label>
            <input
              id="hm-aud"
              type="text"
              value={audience}
              placeholder="First-time buyers, 18–34, buying their own board"
              onChange={(e) => setAudience(e.target.value)}
            />
          </div>
          <div className="hm-brief-row">
            <label htmlFor="hm-fac">What decides the answer</label>
            <input
              id="hm-fac"
              type="text"
              value={factors}
              placeholder="Terrain, skill level, height and weight, budget"
              onChange={(e) => setFactors(e.target.value)}
            />
          </div>
          <div className="hm-brief-row">
            <label htmlFor="hm-len">How long</label>
            <input
              id="hm-len"
              type="text"
              value={lengthText}
              onChange={(e) => setLengthText(e.target.value)}
            />
            <p className="hm-brief-note">
              Defaulted from your goal. Change it or leave it — it never blocks the draft.
            </p>
          </div>
        </div>
        <div className="hm-bar">
          <button
            className="hm-addmore"
            type="button"
            aria-expanded={briefOpen}
            onClick={() => setBriefOpen((o) => !o)}
          >
            <HmIcon d={I.plus} width={14} height={14} />
            Audience, factors, length
            <HmIcon d={I.chevDown} className="hm-chev" width={13} height={13} />
          </button>
          <span className="hm-grow" />
          <button
            className={ready ? "hm-go is-ready" : "hm-go"}
            type="button"
            aria-label="Draft my quiz"
            disabled={busy}
            onClick={draft}
          >
            <HmIcon d={I.arrow} />
          </button>
        </div>
      </div>
      {error ? (
        <p className="hm-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="hm-modes">
        <Link className="hm-mode" to="/studio/templates">
          <HmIcon d={I.grid} />
          Browse templates
        </Link>
        {/* FLOW-2 — the step-by-step funnel is the non-AI-first path. */}
        <Link className="hm-mode" to="/studio/onboarding">
          <HmIcon d={I.plus} />
          Start from scratch
        </Link>
        {/* Duplicate lives in each quiz row's ⋯ menu on the quizzes page. */}
        <Link className="hm-mode" to="/studio/quizzes">
          <HmIcon d={I.copy} />
          Duplicate a quiz
        </Link>
      </div>
    </>
  );
}

export default function StudioHome() {
  const data = useLoaderData<typeof loader>();
  const state = data.hasQuizzes ? "has" : "none";
  const { stats } = data;

  return (
    <div className={`home2 is-${state}`}>
      <div className="hm-top">
        <div className="hm-col">
          <h1 className="hm-h1">What should this quiz help someone decide?</h1>
          <Composer minGoalChars={data.minGoalChars} />
          {state === "none" && !data.designSet ? (
            <Link to="/studio/brand" className="hm-nudge">
              <HmIcon d={I.palette} />
              Set up your global design — colors and fonts flow into every quiz
            </Link>
          ) : null}
        </div>
      </div>

      {state === "has" ? (
        <div className="hm-below">
          <div className="hm-col">
            {data.todos.length > 0 ? (
              <section className="hm-section">
                <QzSectionHeader
                  title="Pick up where you left off"
                  count={`${data.todos.length} to do`}
                />
                <div className="hm-card">
                  {data.todos.map((t) => (
                    <Link key={t.kind} to={t.href} className="hm-todo">
                      <span className="hm-todo-ico">
                        <HmIcon d={TODO_ICON[t.kind]} />
                      </span>
                      <span className="hm-todo-main">
                        <b>{t.title}</b>
                        <span>{t.sub}</span>
                      </span>
                      <HmIcon d={I.chev} className="hm-todo-chev" width={16} height={16} />
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="hm-section">
              <QzSectionHeader
                title="Last 30 days"
                action={<Link to="/studio/analytics">Full analytics</Link>}
              />
              <div className="hm-stats">
                <QzStat
                  label="Starts"
                  value={fmtNum(stats.starts)}
                  delta={stats.startsDelta?.text}
                  deltaTone={stats.startsDelta?.up ? "up" : undefined}
                />
                <QzStat
                  label="Completion"
                  value={stats.completion != null ? `${stats.completion}%` : "—"}
                  delta={stats.completionDelta?.text}
                  deltaTone={stats.completionDelta?.up ? "up" : undefined}
                />
                <QzStat
                  label="Emails"
                  value={fmtNum(stats.emails)}
                  delta={stats.emailsDelta?.text}
                  deltaTone={stats.emailsDelta?.up ? "up" : undefined}
                />
                {/* Revenue needs order attribution the app doesn't collect yet —
                    the 4th tile stays the honest published count. */}
                <QzStat label="Published quizzes" value={String(stats.published)} />
              </div>
            </section>

            <section className="hm-section">
              <QzSectionHeader
                title="Your quizzes"
                action={<Link to="/studio/quizzes">All {data.totalQuizzes}</Link>}
              />
              <div className="hm-card">
                {data.rows.map((q) => (
                  <Link key={q.id} to={q.href} className="hm-qrow">
                    <span className="hm-qrow-main">
                      <b>{q.name}</b>
                      <span>{q.meta}</span>
                    </span>
                    <span
                      className={`hm-chip${
                        q.chip === "live" ? " is-live" : q.chip === "setup" ? " is-setup" : ""
                      }`}
                    >
                      {q.chip === "live" ? "Live" : q.chip === "setup" ? "In setup" : "Draft"}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
