import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { requireStudioAccess, resolveStudioShop } from "../lib/studioAccess.server";
import prisma from "../db.server";
import { computeBenchmarks, type BenchmarkEventRow } from "../lib/quizBenchmarks";
import { Quiz } from "../lib/quizSchema";
import { FUNNEL_STEPS, stepIndex, TOTAL_STEPS } from "../lib/funnelStages";
import { isDetachedJobStalled } from "../lib/stall.server";
import { parseBrandIdentitySafe } from "../lib/brandIdentity";
import { suggestCatalogStarter } from "../lib/goalSuggest";
import { detectGroupingDimension } from "../lib/groupingDetect";
import { toGroupingProduct } from "../lib/bucketPersist.server";
import { formatPctRange, gateRate } from "../lib/analyticsConfidence";
import {
  buildHomeQueue,
  buildHomeStarters,
  editedLabel,
  sparkHeights,
  splitHomeQueue,
  type HomeStarter,
  type HomeWaitItem,
} from "../lib/homeFeed";
import { parseHomeState, withDialogShown, withReminderDismissed } from "../lib/homeState";
import { QzModal } from "../components/qz-overlays";
import {
  EMPTY_GOAL_BRIEF,
  GOAL_PLACEHOLDER,
  GoalArt,
  GoalBox,
  GoalIc,
  useGoalCreate,
  type GoalBrief,
} from "../components/studio/GoalBox";

// HOME-3 — Home, built to the first-run handoff (docs: FIRST-RUN-HANDOFF.md,
// 2026-09-22) and its mock ("Wiskr Home — three screens"):
//  1. First open — a dialog over screen 2, shown by itself ONCE per shop
//     (Shop.homeState.goalDialogShownAt), and only when there are products.
//  2. No quiz yet — the two-panel create card, centred. The resting state for
//     any shop with no quiz, forever.
//  3. With a quiz — the one-step reminder (or the full create card when
//     nothing waits / it was dismissed), the two-row create module, Also
//     waiting + Last 30 days, Your quizzes.
// Every create surface is the shared GoalBox (goal · questions · intro).

const fmtNum = (n: number) => n.toLocaleString("en-US");

type Rate = { state: "confident" | "provisional" | "suppressed"; text: string; pct: number };

/** Completion is gated (analyticsConfidence §7.3): a point rate only at 200+
    engaged sessions, a Wilson range from 50, nothing below. */
