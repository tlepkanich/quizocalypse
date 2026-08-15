import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { Link, useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzPage, QzPageHeader, QzCard, QzBadge } from "../components/qz";
import { QzMenu, QzModal } from "../components/qz-overlays";
import { computeBenchmarks } from "../lib/quizBenchmarks";
import { quizCardFacts, type QuizCardThumb } from "../lib/quizLibraryCard";
import { publishQuiz } from "../lib/quizPublish";
import { formatDate } from "../lib/formatDate";
import { SHOW_OTHER_BUILD_PATHS } from "../lib/studioFlags";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  // Owner correction (2026-08-01) — mid-funnel drafts (buildState "step1")
  // are VISIBLE now: a quiz abandoned before the last step used to vanish
  // from the library, making the work impossible to resume. Their cards
  // route back into the setup flow instead of the builder.
  const quizzes = await prisma.quiz.findMany({
    // draftJson drives the per-card facts + screen-1 thumbnail (§R-7).
    where: { shopId: shop.id },
    select: { id: true, name: true, status: true, version: true, updatedAt: true, draftJson: true, buildState: true },
    orderBy: { updatedAt: "desc" },
  });
  const eventRows = await prisma.event.findMany({
    where: {
      quizId: { in: quizzes.map((q) => q.id) },
      eventType: { in: ["quiz_engaged", "quiz_completed"] },
    },
    select: { quizId: true, eventType: true, sessionId: true },
    distinct: ["quizId", "eventType", "sessionId"],
  });
  const benchmarks = computeBenchmarks(eventRows);

  // §R-7 — Recs stat + recs-row thumbnails: resolve each quiz's mapped targets
  // (answer target_ids → Category.productIds) to a deduped product set, and pull
  // real product photos for the overlapping thumbnails.
  const factsById = new Map(quizzes.map((q) => [q.id, quizCardFacts(q.draftJson)]));
  const allTargetIds = [...new Set([...factsById.values()].flatMap((f) => f.targetIds))];
  const cats = allTargetIds.length
    ? await prisma.category.findMany({ where: { shopId: shop.id, id: { in: allTargetIds } }, select: { id: true, productIds: true } })
    : [];
  const catProducts = new Map(cats.map((c) => [c.id, c.productIds]));
  const allProductIds = [...new Set(cats.flatMap((c) => c.productIds))];
  const products = allProductIds.length
    ? await prisma.product.findMany({ where: { shopId: shop.id, productId: { in: allProductIds } }, select: { productId: true, imageUrl: true } })
    : [];
  const productImg = new Map(products.map((p) => [p.productId, p.imageUrl]));

  return json({
    averageRate: benchmarks.averageRate,
    quizzes: quizzes.map((q) => {
      const facts = factsById.get(q.id)!;
      const recProductIds = [...new Set(facts.targetIds.flatMap((t) => catProducts.get(t) ?? []))];
      const recThumbs = recProductIds.map((id) => productImg.get(id)).filter((u): u is string => !!u).slice(0, 4);
      return {
        id: q.id,
        name: q.name,
        status: q.status,
        inSetup: q.buildState === "step1",
        version: q.version,
        updatedAt: q.updatedAt.toISOString(),
        bench: benchmarks.byQuiz[q.id] ?? null,
        questions: facts.questions,
        personas: facts.personas,
        recs: recProductIds.length,
        recThumbs,
        thumb: facts.thumb,
      };
    }),
  });
};

// §R-7 — library quick actions. Shop-scoped; mutating intents only. Publish
// reuses the same gated publishQuiz the builder uses (PublishError blocks).
export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  if (!id) return json({ ok: false, error: "Missing id" }, { status: 400 });

  const quiz = await prisma.quiz.findFirst({
    where: { id, shopId: shop.id },
    select: { id: true, name: true, draftJson: true, status: true },
  });
  if (!quiz) return json({ ok: false, error: "Not found" }, { status: 404 });

  if (intent === "delete") {
    await prisma.quiz.delete({ where: { id } });
    return json({ ok: true });
  }
  if (intent === "duplicate") {
    const copy = await prisma.quiz.create({
      data: {
        shopId: shop.id,
        name: `${quiz.name} (copy)`,
        status: "draft",
        version: 0,
        draftJson: quiz.draftJson as object,
      },
      select: { id: true },
    });
    return redirect(`/studio/${copy.id}`);
  }
  if (intent === "unpublish") {
    // /q/:id serves whenever publishedJson exists (it ignores `status`), so a
    // real unpublish must CLEAR the baked doc → the storefront 404s. Version
    // history stays in QuizVersion; relaunching is a fresh publish from draft.
    await prisma.quiz.update({
      where: { id },
      data: { status: "draft", publishedJson: Prisma.DbNull },
    });
    return json({ ok: true });
  }
  if (intent === "publish") {
    try {
      await publishQuiz(prisma, { quizId: id, shopId: shop.id });
      return json({ ok: true });
    } catch (e) {
      return json(
        { ok: false, error: e instanceof Error ? e.message : "Publish failed" },
        { status: 422 },
      );
    }
  }
  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

