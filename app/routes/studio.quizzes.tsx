import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { Link, useFetcher, useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import { Search } from "lucide-react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzCard, QzSegmented } from "../components/qz";
import { QzMenu, QzModal, QzPopover } from "../components/qz-overlays";
import { computeBenchmarks } from "../lib/quizBenchmarks";
import { quizCardFacts, type QuizCardThumb } from "../lib/quizLibraryCard";
import { publishQuiz } from "../lib/quizPublish";
import { refreshBucketMembership } from "../lib/bucketPersist.server";
import { formatDate } from "../lib/formatDate";
import type { action as goalAction } from "./studio.goal";

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

  // §R-7 — Recs figure + popover: resolve each quiz's mapped targets
  // (answer target_ids → Category.productIds) to a deduped product set, and
  // pull the first 8 named products (with photos) for the read-only popover.
  const factsById = new Map(quizzes.map((q) => [q.id, quizCardFacts(q.draftJson)]));
  const allTargetIds = [...new Set([...factsById.values()].flatMap((f) => f.targetIds))];
  const cats = allTargetIds.length
    ? await prisma.category.findMany({ where: { shopId: shop.id, id: { in: allTargetIds } }, select: { id: true, productIds: true } })
    : [];
  const catProducts = new Map(cats.map((c) => [c.id, c.productIds]));
  const allProductIds = [...new Set(cats.flatMap((c) => c.productIds))];
  const products = allProductIds.length
    ? await prisma.product.findMany({ where: { shopId: shop.id, productId: { in: allProductIds } }, select: { productId: true, title: true, imageUrl: true } })
    : [];
  const productById = new Map(products.map((p) => [p.productId, p]));

  return json({
    averageRate: benchmarks.averageRate,
    // Segment counts — the rows are already in memory, so this is free.
    counts: {
      all: quizzes.length,
      live: quizzes.filter((q) => q.status === "published").length,
      draft: quizzes.filter((q) => q.status !== "published").length,
    },
    quizzes: quizzes.map((q) => {
      const facts = factsById.get(q.id)!;
      const recProductIds = [...new Set(facts.targetIds.flatMap((t) => catProducts.get(t) ?? []))];
      const recProducts = recProductIds.slice(0, 8).map((id) => {
        const p = productById.get(id);
        return { id, title: p?.title ?? "Untitled product", imageUrl: p?.imageUrl ?? null };
      });
      return {
        id: q.id,
        name: q.name,
        status: q.status,
        inSetup: q.buildState === "step1",
        // version stays on the row for the ⋯ menu; it is simply not rendered.
        version: q.version,
        updatedAt: q.updatedAt.toISOString(),
        bench: benchmarks.byQuiz[q.id] ?? null,
        questions: facts.questions,
        personas: facts.personas,
        recs: recProductIds.length,
        recProducts,
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
      // Stale-snapshot fix — same pre-publish membership refresh as the editor's
      // publish seam (quizEditorIO), so the quiz-list relaunch path never bakes
      // outdated collection membership into target_product_ids_map.
      await refreshBucketMembership(shop.id, id);
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
type SortKey = "recent" | "name" | "oldest";

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

// §3.8 — one status tag, weighted not equal, same tag in both views.
function StatusTag({ status, inSetup }: { status: string; inSetup: boolean }) {
  const kind = status === "published" ? "live" : inSetup ? "setup" : "draft";
  const label = kind === "live" ? "Live" : kind === "setup" ? "In setup" : "Draft";
  return <span className={`qz-qtag is-${kind}`}><i aria-hidden /> {label}</span>;
}

// §3.7 — the recs popover body. Read-only: there is no edit affordance and
// there must not be one — what a quiz recommends is a builder decision.
function RecsPop({ q }: { q: QuizRow }) {
  return (
    <div className="qz-recpop">
      <div className="qz-recpop-head">
        <b>{q.recs} product{q.recs === 1 ? "" : "s"} recommended</b>
        {q.recProducts.length < q.recs ? <span>showing {q.recProducts.length}</span> : null}
      </div>
      <div className="qz-recpop-list">
        {q.recProducts.map((p) => (
          <div className="qz-recpop-row" key={p.id}>
            {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <span className="qz-recpop-ph" aria-hidden />}
            <span>{p.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// §3.3 — the Create quiz dialog: the Home page's goal composer, in a modal.
// Same question, same placeholder, same three secondary paths — a merchant
// meets one composer, not two. Submits to studio.goal's action (FLOW-1), which
// redirects to /studio/onboarding/:quizId; a too-short goal renders the
// action's honest 400 copy inline instead of blocking silently.
function CreateQuizDialog({ onClose }: { onClose: () => void }) {
  const fetcher = useFetcher<typeof goalAction>();
  const busy = fetcher.state !== "idle";
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [factors, setFactors] = useState("");
  const [lengthText, setLengthText] = useState("5–7 questions");
  const [briefOpen, setBriefOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const error = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const start = () => {
    if (busy) return;
    if (!goal.trim()) {
      taRef.current?.focus();
      return;
    }
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
    <QzModal open width={620} className="qz-create-modal" onClose={onClose} initialFocusRef={taRef}>
      <h2 className="qz-display" style={{ fontSize: 25, textAlign: "center", margin: "0 0 16px", color: "var(--qz-ink)" }}>
        What should this quiz help someone decide?
      </h2>
      <div className="qz-goalbox">
        <label className="qz-sr-only" htmlFor="qz-create-goal">Your goal</label>
        <textarea
          id="qz-create-goal"
          ref={taRef}
          rows={2}
          value={goal}
          placeholder="Help first-time buyers pick the right snowboard for their terrain and skill level"
          onChange={(e) => {
            setGoal(e.target.value);
            grow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              start();
            }
          }}
        />
        <div className={briefOpen ? "qz-goalbox-brief is-open" : "qz-goalbox-brief"}>
          <div>
            <label htmlFor="qz-create-aud">Who is it for</label>
            <input
              id="qz-create-aud"
              className="qz-input"
              type="text"
              value={audience}
              placeholder="First-time buyers, 18–34, buying their own board"
              onChange={(e) => setAudience(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="qz-create-fac">What decides the answer</label>
            <input
              id="qz-create-fac"
              className="qz-input"
              type="text"
              value={factors}
              placeholder="Terrain, skill level, height and weight, budget"
              onChange={(e) => setFactors(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="qz-create-len">How long</label>
            <input
              id="qz-create-len"
              className="qz-input"
              type="text"
              value={lengthText}
              onChange={(e) => setLengthText(e.target.value)}
            />
          </div>
        </div>
        <div className="qz-goalbox-foot">
          <button type="button" className="qz-goalbox-more" aria-expanded={briefOpen} onClick={() => setBriefOpen((o) => !o)}>
            ＋ Audience, factors, length ⌄
          </button>
          <button
            type="button"
            className="qz-goalbox-go"
            aria-label="Start setup with this goal"
            aria-busy={busy}
            disabled={busy}
            onClick={start}
          >
            →
          </button>
        </div>
      </div>
      {error ? <p className="qz-goal-err" role="alert">{error}</p> : null}
      <div className="qz-goal-extras">
        <Link to="/studio/templates" className="qz-btn qz-btn-sm">Browse templates</Link>
        <Link to="/studio/new" className="qz-btn qz-btn-sm">Start from scratch</Link>
        {/* Duplicate lives in each quiz's ⋯ menu — close so the merchant can reach it. */}
        <button type="button" className="qz-btn qz-btn-sm" onClick={onClose}>
          Duplicate a quiz
        </button>
      </div>
    </QzModal>
  );
}

export default function StudioQuizzes() {
  const { quizzes, counts } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  // §3.6 — the table is the default view (density: 14 rows a screen against
  // the grid's 8); the grid is the browse mode.
  const [view, setView] = useState<"grid" | "table">("table");
  const [creating, setCreating] = useState(false);
  const [recsFor, setRecsFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const act = (intent: string, id: string) => submit({ intent, id }, { method: "post" });
  const isBusy = navigation.state !== "idle";

  // §3.7 — the recs popover also closes when the content column scrolls
  // (its own list scrolling inside stays open).
  useEffect(() => {
    if (!recsFor) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(".qz-popover")) return;
      setRecsFor(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [recsFor]);

  // Open/close for one quiz's popover. On open the overlay registry closes the
  // previous popover, whose close callback must not clobber the new selection —
  // hence the "only clear your own id" guard.
  const recsOpenChange = (id: string) => (open: boolean) =>
    setRecsFor((cur) => (open ? id : cur === id ? null : cur));

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
      // §3.4 — "Oldest first" finds the abandoned drafts at the bottom of the pile.
      if (sort === "oldest") return a.updatedAt.localeCompare(b.updatedAt);
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

  const recsTrigger = (q: QuizRow, cls: string, body: ReactNode) => (
    <QzPopover
      placement="bottom"
      maxWidth={296}
      open={recsFor === q.id}
      onOpenChange={recsOpenChange(q.id)}
      trigger={
        <button type="button" className={cls} aria-label={`Show the ${q.recs} products ${q.name} recommends`}>
          {body}
        </button>
      }
      content={<RecsPop q={q} />}
    />
  );

  return (
    <div className="qz-lib-main">
      {/* §3.2 — one title, ONE accent action. The h1 keeps the shipped
          .qz-page-header .qz-display rule (38/700/-0.01em/1.1) untouched. */}
      <header className="qz-page-header qz-lib-header">
        <h1 className="qz-display">Quizzes</h1>
        <button type="button" className="qz-btn qz-btn-accent" onClick={() => setCreating(true)}>
          Create quiz →
        </button>
      </header>

      {quizzes.length === 0 ? (
        /* QRTZ-S2 — states.mjs mt- pattern (zero-quizzes): icon tile, one-line
           title, ≤30ch body, ONE action — it opens the create dialog, where
           every other build path now lives. */
        <div className="qz-lib-body">
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
              <button type="button" className="qz-mt-btn" onClick={() => setCreating(true)}>
                Start a quiz
              </button>
            </div>
          </QzCard>
        </div>
      ) : (
        <>
          {/* §3.4 — sticky operate toolbar: search · status (counts) · sort · view. */}
          <div className="qz-lib-toolbar">
            <div className="qz-lib-search">
              <Search size={14} strokeWidth={2} aria-hidden />
              <input
                className="qz-input"
                type="search"
                placeholder="Search quizzes…"
                value={query}
                aria-label="Search quizzes"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <QzSegmented
              ariaLabel="Filter by status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "live", label: "Live", count: counts.live },
                { value: "draft", label: "Draft", count: counts.draft },
              ]}
            />
            <select className="qz-select qz-lib-sort" value={sort} aria-label="Sort" onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="recent">Recently edited</option>
              <option value="name">Name A–Z</option>
              <option value="oldest">Oldest first</option>
            </select>
            <QzSegmented
              ariaLabel="View"
              value={view}
              onChange={setView}
              options={[
                {
                  value: "grid",
                  title: "Grid view",
                  label: (
                    <>
                      <span aria-hidden>▦</span>
                      <span className="qz-sr-only">Grid view</span>
                    </>
                  ),
                },
                {
                  value: "table",
                  title: "Table view",
                  label: (
                    <>
                      <span aria-hidden>≣</span>
                      <span className="qz-sr-only">Table view</span>
                    </>
                  ),
                },
              ]}
            />
          </div>

          <div className="qz-lib-body">
            {shown.length === 0 ? (
              /* §5 — a filter matching nothing is NOT the same as having
                 nothing: dashed paper card, and the action CLEARS the filter. */
              <div className="qz-lib-empty">
                <div className="qz-mt">
                  <span className="qz-mt-ico">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="11" cy="11" r="6.5" />
                      <path d="m16 16 4.5 4.5" />
                    </svg>
                  </span>
                  <b>No quizzes match that</b>
                  <p>Try a different search, or clear the Live / Draft filter.</p>
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
              </div>
            ) : view === "grid" ? (
              <div className="qz-qcard-grid">
                {shown.map((q) => (
                  <article key={q.id} className="qz-qcard">
                    {/* §3.5 — state first, then their brand, the name, the numbers. */}
                    <div className="qz-qcard-head">
                      <StatusTag status={q.status} inSetup={q.inSetup} />
                      <span className="qz-qcard-when">Edited {formatDate(q.updatedAt)}</span>
                    </div>

                    <div
                      className="qz-qcard-preview"
                      role="button"
                      tabIndex={0}
                      aria-label={q.inSetup ? `Resume setting up ${q.name}` : `Open ${q.name} in the builder`}
                      onClick={() => navigate(openTo(q))}
                      onKeyDown={(e) => { if (e.key === "Enter") navigate(openTo(q)); }}
                    >
                      <div className="qz-qcard-shot"><QuizCardPreview thumb={q.thumb} /></div>
                      <div className="qz-qcard-float">
                        {/* Preview moved to the ⋯ menu. One action here, never two. */}
                        <button
                          type="button"
                          className="qz-btn qz-btn-accent qz-btn-sm"
                          onClick={(e) => { e.stopPropagation(); navigate(openTo(q)); }}
                        >
                          {q.inSetup ? "Resume setup" : "Open builder"}
                        </button>
                      </div>
                    </div>

                    <div className="qz-qcard-body">
                      <div className="qz-qcard-titlerow">
                        {/* The clamp lives on the nested span — a flex item
                            blockifies -webkit-box and kills the clamp. */}
                        <Link to={openTo(q)} className="qz-qcard-title"><span>{q.name}</span></Link>
                        <QzMenu trigger={overflowTrigger} items={menuItems(q)} />
                      </div>
                      <div className="qz-qcard-figs">
                        <div className="qz-qcard-fig"><b>{q.questions}</b><span>Questions</span></div>
                        {q.recs > 0 ? (
                          recsTrigger(q, "qz-qcard-fig", <><b>{q.recs}</b><span>Recs</span></>)
                        ) : (
                          <div className="qz-qcard-fig"><b className="is-none">—</b><span>Recs</span></div>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="qz-qtable-wrap">
                <table className="qz-qtable">
                  <thead>
                    <tr>
                      <th>Quiz</th>
                      <th>Status</th>
                      <th className="is-num">Questions</th>
                      <th className="is-num">Recs</th>
                      <th>Edited</th>
                      <th className="is-act"><span className="qz-sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <div className="qz-qtable-name">
                            <span
                              className="qz-qtable-chip"
                              style={{ background: q.thumb.isNew ? "var(--qz-ink-3)" : q.thumb.primary }}
                              aria-hidden
                            >
                              {(q.thumb.headline || "Q").charAt(0).toUpperCase()}
                            </span>
                            <Link to={openTo(q)} title={q.name}>{q.name}</Link>
                          </div>
                        </td>
                        <td><StatusTag status={q.status} inSetup={q.inSetup} /></td>
                        <td className="is-num">{q.questions}</td>
                        <td className={q.recs > 0 ? "is-num" : "is-num is-none"}>
                          {q.recs > 0 ? recsTrigger(q, "qz-qtable-recs", q.recs) : <span>—</span>}
                        </td>
                        <td>{formatDate(q.updatedAt)}</td>
                        <td className="is-act">
                          <span className="qz-qtable-rowbtn">
                            <Link to={openTo(q)} className="qz-btn qz-btn-ghost qz-btn-sm">
                              {q.inSetup ? "Resume" : "Open"}
                            </Link>
                          </span>
                          <QzMenu trigger={overflowTrigger} items={menuItems(q)} placement="bottom" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {creating ? <CreateQuizDialog onClose={() => setCreating(false)} /> : null}

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
    </div>
  );
}