function gatedCompletion(completed: number, started: number): Rate {
  const g = gateRate("completion_rate", completed, started);
  return {
    state: g.state,
    text: g.state === "confident" ? `${Math.round(g.rate * 100)}%` : formatPctRange(g.interval),
    pct: Math.round(g.rate * 100),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const home = parseHomeState(shop.homeState);

  const quizzes = await prisma.quiz.findMany({
    where: { shopId: shop.id },
    select: { id: true, name: true, status: true, updatedAt: true, buildState: true, draftJson: true },
    orderBy: { updatedAt: "desc" },
  });
  const quizIds = quizzes.map((q) => q.id);
  const noQuiz = quizzes.length === 0;

  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 3600 * 1000);
  const funnelWhere = {
    quizId: { in: quizIds },
    eventType: { in: ["quiz_engaged", "quiz_completed"] },
  };
  const funnelSelect = { quizId: true, eventType: true, sessionId: true, ts: true } as const;
  const funnelDistinct = ["quizId", "eventType", "sessionId"] as const;

  const [allRows, curRows, prevRows, contacts, emailsCur, products, collections] = await Promise.all([
    prisma.event.findMany({ where: funnelWhere, select: funnelSelect, distinct: [...funnelDistinct] }),
    prisma.event.findMany({
      where: { ...funnelWhere, ts: { gte: since30 } },
      select: funnelSelect,
      distinct: [...funnelDistinct],
    }),
    prisma.event.findMany({
      where: {
        ...funnelWhere,
        eventType: "quiz_engaged",
        ts: { gte: new Date(now - 60 * 24 * 3600 * 1000), lt: since30 },
      },
      select: funnelSelect,
      distinct: [...funnelDistinct],
    }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id } } }),
    prisma.emailCapture.count({ where: { quiz: { shopId: shop.id }, capturedAt: { gte: since30 } } }),
    // Starters (and the dialog's product gate) only matter before the first quiz.
    noQuiz ? prisma.product.findMany({ where: { shopId: shop.id } }) : [],
    noQuiz ? prisma.collection.findMany({ where: { shopId: shop.id } }) : [],
  ]);

  const benchmarks = computeBenchmarks(allRows);
  const tally = (rows: BenchmarkEventRow[]) => {
    let started = 0;
    let completed = 0;
    for (const q of Object.values(computeBenchmarks(rows).byQuiz)) {
      started += q.started;
      completed += q.completed;
    }
    return { started, completed };
  };
  const cur = tally(curRows);
  const prevStarts = tally(prevRows).started;

  // Only the Starts change ships (handoff §16.3): a completion or email delta
  // nobody can explain is worse than none. Grey unless it went up.
  const startsDelta =
    prevStarts > 0 && cur.started !== prevStarts
      ? {
          text: `${cur.started > prevStarts ? "+" : "−"}${Math.abs(
            Math.round(((cur.started - prevStarts) / prevStarts) * 100),
          )}% on the month before`,
          up: cur.started > prevStarts,
        }
      : null;

  // One light doc peek per quiz: funnel step, stall, integration wiring.
  const peek = new Map<string, { stepIndex: number; stalled: boolean; hasIntegration: boolean }>();
  for (const q of quizzes) {
    const parsed = Quiz.safeParse(q.draftJson);
    const session = parsed.success ? parsed.data.build_session : undefined;
    const stage = session?.stage ?? "grouping";
    const genInFlight =
      stage === "typing" ||
      stage === "templating" ||
      (stage === "grouping" && session?.goal_first?.prepick === "picking");
    peek.set(q.id, {
      stepIndex: stepIndex(stage),
      stalled: Boolean(session?.gen_error) || (genInFlight && isDetachedJobStalled(q.updatedAt, now)),
      hasIntegration: parsed.success
        ? parsed.data.nodes.some((n) => n.type === "integration" && n.data.actions.length > 0)
        : false,
    });
  }
  const anyIntegration = [...peek.values()].some((p) => p.hasIntegration);

  const queue = buildHomeQueue({
    quizzes: quizzes.map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      inSetup: q.buildState === "step1",
      stepIndex: peek.get(q.id)?.stepIndex ?? 0,
      stalled: peek.get(q.id)?.stalled ?? false,
      starts: benchmarks.byQuiz[q.id]?.started ?? 0,
    })),
    emailsWithoutDestination: contacts > 0 && !anyIntegration,
  });

  let starters: HomeStarter[] = [];
  if (noQuiz && products.length > 0) {
    const detect = detectGroupingDimension(
      products.map(toGroupingProduct),
      collections.map((c) => ({ collectionId: c.collectionId, title: c.title })),
    );
    starters = buildHomeStarters({
      productCount: products.length,
      catalog: suggestCatalogStarter(parseBrandIdentitySafe(shop.brandIdentity)?.summary ?? null),
      groups: detect.proposed.map((g) => ({ name: g.name, size: g.productIds.length })),
    });
  }

  return json({
    hasQuizzes: !noQuiz,
    // §2 canOpenDialog: standalone studio only (this route), once per shop,
    // and never for a shop with nothing to recommend from.
    showDialog: noQuiz && products.length > 0 && !home.goalDialogShownAt,
    starters,
    queue,
    dismissedKey: home.reminder?.key ?? null,
    stats: {
      starts: cur.started,
      startsDelta,
      completion: gatedCompletion(cur.completed, cur.started),
      emails: emailsCur,
      spark: sparkHeights(
        curRows.filter((r) => r.eventType === "quiz_engaged").map((r) => r.ts),
        since30.getTime(),
        now,
      ),
    },
    rows: quizzes.slice(0, 4).map((q) => {
      const b = benchmarks.byQuiz[q.id];
      const inSetup = q.buildState === "step1";
      const live = q.status === "published";
      const rate = live && b && b.started > 0 ? gatedCompletion(b.completed, b.started) : null;
      return {
        id: q.id,
        name: q.name,
        href: inSetup ? `/studio/onboarding/${q.id}` : `/studio/${q.id}`,
        tag: live ? ("live" as const) : inSetup ? ("setup" as const) : ("draft" as const),
        stepsDone: inSetup ? (peek.get(q.id)?.stepIndex ?? 0) : null,
        barPct: rate?.state === "confident" ? rate.pct : null,
        sentence: inSetup
          ? `Step ${(peek.get(q.id)?.stepIndex ?? 0) + 1} of ${TOTAL_STEPS}`
          : live
            ? !rate
              ? "No starts yet"
              : rate.state === "suppressed"
                ? "Not enough data yet"
                : `${rate.text} completion`
            : "Ready to publish",
        num: live && b && b.started > 0 ? `${fmtNum(b.started)} starts` : editedLabel(q.updatedAt, now),
      };
    }),
  });
};