type QuizRow = ReturnType<typeof useLoaderData<typeof loader>>["quizzes"][number];
type StatusFilter = "all" | "live" | "draft";
type SortKey = "recent" | "name" | "status";

// §R-7 — the card preview: a render of the quiz's FIRST screen in the
// merchant's OWN brand tokens (colors/font/logo), never our violet. A brand-new
// quiz with nothing built falls back to a neutral "New quiz · Start" placeholder.
function QuizCardPreview({ thumb, compact }: { thumb: QuizCardThumb; compact?: boolean }) {
  if (thumb.isNew) {
    return (
      <div className={`qz-qprev qz-qprev-empty${compact ? " is-compact" : ""}`} aria-hidden>
        <div className="qz-qprev-logo qz-qprev-logo-neutral">Q</div>
        {!compact ? <div className="qz-qprev-h">New quiz</div> : null}
        <span className="qz-qprev-start-neutral">Start</span>
      </div>
    );
  }
  const brand = thumb.primary;
  return (
    <div
      className={`qz-qprev${compact ? " is-compact" : ""}`}
      aria-hidden
      style={{
        background: `linear-gradient(160deg, color-mix(in srgb, ${brand} 7%, ${thumb.bg}), color-mix(in srgb, ${brand} 15%, ${thumb.bg}))`,
        ...(thumb.font ? { fontFamily: thumb.font } : {}),
      }}
    >
      {thumb.logoUrl ? (
        <img className="qz-qprev-logoimg" src={thumb.logoUrl} alt="" />
      ) : (
        <div className="qz-qprev-logo" style={{ background: brand }}>{(thumb.headline || "Q").charAt(0).toUpperCase()}</div>
      )}
      <div className="qz-qprev-h" style={{ color: thumb.text }}>{thumb.headline}</div>
      {!compact && thumb.subtext ? <div className="qz-qprev-sub" style={{ color: thumb.text }}>{thumb.subtext}</div> : null}
      <span className="qz-qprev-start" style={{ background: brand }}>{thumb.buttonLabel}</span>
    </div>
  );
}

function Facts({ q }: { q: QuizRow }) {
  const parts = [
    `${q.questions} question${q.questions === 1 ? "" : "s"}`,
    `${q.personas} persona${q.personas === 1 ? "" : "s"}`,
    `v${q.version}`,
    `updated ${formatDate(q.updatedAt)}`,
  ];
  return (
    <div className="qz-dim" style={{ fontSize: 12 }}>
      {parts.join(" · ")}
    </div>
  );
}

