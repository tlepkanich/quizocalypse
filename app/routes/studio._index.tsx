import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { useEffect, useState, type ReactNode } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { computeBenchmarks } from "../lib/quizBenchmarks";
import { QzPage, QzBadge, QzStat, QzStatGrid, QzSectionHeader } from "../components/qz";
import { formatDate } from "../lib/formatDate";

// P2 Edit 6 — Home is a full dashboard (welcome, stat row, illustrated hero,
// recent quizzes, "starts this week" chart) + Edit 12 quick-action tiles. Stats
// reuse the proven account aggregation (computeBenchmarks) from the analytics route.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();

  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const quizIds = quizzes.map((q) => q.id);

  // 7-day window, aligned to local midnight of the earliest day.
  const since = new Date(Date.now() - 6 * 24 * 3600 * 1000);
  since.setHours(0, 0, 0, 0);

  const [funnelRows, contacts, weekRows] = await Promise.all([
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: { in: ["quiz_engaged", "quiz_completed"] } },
      select: { quizId: true, eventType: true, sessionId: true },
      distinct: ["quizId", "eventType", "sessionId"],
    }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id } } }),
    prisma.event.findMany({
      where: { quizId: { in: quizIds }, eventType: "quiz_engaged", ts: { gte: since } },
      select: { ts: true },
    }),
  ]);

  const benchmarks = computeBenchmarks(funnelRows);
  let started = 0;
  let completed = 0;
  for (const id of quizIds) {
    const b = benchmarks.byQuiz[id];
    if (b) {
      started += b.started;
      completed += b.completed;
    }
  }

  // Daily "quiz starts" for the mini chart (oldest → today).
  const dayMs = 24 * 3600 * 1000;
  const startDay = since.getTime();
  const week = Array.from({ length: 7 }, (_, i) => ({
    label: new Date(startDay + i * dayMs).toLocaleDateString(undefined, { weekday: "short" }),
    count: 0,
  }));
  for (const e of weekRows) {
    const idx = Math.floor((new Date(e.ts).getTime() - startDay) / dayMs);
    const bucket = idx >= 0 && idx < 7 ? week[idx] : undefined;
    if (bucket) bucket.count += 1;
  }

  return json({
    started,
    completed,
    completionRate: benchmarks.averageRate, // 0–100 int, or null
    contacts,
    published: quizzes.filter((q) => q.status === "published").length,
    week,
    recent: quizzes.slice(0, 4).map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      updatedAt: q.updatedAt.toISOString(),
    })),
  });
};

// P2 Edit 12 — quick-action entry tiles. All destinations exist (/studio/new
// redirects into the AI flow in standalone, so no dead links).
// P3 Edit 5 — three action cards (Create with AI is now the hero's CTA). A/B
// testing + Strategy ideas are v1 PLACEHOLDERS: shown with a "Soon" tag, not
// clickable (no `to`).
const QUICK_ACTIONS: Array<{ to?: string; icon: ReactNode; title: string; blurb: string; hue: string; soon?: boolean }> = [
  {
    to: "/studio/new",
    hue: "var(--qz-pastel-mint)",
    title: "Create manually",
    blurb: "Start from scratch and add your own questions.",
    icon: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
      </>
    ),
  },
  {
    hue: "var(--qz-pastel-amber)",
    title: "A/B testing",
    blurb: "Run experiments to find what converts.",
    soon: true,
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20V8" />,
  },
  {
    hue: "var(--qz-pastel-rose)",
    title: "Strategy ideas",
    blurb: "AI-suggested quiz angles for your store.",
    soon: true,
    icon: (
      <>
        <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.2 1 2.5h6c0-1.3.3-1.8 1-2.5A6 6 0 0 0 12 3Z" />
        <path d="M9 20h6M10 22h4" />
      </>
    ),
  },
];

function TileIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export default function StudioHome() {
  const { started, completionRate, contacts, published, week, recent } = useLoaderData<typeof loader>();
  const maxWeek = Math.max(1, ...week.map((d) => d.count));

  // Welcome intro — pops in on load (emoji waves), then collapses after ~7s and
  // the page slides up to fill. SSR renders it visible so there's no flash.
  const [welcomeGone, setWelcomeGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWelcomeGone(true), 7000);
    return () => clearTimeout(t);
  }, []);

  return (
    <QzPage width="wide">
      <div className={`qz-home-welcome${welcomeGone ? " is-gone" : ""}`}>
        <h1 className="qz-display" style={{ fontSize: 38, letterSpacing: "-0.01em", lineHeight: 1.1, margin: 0 }}>
          Welcome back <span className="qz-home-wave" aria-hidden>👋</span>
        </h1>
      </div>

      {/* 1 — Hero (Edit 5) */}
      <div className="qz-card qz-hero-banner">
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="qz-label" style={{ color: "var(--qz-accent-ink)" }}>Get started</div>
          <h2 className="qz-h1" style={{ margin: "6px 0 6px" }}>Launch your next quiz</h2>
          <p className="qz-muted" style={{ margin: "0 0 16px", maxWidth: 420, fontSize: 14 }}>
            Turn browsers into buyers — build a guided quiz that recommends the right products.
          </p>
          <Link to="/studio/onboarding" className="qz-btn qz-btn-primary">Create with AI</Link>
        </div>
        <HeroArt />
        {/* A sparkle that runs across the banner every ~8s to draw the eye. */}
        <span className="qz-hero-spark" aria-hidden>✨</span>
      </div>

      {/* 2 — 3 action cards (Edit 5); A/B + Strategy are "Soon" placeholders */}
      <div className="qz-grid qz-grid-3">
        {QUICK_ACTIONS.map((a) => {
          const inner = (
            <>
              <span className="qz-quick-icon" style={{ background: a.hue }} aria-hidden>
                <TileIcon>{a.icon}</TileIcon>
              </span>
              <div className="qz-row" style={{ gap: 8 }}>
                <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{a.title}</span>
                {a.soon ? <span className="qz-soon-tag">Soon</span> : null}
              </div>
              <p className="qz-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.45 }}>{a.blurb}</p>
            </>
          );
          return a.to ? (
            <Link key={a.title} to={a.to} className="qz-card qz-quick" style={{ textDecoration: "none", color: "inherit" }}>
              {inner}
            </Link>
          ) : (
            <div key={a.title} className="qz-card qz-quick is-soon" aria-disabled="true">
              {inner}
            </div>
          );
        })}
      </div>

      {/* 3 — 4 KPI tiles: white with a purple accent bar + purple number. */}
      <QzStatGrid cards>
        <QzStat label="Quiz starts" value={String(started)} accent />
        <QzStat label="Completion rate" value={completionRate != null ? `${completionRate}%` : "—"} accent />
        <QzStat label="Emails captured" value={String(contacts)} accent />
        <QzStat label="Published quizzes" value={String(published)} accent />
      </QzStatGrid>

      {/* 4 — Recent quizzes + chart (Edit 5) */}
      <div className="qz-grid qz-grid-2" style={{ alignItems: "start" }}>
        <div className="qz-card">
          <QzSectionHeader
            title="Recent quizzes"
            action={<Link to="/studio/quizzes" className="qz-btn qz-btn-ghost qz-btn-sm">View all →</Link>}
          />
          {recent.length === 0 ? (
            <p className="qz-muted" style={{ margin: 0, fontSize: 13.5 }}>No quizzes yet — create your first above.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {recent.map((q, i) => (
                <Link
                  key={q.id}
                  to={`/studio/${q.id}`}
                  className="qz-row qz-row-between qz-recent-row"
                  style={{ textDecoration: "none", color: "inherit", borderTop: i === 0 ? "none" : "1px solid var(--qz-rule-2)" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.name}</div>
                    <div className="qz-dim" style={{ fontSize: 12 }}>updated {formatDate(q.updatedAt)}</div>
                  </div>
                  <QzBadge tone={q.status === "published" ? "ok" : "draft"}>{q.status}</QzBadge>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="qz-card">
          <QzSectionHeader title="Quiz starts this week" />
          <div className="qz-weekchart" aria-hidden>
            {week.map((d, i) => (
              <div key={i} className="qz-weekchart-col">
                <div className="qz-weekchart-bar" style={{ height: `${Math.round((d.count / maxWeek) * 100)}%` }} title={`${d.count} starts`} />
                <span className="qz-weekchart-label">{d.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </QzPage>
  );
}

// Tasteful on-brand inline-SVG illustration (interim; the illustration set is a
// design open item). Soft pastel shapes + one violet accent.
function HeroArt() {
  return (
    <svg className="qz-hero-art" viewBox="0 0 200 140" fill="none" aria-hidden>
      {/* soft color blobs behind the card */}
      <circle className="qz-heroart-a" cx="152" cy="50" r="54" fill="var(--qz-pastel-violet)" />
      <circle className="qz-heroart-b" cx="66" cy="110" r="32" fill="var(--qz-pastel-rose)" />
      {/* a simple, clear quiz screen (lightly blurred for a soft, live feel) */}
      <g className="qz-heroart-card">
        <rect x="30" y="16" width="146" height="108" rx="16" fill="var(--qz-paper)" stroke="var(--qz-accent)" strokeWidth="1.5" />
        {/* progress bar */}
        <rect x="46" y="28" width="114" height="5" rx="2.5" fill="var(--qz-ink-25)" />
        <rect x="46" y="28" width="46" height="5" rx="2.5" fill="var(--qz-accent)" />
        {/* question line */}
        <rect x="46" y="44" width="92" height="8" rx="4" fill="var(--qz-ink-2)" />
        {/* two answer options — first selected */}
        <rect x="46" y="62" width="114" height="17" rx="8.5" fill="var(--qz-accent-wash)" stroke="var(--qz-accent)" strokeWidth="1.5" />
        <rect x="58" y="68" width="64" height="5" rx="2.5" fill="var(--qz-accent)" />
        <rect x="46" y="85" width="114" height="17" rx="8.5" fill="var(--qz-cream-2)" />
        <rect x="58" y="91" width="52" height="5" rx="2.5" fill="var(--qz-ink-25)" />
        {/* next button */}
        <rect x="120" y="108" width="44" height="12" rx="6" fill="var(--qz-accent)" />
      </g>
    </svg>
  );
}
