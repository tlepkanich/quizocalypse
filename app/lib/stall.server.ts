// ai-fallbacks Gap 6 — ONE shared stall rule for every detached AI job. A
// detached job that dies without its catch firing (a deploy restart kills the
// process mid-run) strands its "in flight" marker forever; the backstop is:
// still in flight + no persisted write in DETACHED_JOB_STALL_MS = presumed
// dead, surface the failed state + a way forward.
//
// 200s, not the spec's suggested 45-60s: the question build's legitimate
// no-write window reaches ~75-110s (runAiOnboardingBuild writes draftJson only
// at the very end — see funnelLoader.server.ts), and a false "stalled" invites
// a duplicate re-kick alongside a healthy run.
export const DETACHED_JOB_STALL_MS = 200_000;

export function isDetachedJobStalled(
  lastWriteAt: Date | string,
  now: number = Date.now(),
): boolean {
  const t = new Date(lastWriteAt).getTime();
  if (Number.isNaN(t)) return false;
  return now - t > DETACHED_JOB_STALL_MS;
}

// Brand-identity detached build: Shop has no updatedAt column, so the job's
// start time is stamped INTO the state ("building:<iso>",
// brandIdentityBuild.server.ts). This resolver normalizes the state back to
// the client contract ("building") and derives stalled. A bare legacy
// "building" (or an unparseable stamp) reads as stalled immediately: it can
// only predate the current deploy, and a deploy kills detached jobs — which
// also self-heals shops stranded before the stamp existed.
export function resolveIdentityBuildState(
  raw: string | null,
  now: number = Date.now(),
): { state: string | null; stalled: boolean } {
  if (!raw || !raw.startsWith("building")) return { state: raw, stalled: false };
  const t = new Date(raw.slice("building:".length)).getTime();
  const stalled = Number.isNaN(t) || now - t > DETACHED_JOB_STALL_MS;
  return { state: "building", stalled };
}