// Two small writes to Shop.homeState. Stored on the shop, not the browser:
// a cache clear or a second device must not resurrect either (§2, §7.4).
const HomeIntent = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("dialog-shown") }),
  z.object({ intent: z.literal("dismiss-reminder"), key: z.string().min(1).max(200) }),
]);

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireStudioAccess(request);
  const shop = await resolveStudioShop();
  const parsed = HomeIntent.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return json({ ok: false as const }, { status: 400 });
  const state = parseHomeState(shop.homeState);
  const next =
    parsed.data.intent === "dialog-shown"
      ? withDialogShown(state, new Date())
      : withReminderDismissed(state, parsed.data.key, new Date());
  if (next !== state) await prisma.shop.update({ where: { id: shop.id }, data: { homeState: next } });
  return json({ ok: true as const });
};

/* ── Icons (24 viewBox, the mock's lucide set) ──────────────────────────── */

const ICON = {
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  chev: <path d="m9 18 6-6-6-6" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  grid: (
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  layers: (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </>
  ),
  mail: (
    <>
      <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" />
      <rect x="2" y="4" width="20" height="16" rx="2" />
    </>
  ),
  store: (
    <>
      <path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5" />
      <path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244" />
      <path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05" />
    </>
  ),
};

/* Per-kind copy (§7.3, §7.5): the reminder's button, a plain Also-waiting
   row's action, and the action a DISMISSED reminder keeps as its row (§7.4). */
const WAIT: Record<
  HomeWaitItem["kind"],
  { icon: ReactNode; tag: [string, string] | null; lead: string; row: string; demoted: string }
> = {
  stalled: { icon: ICON.clock, tag: ["setup", "Paused"], lead: "Open setup", row: "Open", demoted: "Open" },
  setup: { icon: ICON.layers, tag: ["setup", "In setup"], lead: "Continue setup", row: "Resume", demoted: "Resume" },
  publish: { icon: ICON.globe, tag: ["draft", "Draft"], lead: "Review and publish", row: "Review", demoted: "Review" },
  store: { icon: ICON.store, tag: ["live", "Live"], lead: "Add to store", row: "Embed", demoted: "Add to store" },
  emails: { icon: ICON.mail, tag: null, lead: "Connect", row: "Connect", demoted: "Connect" },
};

const QUESTION = "What type of quiz do you want to create?";

/* ── The full create card (screen 2, and screen 3's top slot) ───────────── */

function CreateCard({
  headingRef,
  first,
  starters,
  onStarter,
  activeGoal,
  children,
}: {
  headingRef?: React.RefObject<HTMLHeadingElement>;
  first: boolean;
  starters: HomeStarter[];
  onStarter: (s: HomeStarter) => void;
  activeGoal: string;
  children: ReactNode;
}) {
  return (
    <section className="hm3-card hm3-make" aria-labelledby="hm3-q">
      <div className="hm3-make-art" aria-hidden="true">
        <GoalArt />
      </div>
      <div className="hm3-make-body">
        <h1 className="hm3-q" id="hm3-q" ref={headingRef} tabIndex={-1}>
          {QUESTION}
        </h1>
        {children}
        {first && starters.length > 0 ? (
          <div className="hm3-catalog">
            <span>Or start from your catalog</span>
            <div className="hm3-chips">
              {starters.map((s) => (
                <button
                  key={s.meta}
                  type="button"
                  className="hm3-chip"
                  aria-label={s.goal}
                  title={s.goal}
                  aria-pressed={activeGoal === s.goal}
                  onClick={() => onStarter(s)}
                >
                  <span className="hm3-chip-art" aria-hidden="true" />
                  <b>{s.label}</b>
                  <span className="hm3-chip-meta">{s.meta}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {first ? (
          <div className="hm3-altrow">
            <span>Or start another way</span>
            <Link className="hm3-quiet" to="/studio/templates">
              <GoalIc>{ICON.grid}</GoalIc> Browse templates
            </Link>
            {/* FLOW-2 — the step-by-step funnel is the non-AI-first path. */}
            <Link className="hm3-quiet" to="/studio/onboarding">
              <GoalIc>{ICON.plus}</GoalIc> Start from scratch
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ── The reminder (§7.2) ────────────────────────────────────────────────── */

function Ring({ done, total, warn }: { done: number; total: number; warn: boolean }) {
  const c = 138.2; // 2π × 22
  const on = Math.max(0, Math.min(1, done / total)) * c;
  return (
    <span className={warn ? "hm3-ring is-warn" : "hm3-ring"}>
      <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden="true">
        <circle className="trk" cx="26" cy="26" r="22" />
        <circle className="val" cx="26" cy="26" r="22" strokeDasharray={`${on.toFixed(1)} ${c}`} />
      </svg>
      <b>
        {done}/{total}
      </b>
    </span>
  );
}

function NextCard({ item, onDismiss }: { item: HomeWaitItem; onDismiss: () => void }) {
  const w = WAIT[item.kind];
  const setup = item.kind === "setup" || item.kind === "stalled";
  const now = item.stepIndex ?? 0;
  return (
    <section className="hm3-card hm3-next" aria-labelledby="hm3-next-title">
      <div className="hm3-next-side">
        <div className="hm3-next-tile">
          {setup ? (
            <>
              <Ring done={now} total={TOTAL_STEPS} warn={item.kind === "stalled"} />
              <span>
                Setup steps
                <br />
                done
              </span>
            </>
          ) : (
            <>
              <span className={item.kind === "store" ? "hm3-medal is-live" : "hm3-medal"}>
                <GoalIc>{w.icon}</GoalIc>
              </span>
              <span>
                {item.kind === "store" ? "Live, no" : "Built,"}
                <br />
                {item.kind === "store" ? "visits yet" : "not live"}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="hm3-next-body">
        <div className="hm3-sechead">
          <p className="hm3-lbl">Next step</p>
          {w.tag ? <span className={`hm3-tag is-${w.tag[0]}`}>{w.tag[1]}</span> : null}
        </div>
        <h2 className="hm3-next-title" id="hm3-next-title">
          {item.title}
        </h2>
        {setup ? (
          <ol className="hm3-steps" aria-label={`Step ${now + 1} of ${TOTAL_STEPS}`}>
            {FUNNEL_STEPS.map((s, i) => (
              <li
                key={s.stage}
                className={
                  i < now ? "is-done" : i === now ? (item.kind === "stalled" ? "is-stall" : "is-now") : ""
                }
              >
                <span>{s.short}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="hm3-next-acts">
          <Link className="hm3-btn hm3-btn-sm" to={item.href}>
            {w.lead} <GoalIc size={14}>{ICON.arrow}</GoalIc>
          </Link>
        </div>
      </div>
      <button type="button" className="hm3-cardx" aria-label="Move this into Also waiting" onClick={onDismiss}>
        <GoalIc size={14}>{ICON.x}</GoalIc>
      </button>
    </section>
  );
}

/* ── Your quizzes (§7.7) — four fixed tracks ────────────────────────────── */

type LoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

function QuizRows({ rows }: { rows: LoaderData["rows"] }) {
  return (
    <div className="hm3-qrows">
      {rows.map((q) => (
        <Link key={q.id} to={q.href} className="hm3-qrow">
          <span className="hm3-qmark" aria-hidden="true">
            {q.name.trim().charAt(0).toUpperCase() || "Q"}
          </span>
          <span className="hm3-qname">
            <b>{q.name}</b>
            <span className={`hm3-tag is-${q.tag}`}>
              {q.tag === "live" ? "Live" : q.tag === "setup" ? "In setup" : "Draft"}
            </span>
          </span>
          <span className="hm3-qmeter">
            {/* The figure track is always reserved, empty or not. */}
            <span className="hm3-qfig" aria-hidden="true">
              {q.barPct != null ? (
                <span className="hm3-bar">
                  <i style={{ width: `${q.barPct}%` }} />
                </span>
              ) : q.stepsDone != null ? (
                <span className="hm3-dots">
                  {FUNNEL_STEPS.map((s, i) => (
                    <i key={s.stage} className={i < (q.stepsDone ?? 0) ? "is-on" : undefined} />
                  ))}
                </span>
              ) : null}
            </span>
            <span>{q.sentence}</span>
          </span>
          <span className="hm3-qnum">{q.num}</span>
          <span className="hm3-chev">
            <GoalIc>{ICON.chev}</GoalIc>
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function StudioHome() {
  const data = useLoaderData<typeof loader>();
  const { create, busy, error } = useGoalCreate();
  const homeFetcher = useFetcher<typeof action>();

  // ONE brief shared by every goal box on the page (dialog, card, row): the
  // goal, count and switch survive the dialog's close (§3).
  const [brief, setBriefState] = useState<GoalBrief>(EMPTY_GOAL_BRIEF);
  const setBrief = (next: Partial<GoalBrief>) => setBriefState((b) => ({ ...b, ...next }));
  const onCreate = () => create(brief);

  const [dialogOpen, setDialogOpen] = useState(data.showDialog);
  const [example, setExample] = useState(0);
  const [dismissedKey, setDismissedKey] = useState(data.dismissedKey);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogGoalRef = useRef<HTMLTextAreaElement>(null);
  const pageGoalRef = useRef<HTMLTextAreaElement>(null);

  // It opens by itself once per shop: record that it opened, so every exit —
  // ✕, Esc, scrim, Create, or simply navigating away — counts.
  const markedRef = useRef(false);
  useEffect(() => {
    if (!data.showDialog || markedRef.current) return;
    markedRef.current = true;
    homeFetcher.submit({ intent: "dialog-shown" }, { method: "post" });
  }, [data.showDialog, homeFetcher]);

  const closeDialog = () => {
    setDialogOpen(false);
    // Nothing on the page opened it: focus lands on screen 2's question, after
    // QzModal's own focus-restore runs on unmount.
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const box = (id: string, density: "dialog" | "page" | "card" | "row", ref?: React.RefObject<HTMLTextAreaElement>) => (
    <GoalBox
      id={id}
      density={density}
      brief={brief}
      setBrief={setBrief}
      onCreate={onCreate}
      busy={busy}
      error={error}
      inputRef={ref}
    />
  );

  if (!data.hasQuizzes) {
    const examples = data.starters;
    const exampleGoal = examples.length > 0 ? examples[example % examples.length]!.goal : null;
    return (
      <div className="hm3 is-first">
        <div className="hm3-col">
          <CreateCard
            headingRef={headingRef}
            first
            starters={data.starters}
            activeGoal={brief.goal}
            onStarter={(s) => {
              setBrief({ goal: s.goal });
              // Selected, so the next keystroke replaces it (§4.2).
              requestAnimationFrame(() => {
                pageGoalRef.current?.focus();
                pageGoalRef.current?.select();
              });
            }}
          >
            {dialogOpen ? <PassiveBox goal={brief.goal} /> : box("hm3-first", "page", pageGoalRef)}
          </CreateCard>
        </div>
        <QzModal
          open={dialogOpen}
          onClose={closeDialog}
          size="md"
          width={640}
          className="hm3-pop"
          initialFocusRef={dialogGoalRef}
          title="Describe what you're trying to build, and I'll start it for you."
        >
          {box("hm3-pop", "dialog", dialogGoalRef)}
          {exampleGoal ? (
            <div className="hm3-example">
              <p>
                <b>For example:</b> {exampleGoal}
              </p>
              <span className="hm3-example-acts">
                <button
                  type="button"
                  className="hm3-linkq"
                  onClick={() => {
                    setBrief({ goal: exampleGoal });
                    dialogGoalRef.current?.focus();
                  }}
                >
                  Use this
                </button>
                {examples.length > 1 ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <button type="button" className="hm3-linkq" onClick={() => setExample((n) => n + 1)}>
                      try another
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          ) : null}
        </QzModal>
      </div>
    );
  }

  const { next, also } = splitHomeQueue(data.queue, dismissedKey);
  const { stats } = data;
  const dismiss = () => {
    if (!next) return;
    setDismissedKey(next.key);
    homeFetcher.submit({ intent: "dismiss-reminder", key: next.key }, { method: "post" });
  };

  const quizCard = (inGrid: boolean) => (
    <section
      className={inGrid ? "hm3-card hm3-quizzes is-ingrid" : "hm3-card hm3-quizzes"}
      aria-labelledby="hm3-sec-quizzes"
    >
      <div className="hm3-sechead">
        <p className="hm3-lbl" id="hm3-sec-quizzes">
          Your quizzes
        </p>
        <Link className="hm3-link" to="/studio/quizzes">
          All quizzes
        </Link>
      </div>
      <QuizRows rows={data.rows} />
    </section>
  );

  const statsCard = (
    <section className="hm3-card hm3-stats" aria-labelledby="hm3-sec-stats">
      <div className="hm3-sechead">
        <p className="hm3-lbl" id="hm3-sec-stats">
          Last 30 days
        </p>
        <Link className="hm3-link" to="/studio/analytics">
          Analytics
        </Link>
      </div>
      <div className="hm3-tiles">
        <div className="hm3-tile2 is-wide">
          <p className="hm3-lbl">Starts</p>
          <b>{fmtNum(stats.starts)}</b>
          {stats.startsDelta ? (
            <span className={stats.startsDelta.up ? "hm3-d is-up" : "hm3-d"}>{stats.startsDelta.text}</span>
          ) : null}
          <span className="hm3-spark" aria-hidden="true">
            {stats.spark.map((h, i) => (
              <i
                key={i}
                className={i === stats.spark.length - 1 ? "is-last" : undefined}
                style={{ height: `${Math.max(h, 4)}%` }}
              />
            ))}
          </span>
        </div>
        <div className="hm3-tile2">
          <p className="hm3-lbl">Completion</p>
          {stats.completion.state === "suppressed" ? (
            <>
              <b>—</b>
              <span className="hm3-d">Not enough data yet</span>
            </>
          ) : (
            <b className={stats.completion.state === "provisional" ? "is-range" : undefined}>
              {stats.completion.text}
            </b>
          )}
        </div>
        <div className="hm3-tile2">
          <p className="hm3-lbl">Emails</p>
          <b>{fmtNum(stats.emails)}</b>
        </div>
      </div>
    </section>
  );

  return (
    <div className="hm3 is-live">
      <div className="hm3-col hm3-stack">
        {/* Dismissing swaps the top slot — announce it (§14). */}
        <div className="hm3-stack" aria-live="polite">
          {next ? (
            <>
              <h1 className="qz-sr-only">{QUESTION}</h1>
              <NextCard item={next} onDismiss={dismiss} />
              <section className="hm3-card hm3-makerow" aria-label="Create a quiz">
                <div className="hm3-makerow-art" aria-hidden="true">
                  <GoalArt mini />
                </div>
                <div className="hm3-makerow-body">{box("hm3-row", "row")}</div>
              </section>
            </>
          ) : (
            <CreateCard first={false} starters={[]} onStarter={() => undefined} activeGoal={brief.goal}>
              {box("hm3-live", "card")}
            </CreateCard>
          )}
        </div>

        {also.length > 0 ? (
          <>
            <div className="hm3-grid2">
              <section className="hm3-card hm3-also" aria-labelledby="hm3-sec-also">
                <div className="hm3-sechead">
                  <p className="hm3-lbl" id="hm3-sec-also">
                    Also waiting
                  </p>
                </div>
                <div>
                  {also.map((a) => (
                    <div key={a.key} className="hm3-row">
                      <span className="hm3-tile" aria-hidden="true">
                        <GoalIc>{WAIT[a.kind].icon}</GoalIc>
                      </span>
                      <b className="hm3-rowtitle">{a.title}</b>
                      <Link className="hm3-rowact" to={a.href}>
                        {a.key === dismissedKey ? WAIT[a.kind].demoted : WAIT[a.kind].row}{" "}
                        <GoalIc>{ICON.chev}</GoalIc>
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
              {statsCard}
            </div>
            {quizCard(false)}
          </>
        ) : (
          // All caught up (§7.8): no card saying so — Your quizzes moves up
          // into the slot beside Last 30 days.
          <div className="hm3-grid2">
            {quizCard(true)}
            {statsCard}
          </div>
        )}
      </div>
    </div>
  );
}

/* Behind the dialog the page shows the same goal, read-only — two live
   textareas with one id would collide while the dialog is open. */
function PassiveBox({ goal }: { goal: string }) {
  return (
    <div className="hm3-goal is-page" aria-hidden="true">
      <div className="hm3-box">
        <div className="hm3-passive">{goal || GOAL_PLACEHOLDER}</div>
      </div>
    </div>
  );
}
