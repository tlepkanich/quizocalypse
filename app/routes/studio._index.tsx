import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import type { ReactNode } from "react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzBadge } from "../components/qz";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const recent = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 4,
  });
  return json({
    recent: recent.map((q) => ({ ...q, updatedAt: q.updatedAt.toISOString() })),
  });
};

// Big "what do you want to do" action cards (Quizell Home front door).
const ACTION_ICON: Record<string, ReactNode> = {
  ai: <path d="M12 3l1.7 4.5L18 9l-4.3 1.5L12 15l-1.7-4.5L6 9l4.3-1.5L12 3ZM18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />,
  import: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>,
  scratch: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>,
};

const ACTIONS = [
  { to: "/studio/brand", icon: "ai", title: "Create with AI", blurb: "Let our AI build your quiz for you — perfect if you don't have questions yet." },
  { to: "/studio/new", icon: "import", title: "Import Questions", blurb: "Upload or paste your existing questions to instantly turn them into a quiz." },
  { to: "/studio/new", icon: "scratch", title: "Start from Scratch", blurb: "Start with a blank quiz and add your questions manually." },
];

// Each Inspiration card instantiates a REAL template (with questions wired) via
// the proven /studio/new `template` action — clicking one lands the merchant in
// the builder with a complete starter quiz, not a blank seed. templateId maps to
// quizTemplates.ts; the action 400s on an unknown id, so these must stay in sync.
const INSPIRATION: Array<{ label: string; templateId: string; blurb: string; hue: number }> = [
  { label: "Skincare Routine Finder", templateId: "skincare", blurb: "Match shoppers to a routine by skin type & concern", hue: 205 },
  { label: "Gift Finder", templateId: "gifting", blurb: "Guide shoppers to the perfect gift by recipient & budget", hue: 30 },
  { label: "Style & Fit Finder", templateId: "clothing", blurb: "Style shoppers into the right pieces by taste & fit", hue: 250 },
  { label: "Customer Survey", templateId: "survey_feedback", blurb: "Three quick questions — no products needed", hue: 330 },
  { label: "Lead Capture Funnel", templateId: "lead_qualify", blurb: "Qualify, then capture the email to feed your list", hue: 145 },
];

function BigIcon({ name }: { name: keyof typeof ACTION_ICON }) {
  return (
    <span className="qz-action-icon" aria-hidden="true">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {ACTION_ICON[name]}
      </svg>
    </span>
  );
}

export default function StudioHome() {
  const { recent } = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <h1 className="qz-display" style={{ fontSize: 34, marginBottom: 28 }}>Hello 👋</h1>

      <div className="qz-action-grid">
        {ACTIONS.map((a) => (
          <Link key={a.title} to={a.to} className="qz-card qz-interactive qz-action-card">
            <BigIcon name={a.icon as keyof typeof ACTION_ICON} />
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{a.title}</div>
            <p className="qz-muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>{a.blurb}</p>
          </Link>
        ))}
      </div>

      <section style={{ marginTop: 40 }}>
        <div className="qz-section-head">
          <div>
            <h2 className="qz-h2" style={{ marginBottom: 4 }}>Inspiration</h2>
            <p className="qz-muted" style={{ margin: 0, fontSize: 13.5 }}>
              Pick a ready-made template — it opens in the builder as a complete quiz you can customize.
            </p>
          </div>
        </div>
        <div className="qz-inspo-row">
          {INSPIRATION.map((t) => (
            <Form method="post" action="/studio/new" key={t.label}>
              <input type="hidden" name="intent" value="template" />
              <input type="hidden" name="templateId" value={t.templateId} />
              <button
                type="submit"
                title={t.blurb}
                className="qz-card qz-interactive qz-inspo-card"
                style={{ width: "100%", font: "inherit", border: 0, background: "var(--qz-paper, #fff)", cursor: "pointer", textAlign: "left" }}
              >
                <span
                  className="qz-inspo-thumb"
                  aria-hidden="true"
                  style={{ background: `linear-gradient(135deg, hsl(${t.hue} 70% 92%), hsl(${t.hue} 60% 82%))` }}
                />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</span>
                <span className="qz-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{t.blurb}</span>
              </button>
            </Form>
          ))}
        </div>
      </section>

      {recent.length > 0 ? (
        <section style={{ marginTop: 40 }}>
          <div className="qz-section-head">
            <h2 className="qz-h2">Recent quizzes</h2>
            <Link to="/studio/quizzes" className="qz-btn qz-btn-ghost qz-btn-sm">View all →</Link>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}
          >
            {recent.map((q) => (
              <Link key={q.id} to={`/studio/${q.id}`} className="qz-card qz-interactive" style={{ display: "flex", flexDirection: "column", gap: 8, textDecoration: "none", color: "inherit" }}>
                <div className="qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.01em" }}>{q.name}</span>
                  <QzBadge tone={q.status === "published" ? "ok" : "draft"}>{q.status}</QzBadge>
                </div>
                <div className="qz-dim" style={{ fontSize: 12 }}>
                  updated {new Date(q.updatedAt).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </QzPage>
  );
}
