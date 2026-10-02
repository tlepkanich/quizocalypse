import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Prisma } from "@prisma/client";
import { Link, useLoaderData, useNavigate, useSubmit, useNavigation } from "@remix-run/react";
import { ArrowRight, CircleHelp, Ellipsis, List, Rows2, Search } from "lucide-react";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { QzSegmented } from "../components/qz";
import { QzMenu, QzModal, QzPopover } from "../components/qz-overlays";
import { computeBenchmarks } from "../lib/quizBenchmarks";
import { quizCardFacts, type QuizCardOpening } from "../lib/quizLibraryCard";
import { publishQuiz } from "../lib/quizPublish";
import { withoutDiscountCode } from "../lib/discount.server";
import { refreshBucketMembership } from "../lib/bucketPersist.server";
import { formatDate } from "../lib/formatDate";
import { EMPTY_GOAL_BRIEF, GoalBox, useGoalCreate, type GoalBrief } from "../components/studio/GoalBox";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  // Owner correction (2026-08-01) — mid-funnel drafts (buildState "step1")
  // are VISIBLE now: a quiz abandoned before the last step used to vanish
  // from the library, making the work impossible to resume. Their cards
  // route back into the setup flow instead of the builder.
  const quizzes = await prisma.quiz.findMany({
    // draftJson drives the per-card facts + the opening question (§R-7).
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
    ? await prisma.category.findMany({
      where: { shopId: shop.id, id: { in: allTargetIds } },
      select: { id: true, productIds: true },
      orderBy: { id: "asc" },
    })
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
        opening: facts.opening,
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
        draftJson: withoutDiscountCode(quiz.draftJson) as object,
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

// Owner ruling (2026-09-16) — both views render at most 20 quizzes at a time;
// "View more" reveals the next 20 (client-side: the loader already ships all rows).
const PAGE_SIZE = 20;

// Quizzes tab (Crest) — the toolbar rule's fixed geometry. Every card is
// exactly CARD_H tall at desktop widths (title and question each cap at two
// lines), so where the last card lands is arithmetic, not measurement.
const CARD_H = 224;
const LIST_GAP = 18;
// The header card without the toolbar: 18 padding + the 38px title row + 18.
const HEAD_H = 74;

// SSR-safe layout effect: the server branch is a no-op either way.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Typed questions draw one input-shaped box instead of an answer list.
const TYPED_OPENING: Record<string, { label: string; box: string }> = {
  text: { label: "Text", box: "Shopper types an answer" },
  email: { label: "Email", box: "Shopper types their email" },
  numeric: { label: "Number", box: "Shopper enters a number" },
  date: { label: "Date", box: "Shopper picks a date" },
  slider: { label: "Slider", box: "Shopper moves a slider" },
};

// The card's preview: the quiz's own opening question, in our type. Real
// text (not aria-hidden), but not a control — the title and the action open
// the quiz.
function OpeningPanel({ opening }: { opening: QuizCardOpening | null }) {
  if (!opening) {
    return (
      <div className="qz-qpanel">
        <div className="qz-qpanel-none">
          <CircleHelp size={22} strokeWidth={1.5} aria-hidden />
          <span>No questions yet</span>
        </div>
      </div>
    );
  }
  const typed = opening.kind === "typed" ? TYPED_OPENING[opening.questionType] ?? TYPED_OPENING.text! : null;
  const count = `${opening.answerCount} answer${opening.answerCount === 1 ? "" : "s"}`;
  return (
    <div className="qz-qpanel">
      <p className="qz-qpanel-lbl">
        <span>Opening question</span>
        <span>{typed ? typed.label : count}</span>
      </p>
      {opening.text ? (
        <p className="qz-qpanel-q" title={opening.text}>{opening.text}</p>
      ) : (
        <p className="qz-qpanel-q is-untitled">Untitled question</p>
      )}
      {typed ? (
        <ul className="qz-qpanel-opts">
          <li className="qz-qpanel-opt is-input"><span>{typed.box}</span></li>
        </ul>
      ) : opening.answers.length ? (
        <ul className="qz-qpanel-opts">
          {opening.answers.map((a, i) => (
            <li className="qz-qpanel-opt" key={i} title={a}><i aria-hidden /><span>{a}</span></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// §3.8 — one status tag, weighted not equal, same tag in both views.
function StatusTag({ status, inSetup }: { status: string; inSetup: boolean }) {
  const kind = status === "published" ? "live" : inSetup ? "setup" : "draft";
  const label = kind === "live" ? "Live" : kind === "setup" ? "In setup" : "Draft";
  return <span className={`qz-qtag is-${kind}`}>{label}</span>;
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
  // HOME-3 (first-run handoff §9) — the shared GoalBox: goal, question count
  // (Auto | 3–12), intro screen. No audience / factors, no length regex.
  const { create, busy, error } = useGoalCreate();
  const [brief, setBriefState] = useState<GoalBrief>(EMPTY_GOAL_BRIEF);
  const setBrief = (next: Partial<GoalBrief>) => setBriefState((b) => ({ ...b, ...next }));
  const taRef = useRef<HTMLTextAreaElement>(null);

  return (
    <QzModal open width={620} className="qz-create-modal" onClose={onClose} initialFocusRef={taRef}>
      <h2 className="qz-display" style={{ fontSize: 25, textAlign: "center", margin: "0 0 16px", color: "var(--qz-ink)" }}>
        What should this quiz help someone decide?
      </h2>
      <GoalBox
        id="qz-create"
        density="dialog"
        brief={brief}
        setBrief={setBrief}
        onCreate={() => create(brief)}
        busy={busy}
        error={error}
        inputRef={taRef}
      />
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
  // Owner ruling (2026-09-16) — the visual list is the default view; the
  // table stays as the density mode behind the toggle.
  const [view, setView] = useState<"cards" | "table">("cards");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [recsFor, setRecsFor] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const act = (intent: string, id: string) => submit({ intent, id }, { method: "post" });
  const isBusy = navigation.state !== "idle";

  // ── The toolbar rule (owner): the toolbar shows when there are more cards
  // than the window can show — with the toolbar hidden, would the last card
  // of the first page end below the window? Decided on the WHOLE list, never
  // the filtered one (searching down to one result must not hide the search
  // field). The server has no window: start from "more than three" and
  // correct after mount.
  const firstPage = Math.min(quizzes.length, PAGE_SIZE);
  const [showBar, setShowBar] = useState(quizzes.length > 3);
  const mainRef = useRef<HTMLDivElement>(null);
  const headRowRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const checkBar = useCallback(() => {
    const main = mainRef.current;
    if (!main) return;
    let want = false;
    if (firstPage > 0) {
      // Under 680px cards stack and are taller than CARD_H: measure them.
      let cardH = CARD_H;
      if (window.matchMedia("(max-width: 680px)").matches) {
        const cards = listRef.current?.querySelectorAll<HTMLElement>(".qz-qcard");
        if (!cards?.length) return; // table view — keep the current answer
        let sum = 0;
        cards.forEach((c) => { sum += c.offsetHeight; });
        cardH = sum / cards.length;
      }
      // Document coordinates; offsetHeight ignores the sticky offset.
      const cs = getComputedStyle(main);
      const headH = headRowRef.current
        ? headRowRef.current.offsetHeight + 2 * parseFloat(getComputedStyle(headRowRef.current.parentElement!).paddingTop)
        : HEAD_H;
      const listTop = main.getBoundingClientRect().top + window.scrollY + parseFloat(cs.paddingTop) + headH + LIST_GAP;
      const lastBottom = listTop + cardH * firstPage + LIST_GAP * (firstPage - 1);
      want = lastBottom > window.innerHeight;
    }
    // A focused search field keeps the toolbar until it blurs.
    if (!want && searchRef.current && document.activeElement === searchRef.current) return;
    setShowBar(want);
  }, [firstPage]);

  useIsoLayoutEffect(() => {
    checkBar();
    window.addEventListener("resize", checkBar);
    return () => window.removeEventListener("resize", checkBar);
  }, [checkBar]);

  // With the toolbar hidden, no hidden filter may hold rows back: reset
  // search, status and sort, and show the cards.
  useEffect(() => {
    if (showBar) return;
    setQuery("");
    setStatus("all");
    setSort("recent");
    setView("cards");
  }, [showBar]);

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

  // A changed search/filter/sort restarts at the first page — a stale expanded
  // count would silently show 40+ rows of the NEW result set.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query, status, sort]);

  const visible = shown.slice(0, visibleCount);
  const hiddenCount = shown.length - visible.length;

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

  // Repeated controls carry the quiz's name — "More actions" on every card
  // tells a screen-reader user nothing.
  const overflowTrigger = (q: QuizRow) => (
    <button type="button" className="qz-lib-more" aria-label={`More actions for ${q.name}`} title="More actions">
      <Ellipsis size={16} strokeWidth={2.4} aria-hidden />
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

  const bar = showBar && quizzes.length > 0;

  return (
    <div className="qz-lib-main" ref={mainRef}>
      <div className="qz-lib-col">
        {/* §3.2 — one header card: the page title and ONE accent action; the
            toolbar joins it only when the cards run past the window. */}
        <header className={`qz-lib-head${bar ? " has-bar" : ""}`}>
          <div className="qz-lib-headrow" ref={headRowRef}>
            <h1 className="qz-lib-h1">Quizzes</h1>
            <button type="button" className="qz-btn qz-btn-accent qz-lib-create" onClick={() => setCreating(true)}>
              Create quiz <ArrowRight size={15} strokeWidth={2} aria-hidden />
            </button>
          </div>
          {bar ? (
            /* §3.4 — the operate toolbar: search · status (counts) · sort · view. */
            <div className="qz-lib-bar">
              <div className="qz-lib-search">
                <Search size={14} strokeWidth={2} aria-hidden />
                <input
                  ref={searchRef}
                  className="qz-input"
                  type="search"
                  placeholder="Search quizzes…"
                  value={query}
                  aria-label="Search quizzes"
                  onChange={(e) => setQuery(e.target.value)}
                  onBlur={checkBar}
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
              <div className="qz-lib-view">
                <QzSegmented
                  ariaLabel="View"
                  value={view}
                  onChange={setView}
                  options={[
                    {
                      value: "cards",
                      title: "Card view",
                      label: (
                        <>
                          <Rows2 size={14} strokeWidth={1.75} aria-hidden />
                          <span className="qz-sr-only">Card view</span>
                        </>
                      ),
                    },
                    {
                      value: "table",
                      title: "Table view",
                      label: (
                        <>
                          <List size={14} strokeWidth={1.75} aria-hidden />
                          <span className="qz-sr-only">Table view</span>
                        </>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          ) : null}
        </header>

        {quizzes.length === 0 ? (
          /* QRTZ-S2 — states.mjs mt- pattern (zero-quizzes): icon tile, one-line
             title, ≤30ch body, ONE action — it opens the create dialog, where
             every other build path now lives. */
          <div className="qz-lib-empty">
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
          </div>
        ) : shown.length === 0 ? (
          /* §5 — a filter matching nothing is NOT the same as having nothing:
             the action CLEARS the filter. */
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
        ) : view === "cards" ? (
          <div className="qz-qcard-list" ref={listRef}>
            {visible.map((q) => (
              <article key={q.id} className="qz-qcard" aria-labelledby={`qz-qcard-${q.id}`}>
                {/* The body comes first in the DOM so a screen reader hears
                    the quiz's name before its question; CSS puts the panel
                    in the left column. */}
                <div className="qz-qcard-body">
                  <div className="qz-qcard-meta">
                    <StatusTag status={q.status} inSetup={q.inSetup} />
                    <span>Edited {formatDate(q.updatedAt)}</span>
                    <QzMenu trigger={overflowTrigger(q)} items={menuItems(q)} />
                  </div>
                  {/* The clamp lives on the nested span — a flex/grid item
                      blockifies -webkit-box and kills the clamp. */}
                  <h2 className="qz-qcard-title" id={`qz-qcard-${q.id}`}>
                    <Link to={openTo(q)}><span>{q.name}</span></Link>
                  </h2>
                  <div className="qz-qcard-foot">
                    <div className="qz-qcard-figs">
                      <div className="qz-qcard-fig">
                        {q.questions > 0 ? <b>{q.questions}</b> : <b className="is-none">—</b>}
                        <span>Questions</span>
                      </div>
                      {q.recs > 0 ? (
                        recsTrigger(q, "qz-qcard-fig", <><b>{q.recs}</b><span>Recs</span></>)
                      ) : (
                        <div className="qz-qcard-fig"><b className="is-none">—</b><span>Recs</span></div>
                      )}
                    </div>
                    <Link
                      to={openTo(q)}
                      className="qz-btn qz-btn-soft qz-qcard-act"
                      aria-label={q.inSetup ? `Resume setting up ${q.name}` : `Open ${q.name} in the builder`}
                    >
                      {q.inSetup ? "Resume setup" : "Open builder"}
                    </Link>
                  </div>
                </div>
                <OpeningPanel opening={q.opening} />
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
                {visible.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <div className="qz-qtable-name">
                        <Link to={openTo(q)} title={q.name}>{q.name}</Link>
                        <span title={q.opening?.text || undefined}>
                          {q.opening ? q.opening.text || "Untitled question" : "No questions yet"}
                        </span>
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
                      <QzMenu trigger={overflowTrigger(q)} items={menuItems(q)} placement="bottom" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hiddenCount > 0 ? (
          <div className="qz-lib-viewmore">
            <button type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
              View {Math.min(PAGE_SIZE, hiddenCount)} more
            </button>
          </div>
        ) : null}
      </div>

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
