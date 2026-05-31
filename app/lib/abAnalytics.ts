import type { Quiz as QuizDoc, QuizNode, BranchSlot } from "./quizSchema";

// ───────────────────────────────────────────────────────────────────────────
// A/B analytics (FOCUS #2) — segment the funnel by the variant a shopper was
// assigned at an `ab_split` branch.
//
// At runtime the engine sticks each session to a slot per branch
// (`ctx.abAssignments`, persisted in `localStorage qz-state-<id>` as `ab`).
// The storefront now stamps that assignment map onto every analytics event's
// payload as `payload.ab = { [branchId]: slotId }`. These pure helpers read
// that back to produce a per-slot funnel so the builder can compare variants.
//
// Distinct-session counting mirrors the existing per-stage aggregation in
// app/routes/app.quizzes.$id_.analytics.tsx (a Set<sessionId> per stage).
// ───────────────────────────────────────────────────────────────────────────

export type BranchNode = Extract<QuizNode, { type: "branch" }>;

export interface FunnelCounts {
  // Distinct sessions assigned to this variant (any tagged event). A/B
  // assignment happens AT the branch — usually mid-flow — so quiz_started
  // isn't tagged; `entered` is the correct per-variant baseline/denominator.
  entered: number;
  started: number;
  answered: number;
  completed: number;
  viewed: number;
  clicked: number;
}

// The minimal event shape the aggregator needs. `payload` is the raw JSON value
// stored on the Event row.
export interface VariantEvent {
  sessionId: string;
  eventType: string;
  payload?: unknown;
}

const EMPTY_FUNNEL: FunnelCounts = {
  entered: 0,
  started: 0,
  answered: 0,
  completed: 0,
  viewed: 0,
  clicked: 0,
};

const STAGE_BY_EVENT: Record<string, keyof FunnelCounts> = {
  quiz_started: "started",
  question_answered: "answered",
  quiz_completed: "completed",
  recommendation_viewed: "viewed",
  recommendation_clicked: "clicked",
};

/** Every branch node currently configured as an A/B split. */
export function findAbBranches(doc: QuizDoc): BranchNode[] {
  return doc.nodes.filter(
    (n): n is BranchNode => n.type === "branch" && n.data.mode === "ab_split",
  );
}

/**
 * Read the slot a session was assigned at `branchId` from an event payload's
 * `ab` map. Returns null when the event wasn't tagged (legacy events) or the
 * branch isn't present.
 */
export function readAssignment(payload: unknown, branchId: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const ab = (payload as Record<string, unknown>).ab;
  if (!ab || typeof ab !== "object") return null;
  const slotId = (ab as Record<string, unknown>)[branchId];
  return typeof slotId === "string" ? slotId : null;
}

/**
 * Per-slot distinct-session funnel for one A/B branch. Events whose payload
 * carries no assignment for this branch are skipped; assignments to a slot that
 * no longer exists are ignored.
 */
export function aggregateVariantFunnel(
  events: VariantEvent[],
  branchId: string,
  slots: BranchSlot[],
): Record<string, FunnelCounts> {
  // slotId → stage → Set<sessionId>
  const acc = new Map<string, Map<keyof FunnelCounts, Set<string>>>();
  // slotId → Set<sessionId> across ALL tagged events (the `entered` baseline).
  const entered = new Map<string, Set<string>>();
  const slotIds = new Set(slots.map((s) => s.id));
  for (const s of slots) {
    acc.set(s.id, new Map());
    entered.set(s.id, new Set());
  }

  for (const ev of events) {
    const slotId = readAssignment(ev.payload, branchId);
    if (!slotId || !slotIds.has(slotId)) continue;
    entered.get(slotId)!.add(ev.sessionId);
    const stage = STAGE_BY_EVENT[ev.eventType];
    if (!stage) continue;
    const slotMap = acc.get(slotId)!;
    const set = slotMap.get(stage) ?? new Set<string>();
    set.add(ev.sessionId);
    slotMap.set(stage, set);
  }

  const out: Record<string, FunnelCounts> = {};
  for (const s of slots) {
    const m = acc.get(s.id)!;
    out[s.id] = {
      entered: entered.get(s.id)!.size,
      started: m.get("started")?.size ?? 0,
      answered: m.get("answered")?.size ?? 0,
      completed: m.get("completed")?.size ?? 0,
      viewed: m.get("viewed")?.size ?? 0,
      clicked: m.get("clicked")?.size ?? 0,
    };
  }
  return out;
}

/**
 * Funnels for every A/B branch in the quiz, keyed by branch id then slot id.
 * Used by the Studio loader + the analytics page.
 */
export function aggregateAllAbFunnels(
  doc: QuizDoc,
  events: VariantEvent[],
): Record<string, Record<string, FunnelCounts>> {
  const out: Record<string, Record<string, FunnelCounts>> = {};
  for (const br of findAbBranches(doc)) {
    out[br.id] = aggregateVariantFunnel(events, br.id, br.data.slots);
  }
  return out;
}

export { EMPTY_FUNNEL };