export default function StudioQuizzes() {
  const { quizzes } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const act = (intent: string, id: string) => submit({ intent, id }, { method: "post" });
  const isBusy = navigation.state !== "idle";

  const shown = useMemo(() => {
    const qq = query.trim().toLowerCase();
    const rows = quizzes.filter((q) => {
      if (status === "live" && q.status !== "published") return false;
      if (status === "draft" && q.status === "published") return false;
      if (qq && !q.name.toLowerCase().includes(qq)) return false;
      return true;
    });
    rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.updatedAt.localeCompare(a.updatedAt); // recent
    });
    return rows;
  }, [quizzes, query, status, sort]);

  // Where "open" leads: a mid-funnel draft resumes the setup flow where it
  // left off; everything else opens the builder.
  const openTo = (q: QuizRow) => (q.inSetup ? `/studio/onboarding/${q.id}` : `/studio/${q.id}`);

  const menuItems = (q: QuizRow) =>
    q.inSetup
      ? [
          // Setup drafts: publish/share/preview don't apply yet — resume or delete.
          { label: "Resume setup", onSelect: () => navigate(`/studio/onboarding/${q.id}`) },
          { label: "Delete", tone: "crit" as const, onSelect: () => setPendingDelete({ id: q.id, name: q.name }) },
        ]
      : menuItemsBuilt(q);
  const menuItemsBuilt = (q: QuizRow) => [
    { label: "Preview", onSelect: () => window.open(`/q/${q.id}`, "_blank", "noopener") },
    { label: "Share", onSelect: () => navigate(`/studio/${q.id}/embed`) },
    { label: "Duplicate", onSelect: () => act("duplicate", q.id) },
    // ANALYTICS P0 — deep-link straight to the quiz's own analytics page (the
    // home is a comparison table now; the old #quiz- anchors are gone).
    { label: "Analytics", onSelect: () => navigate(`/studio/${q.id}/analytics`) },
    // Ported engagement surface (§L) — kept through the design merge.
    { label: "Engagement", onSelect: () => navigate(`/studio/${q.id}/engagement`) },
    q.status === "published"
      ? { label: "Unpublish", onSelect: () => act("unpublish", q.id) }
      : { label: "Publish", onSelect: () => act("publish", q.id) },
    { label: "Delete", tone: "crit" as const, onSelect: () => setPendingDelete({ id: q.id, name: q.name }) },
  ];

  const overflowTrigger = (
    <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm qz-lib-more" aria-label="More actions" title="More actions">
      ⋯
    </button>
  );

  return (
    <QzPage>
      <QzPageHeader
        title="Quizzes"
        actions={
          <div className="qz-row" style={{ gap: 8 }}>
            {SHOW_OTHER_BUILD_PATHS && (
              <Link to="/studio/new" className="qz-btn qz-btn-ghost qz-btn-sm">
                New quiz
              </Link>
            )}
            {/* FLOW-1 — goal-first is the primary create path; FLOW-3 adds the
                Generate-Quiz-Templates entry; the existing funnel stays
                alongside (Flow 2 keeps today's flow). */}
            <Link to="/studio/onboarding" className="qz-btn qz-btn-ghost">
              ✨ Build with AI
            </Link>
            <Link to="/studio/templates" className="qz-btn qz-btn-ghost">
              ✦ Generate quiz templates
            </Link>
            <Link to="/studio/goal" className="qz-btn qz-btn-accent">
              ✎ Write your goal →
            </Link>
          </div>
        }
      />

      {quizzes.length === 0 ? (
        /* QRTZ-S2 — states.mjs mt- pattern (zero-quizzes): icon tile, one-line
           title, ≤30ch body, ONE action. Copy verbatim from the mock. The
           other create paths stay reachable in the page header. */
        <QzCard>
          <div className="qz-mt">
            <span className="qz-mt-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
                <path d="M3.5 10h17" />
              </svg>
            </span>
            <b>No quizzes yet</b>
            <p>Describe a decision your shoppers have to make and we will draft one.</p>
            <Link to="/studio/goal" className="qz-mt-btn">
              Start a quiz
            </Link>
          </div>
        </QzCard>
      ) : (
        <>
          {/* §R-7 — operate toolbar: search · status · sort · grid/list. */}
          <div className="qz-lib-toolbar">
            <input
              className="qz-input qz-lib-search"
              type="search"
              placeholder="Search quizzes…"
              value={query}
              aria-label="Search quizzes"
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="qz-segmented" role="group" aria-label="Filter by status">
              {(["all", "live", "draft"] as const).map((s) => (
                <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} style={{ textTransform: "capitalize" }}>
                  {s}
                </button>
              ))}
            </div>
            <select className="qz-select qz-lib-sort" value={sort} aria-label="Sort" onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="recent">Recent</option>
              <option value="name">Name A–Z</option>
              <option value="status">Status</option>
            </select>
            <div className="qz-segmented" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "grid"} onClick={() => setView("grid")} title="Grid" aria-label="Grid view">▦</button>
              <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")} title="List" aria-label="List view">≣</button>
            </div>
          </div>

          {shown.length === 0 ? (
            /* QRTZ-S2 — states.mjs mt- pattern (no-results): a filter matching
               nothing is NOT the same as having nothing — it NAMES the query,
               and its action CLEARS the filter rather than creating anything. */
            <div className="qz-mt">
              <span className="qz-mt-ico">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="11" cy="11" r="6.5" />
                  <path d="m16 16 4.5 4.5" />
                </svg>
              </span>
              <b>
                {query.trim()
                  ? `No quizzes match “${query.trim()}”`
                  : `No ${status === "live" ? "live" : "draft"} quizzes`}
              </b>
              <p>
                {query.trim()
                  ? "Try a shorter word, or clear the search."
                  : "Clear the filter to see every quiz."}
              </p>
              <button
                type="button"
                className="qz-mt-btn"
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                }}
              >
                {query.trim() ? "Clear search" : "Clear filter"}
              </button>
            </div>
          ) : view === "grid" ? (
            <div className="qz-qcard-grid">
              {shown.map((q) => (
                <div key={q.id} className="qz-qcard">
                  {/* Preview = the quiz's first screen in the merchant's brand;
                      the whole preview opens the builder, hover reveals actions. */}
                  <div
                    className="qz-qcard-preview"
                    role="button"
                    tabIndex={0}
                    aria-label={q.inSetup ? `Resume setting up ${q.name}` : `Open ${q.name} in the builder`}
                    onClick={() => navigate(openTo(q))}
                    onKeyDown={(e) => { if (e.key === "Enter") navigate(openTo(q)); }}
                  >
                    <span className={`qz-qcard-status is-${q.status === "published" ? "live" : "draft"}`}>
                      <span className="qz-qcard-dot" aria-hidden />
                      {q.status === "published" ? "Live" : q.inSetup ? "In setup" : "Draft"}
                    </span>
                    <div className="qz-qcard-shot"><QuizCardPreview thumb={q.thumb} /></div>
                    <div className="qz-qcard-float">
                      {q.inSetup ? null : (
                        <a className="qz-qcard-fbtn" href={`/q/${q.id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Preview</a>
                      )}
                      <button type="button" className="qz-qcard-fbtn is-solid" onClick={(e) => { e.stopPropagation(); navigate(openTo(q)); }}>
                        {q.inSetup ? "Resume setup" : "Open builder"}
                      </button>
                    </div>
                  </div>
                  <div className="qz-qcard-body">
                    <div className="qz-qcard-titlerow">
                      <Link to={openTo(q)} className="qz-qcard-title">{q.name}</Link>
                      <QzMenu trigger={overflowTrigger} items={menuItems(q)} />
                    </div>
                    <div className="qz-qcard-upd">Updated {formatDate(q.updatedAt)} · v{q.version}</div>
                    <div className="qz-qcard-trio">
                      <div className="qz-qcard-stat"><span className="num">{q.questions}</span><span className="lab">Questions</span></div>
                      <div className="qz-qcard-stat"><span className="num">{q.personas}</span><span className="lab">Personas</span></div>
                      <div className="qz-qcard-stat"><span className="num is-rec">{q.recs > 0 ? q.recs : "—"}</span><span className="lab">Recs</span></div>
                    </div>
                    <div className="qz-qcard-recrow">
                      {q.recThumbs.length ? (
                        <>
                          <span className="qz-qcard-reclbl">Recommends</span>
                          <div className="qz-qcard-stack">
                            {q.recThumbs.map((src, i) => <img key={i} className="qz-qcard-prod" src={src} alt="" loading="lazy" />)}
                            {q.recs > q.recThumbs.length ? <span className="qz-qcard-more">+{q.recs - q.recThumbs.length}</span> : null}
                          </div>
                        </>
                      ) : (
                        <span className="qz-qcard-reclbl qz-dim">Not mapped yet</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="qz-lib-list">
              {shown.map((q) => (
                <QzCard key={q.id} className="qz-lib-row">
                  <QuizCardPreview thumb={q.thumb} compact />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="qz-row" style={{ gap: 8, alignItems: "center" }}>
                      <span className="qz-lib-title" style={{ fontSize: 15 }}>{q.name}</span>
                      <QzBadge tone={q.status === "published" ? "ok" : "draft"}>
                        {q.status === "published" ? "Live" : q.inSetup ? "In setup" : "Draft"}
                      </QzBadge>
                    </div>
                    <Facts q={q} />
                  </div>
                  <div className="qz-row" style={{ gap: 8, alignItems: "center", flex: "0 0 auto" }}>
                    <Link to={openTo(q)} className="qz-btn qz-btn-primary qz-btn-sm">
                      {q.inSetup ? "Resume setup →" : "Open builder →"}
                    </Link>
                    <QzMenu trigger={overflowTrigger} items={menuItems(q)} placement="bottom" />
                  </div>
                </QzCard>
              ))}
            </div>
          )}
        </>
      )}

      {pendingDelete ? (
        <QzModal
          open
          destructive
          title="Delete quiz?"
          onClose={() => setPendingDelete(null)}
          footer={
            <div className="qz-row" style={{ gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="qz-btn qz-btn-ghost qz-btn-sm" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="qz-btn qz-btn-danger qz-btn-sm"
                disabled={isBusy}
                onClick={() => {
                  act("delete", pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          }
        >
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>{pendingDelete.name}</strong> will be permanently removed. This can’t be undone.
          </p>
        </QzModal>
      ) : null}
    </QzPage>
  );
}
