import { z } from "zod";

// HOME-3 — Shop.homeState, parsed. Two different dismissals live here
// (first-run handoff §10.3 vs §10.5):
//  • goalDialogShownAt — the first-open dialog, once per shop, forever.
//  • reminder — the ONE queue item last dismissed with the ✕. It is keyed by
//    kind + quiz, so it re-arms by itself when the queue head changes or that
//    quiz changes state (setup → stalled, draft → live, …): the new head has a
//    different key and no longer matches.

export const HomeState = z.object({
  goalDialogShownAt: z.string().optional(),
  reminder: z
    .object({
      key: z.string().min(1).max(200),
      dismissedAt: z.string(),
    })
    .optional(),
});
export type HomeState = z.infer<typeof HomeState>;

/** Never throws: an unreadable column reads as a fresh shop. */
export function parseHomeState(raw: unknown): HomeState {
  const parsed = HomeState.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function withDialogShown(state: HomeState, now: Date): HomeState {
  return state.goalDialogShownAt ? state : { ...state, goalDialogShownAt: now.toISOString() };
}

export function withReminderDismissed(state: HomeState, key: string, now: Date): HomeState {
  return { ...state, reminder: { key, dismissedAt: now.toISOString() } };
}
