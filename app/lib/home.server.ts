import type { Shop } from "@prisma/client";
import { z } from "zod";
import prisma from "../db.server";
import { computeBenchmarks, type BenchmarkEventRow } from "./quizBenchmarks";
import { Quiz } from "./quizSchema";
import { stepIndex, TOTAL_STEPS } from "./funnelStages";
import { isDetachedJobStalled } from "./stall.server";
import { parseBrandIdentitySafe } from "./brandIdentity";
import { suggestCatalogStarter } from "./goalSuggest";
import { detectGroupingDimension } from "./groupingDetect";
import { toGroupingProduct } from "./bucketPersist.server";
import { formatPctRange, gateRate } from "./analyticsConfidence";
import { MIN_GOAL_CHARS } from "./funnelDraft.server";
import { beginGoalFirstFlow } from "./goalPrepick.server";
import {
  buildHomeQueue,
  buildHomeStarters,
  editedLabel,
  sparkHeights,
  type HomeLinks,
  type HomeStarter,
} from "./homeFeed";
import { parseHomeState, withDialogShown, withReminderDismissed } from "./homeState";

// HOME-3 — the server half of Home, shared by BOTH surfaces (first-run
// handoff §12): the standalone /studio and the embedded Shopify /app. Each
// route authenticates its own way, resolves the shop, and calls these. Only
// the link map and the first-open dialog differ between surfaces.

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

export async function loadHomeForShop(
  shop: Shop,
  opts: {
    links: HomeLinks;
    /** §2 canOpenDialog: standalone studio only. The embedded app never opens
        a modal on page load (Built for Shopify 4.3.3). */
    allowDialog: boolean;
  },
) {
  const { links } = opts;
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
    links,
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

  return {
    hasQuizzes: !noQuiz,
    // Once per shop, and never for a shop with nothing to recommend from.
    showDialog: opts.allowDialog && noQuiz && products.length > 0 && !home.goalDialogShownAt,
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
        href: inSetup ? links.setup(q.id) : links.editor(q.id),
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
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHomeForShop>>;

// Two small writes to Shop.homeState. Stored on the shop, not the browser:
// a cache clear or a second device must not resurrect either (§2, §7.4).
const HomeIntent = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("dialog-shown") }),
  z.object({ intent: z.literal("dismiss-reminder"), key: z.string().min(1).max(200) }),
]);

export const HOME_INTENTS = ["dialog-shown", "dismiss-reminder"] as const;

/** Returns false for an invalid payload (the caller answers 400). A surface
    that never shows the dialog also refuses to record it. */
export async function runHomeIntentForShop(
  shop: Shop,
  form: FormData,
  opts: { allowDialog: boolean },
): Promise<boolean> {
  const parsed = HomeIntent.safeParse(Object.fromEntries(form));
  if (!parsed.success) return false;
  if (parsed.data.intent === "dialog-shown" && !opts.allowDialog) return false;
  const state = parseHomeState(shop.homeState);
  const next =
    parsed.data.intent === "dialog-shown"
      ? withDialogShown(state, new Date())
      : withReminderDismissed(state, parsed.data.key, new Date());
  if (next !== state) await prisma.shop.update({ where: { id: shop.id }, data: { homeState: next } });
  return true;
}

export type GoalCreateResult = { ok: true; quizId: string } | { ok: false; error: string };

/** FLOW-1 / HOME-3 §9 — the GoalBox's form (goal · length · intro) → a
    claimed decider draft with the AI pre-pick running. The caller redirects
    into its own surface's setup funnel. */
export async function createGoalQuizForShop(shop: Shop, form: FormData): Promise<GoalCreateResult> {
  const goal = String(form.get("goal") ?? "").trim().slice(0, 500);
  if (goal.length < MIN_GOAL_CHARS) {
    return { ok: false, error: `Add a little more detail (at least ${MIN_GOAL_CHARS} characters).` };
  }
  const lengthRaw = Number(form.get("length"));
  const questionLength =
    Number.isInteger(lengthRaw) && lengthRaw >= 3 && lengthRaw <= 12 ? lengthRaw : null;
  // HOME-3 — only an explicit "0" turns the intro off; absent keeps it.
  const intro = form.get("intro") !== "0";
  const quizId = await beginGoalFirstFlow(shop, { goal, questionLength, intro });
  return { ok: true, quizId };
}
