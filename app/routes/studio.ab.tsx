import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { Quiz } from "../lib/quizSchema";
import { findAbBranches } from "../lib/abAnalytics";
import { QzPage, QzPageHeader, QzCard, QzBadge } from "../components/qz";

// QD-8 — AB Testing: which quizzes run an A/B split, and how each branch is
// weighted. Scans the working draft of every quiz for `ab_split` branch nodes
// (the same detector the Logic view + analytics use). Editing + winner
// promotion live in the builder's Logic view; results in the per-quiz funnel.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id, OR: [{ buildState: null }, { buildState: { not: "step1" } }] },
    select: { id: true, name: true, status: true, draftJson: true },
    orderBy: { updatedAt: "desc" },
  });

  const tests = [];
  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.draftJson);
    if (!parsed.success) continue;
    const branches = findAbBranches(parsed.data);
    if (branches.length === 0) continue;
    tests.push({
      id: q.id,
      name: q.name,
      status: q.status,
      branches: branches.map((b) => ({
        id: b.id,
        label: b.data.label,
        slots: b.data.slots.map((s) => ({ label: s.label, weight: s.weight })),
      })),
    });
  }

  return json({ tests });
};

export default function StudioAb() {
  const data = useLoaderData<typeof loader>();
  return (
    <QzPage>
      <QzPageHeader
        eyebrow="AB Testing"
        title="Experiments"
        subtitle="Split shoppers across quiz variants and let the data pick the winner. Set splits in a quiz's Logic view; watch results in its funnel."
      />

      {data.tests.length === 0 ? (
        <QzCard>
          <p className="qz-muted" style={{ margin: 0 }}>
            No A/B tests running. Open a quiz, add a <strong>Branch</strong> node in the Logic
            view, and set it to <strong>A/B split</strong> to start experimenting.
          </p>
        </QzCard>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {data.tests.map((t) => (
            <QzCard key={t.id}>
              <div className="qz-row qz-row-between" style={{ alignItems: "flex-start", gap: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
                    <h2 className="qz-h2" style={{ margin: 0 }}>{t.name}</h2>
                    <QzBadge tone={t.status === "published" ? "ok" : "draft"}>{t.status}</QzBadge>
                  </div>
                  <p className="qz-dim" style={{ fontSize: 13, margin: "4px 0 0" }}>
                    {t.branches.length} split{t.branches.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="qz-row" style={{ gap: 8, flexShrink: 0 }}>
                  <Link to={`/studio/${t.id}`} className="qz-btn qz-btn-ghost qz-btn-sm">
                    Edit splits
                  </Link>
                  <Link to={`/studio/${t.id}/analytics`} className="qz-btn qz-btn-primary qz-btn-sm">
                    Results →
                  </Link>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                {t.branches.map((b) => {
                  const total = b.slots.reduce((acc, s) => acc + (s.weight || 0), 0) || 1;
                  return (
                    <div key={b.id}>
                      <div className="qz-label" style={{ marginBottom: 6 }}>{b.label}</div>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {b.slots.map((s, i) => (
                          <span
                            key={i}
                            style={{
                              fontSize: 13,
                              padding: "4px 10px",
                              borderRadius: "var(--qz-radius-pill)",
                              background: "color-mix(in srgb, var(--qz-accent) 10%, transparent)",
                              color: "var(--qz-ink-2)",
                            }}
                          >
                            {s.label} · {Math.round(((s.weight || 0) / total) * 100)}%
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </QzCard>
          ))}
        </div>
      )}
    </QzPage>
  );
}
