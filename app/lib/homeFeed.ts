// HOME-3 — the pure half of the studio Home (mock: "Wiskr Home — three
// screens"). No I/O: the route loader gathers rows, these helpers decide what
// the page says. Kept pure so the priority queue and the starter copy are
// unit-tested without a database.

import { singularizeName } from "./goalSuggest";

/* ── What is waiting, in priority order ────────────────────────────────────
   Distance to a live, visited quiz: a stalled setup, then a setup in flight,
   then a built draft, then a live quiz nobody has reached, then captured
   emails with nowhere to go. The first non-email item leads Home as the
   "Next step" card; the rest list under "Also waiting". */

export type HomeWaitKind = "stalled" | "setup" | "publish" | "store" | "emails";

export interface HomeWaitItem {
  kind: HomeWaitKind;
  /** Stable per quiz + kind — the dismiss cookie stores it. */
  key: string;
  title: string;
  href: string;
  /** Setup items only: 0-based index of the step the draft is parked on. */
  stepIndex?: number;
}

export interface HomeQueueQuiz {
  id: string;
  name: string;
  status: string;
  inSetup: boolean;
  /** Setup drafts only: the visible funnel step index (0-based). */
  stepIndex: number;
  stalled: boolean;
  starts: number;
}

export function buildHomeQueue(input: {
  quizzes: HomeQueueQuiz[]; // most recently edited first
  emailsWithoutDestination: boolean;
}): HomeWaitItem[] {
  const items: HomeWaitItem[] = [];
  const setup = input.quizzes.find((q) => q.inSetup);
  if (setup) {
    items.push({
      kind: setup.stalled ? "stalled" : "setup",
      key: `${setup.stalled ? "stalled" : "setup"}:${setup.id}`,
      title: setup.stalled
        ? `Setup stalled on “${setup.name}”`
        : `Finish setting up “${setup.name}”`,
      href: `/studio/onboarding/${setup.id}`,
      stepIndex: setup.stepIndex,
    });
  }
  const draft = input.quizzes.find((q) => !q.inSetup && q.status !== "published");
  if (draft) {
    items.push({
      kind: "publish",
      key: `publish:${draft.id}`,
      title: `Publish “${draft.name}”`,
      href: `/studio/${draft.id}`,
    });
  }
  const unvisited = input.quizzes.find((q) => q.status === "published" && q.starts === 0);
  if (unvisited) {
    items.push({
      kind: "store",
      key: `store:${unvisited.id}`,
      title: `Add “${unvisited.name}” to your store`,
      href: `/studio/${unvisited.id}/embed`,
    });
  }
  if (input.emailsWithoutDestination) {
    items.push({
      kind: "emails",
      key: "emails",
      title: "Send your captured emails somewhere",
      href: "/studio/integrations",
    });
  }
  return items;
}

/** Split the queue into the lead card and the "Also waiting" list. Emails
    never lead; a dismissed lead keeps its place at the top of the list. */
export function splitHomeQueue(
  items: HomeWaitItem[],
  dismissedKey: string | null,
): { next: HomeWaitItem | null; also: HomeWaitItem[] } {
  const lead = items[0] && items[0].kind !== "emails" ? items[0] : null;
  if (!lead || lead.key === dismissedKey) return { next: null, also: items };
  return { next: lead, also: items.slice(1) };
}

/* ── Catalog starters ──────────────────────────────────────────────────────
   "Or start from your catalog" (first-run handoff §4.2): at most three chips —
   the whole catalog, then the two biggest collections. The label is a short
   handle; the meta names the source and its product count; picking one
   writes the whole goal sentence into the box. Deterministic, no AI. */

export interface HomeStarter {
  label: string;
  meta: string;
  goal: string;
}

export function groupStarterGoal(groupName: string, criteria: string): string {
  return `Help shoppers pick the right ${singularizeName(groupName).toLowerCase()} for ${criteria}.`;
}

export function buildHomeStarters(input: {
  productCount: number;
  catalog: { label: string; goal: string; criteria: string };
  groups: Array<{ name: string; size: number }>;
}): HomeStarter[] {
  if (input.productCount === 0) return [];
  const starters: HomeStarter[] = [
    {
      label: input.catalog.label,
      meta: `Whole catalog · ${input.productCount}`,
      goal: input.catalog.goal,
    },
  ];
  const biggest = [...input.groups]
    .filter((g) => g.name.trim() && g.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 2);
  for (const g of biggest) {
    starters.push({
      label: singularizeName(g.name),
      meta: `${g.name.trim()} · ${g.size}`,
      goal: groupStarterGoal(g.name, input.catalog.criteria),
    });
  }
  return starters;
}

/* ── Starts sparkline ──────────────────────────────────────────────────────
   Ten equal slices of the 30-day window, oldest first, as 0–100 heights
   relative to the busiest slice. */

export function sparkHeights(
  timestamps: Array<Date | string>,
  windowStart: number,
  now: number,
  slices = 10,
): number[] {
  const counts = new Array<number>(slices).fill(0);
  const span = (now - windowStart) / slices;
  if (span <= 0) return counts;
  for (const ts of timestamps) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t) || t < windowStart || t > now) continue;
    counts[Math.min(slices - 1, Math.floor((t - windowStart) / span))]! += 1;
  }
  const max = Math.max(...counts);
  return counts.map((c) => (max === 0 ? 0 : Math.round((c / max) * 100)));
}

/* ── "Edited Sep 12" / "Edited today" — UTC parts, so SSR and hydration
   render the same string. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function editedLabel(when: Date | string, now: number): string {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return "";
  const n = new Date(now);
  const sameDay =
    d.getUTCFullYear() === n.getUTCFullYear() &&
    d.getUTCMonth() === n.getUTCMonth() &&
    d.getUTCDate() === n.getUTCDate();
  if (sameDay) return "Edited today";
  const year = d.getUTCFullYear() === n.getUTCFullYear() ? "" : `, ${d.getUTCFullYear()}`;
  return `Edited ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${year}`;
}
