# WIS-027 — standalone published history

Owner selected published history and restore in standalone on 2026-10-04 in
#functionality-requests (thread 1790879606.098179). Draft checkpoints are outside
this release. Existing unfinished backlog items remain paused.

The decider builder's History button waits for pending saves, including edits
made while a save is in flight. History lists the existing last ten published
snapshots, with UTC publish time and a live-version badge. Confirmation restores
only the draft; publishing remains a separate action. The latest snapshot is
restorable too. Empty history explains how to create the first snapshot.

## Two-lens adversarial review

Persistence: restoration validates the stored snapshot and uses an atomic
updatedAt comparison to reject intervening edits/publishes. Active buildState
and detached funnel generation are rejected. Only draftJson is written; the
published payload, status, version counter and snapshots are untouched. No
schema/migration, publish path, runtime or legacy behavior changes. This is not
a multi-editor locking system: an already-open editor can subsequently autosave,
so confirmation explicitly asks the merchant to close other tabs. Published
history does not retain the unpublished draft that is replaced.

Authorization: both standalone loader and action require existing studio auth
and resolve the configured shop server-side. Quiz and snapshot reads are
shop-scoped; final writes also include shop and quiz IDs. Input is Zod-validated,
legacy and invalid documents fail closed, and snapshot payloads never reach the
history browser page. Existing embedded history behavior is untouched.

## Verification

- Ten new service tests cover shop isolation, snapshot ownership/expiry,
  malformed/legacy documents, summary-only history, generation conflict,
  optimistic conflict and draft-only writes.
- Local throwaway quiz, borrowed shop only (shared fixtures untouched): Cancel
  preserved both documents; old and latest version restores changed the draft
  while publishedJson/status/version stayed identical; stale updatedAt produced
  a recoverable conflict; unauthenticated access redirected to login.
- CUA browser: pending heading edit immediately followed by History persisted;
  restored heading appeared in builder; empty history; confirmation focus on
  Cancel; desktop 1280×720 and mobile 390×844 screenshots reviewed. Local
  screenshot `/tmp/wis027-history.png` records success on the final feature build.
- Full unpiped release gates run before commit; CI/deploy evidence is recorded
  in the durable Slack backlog after shipping.

The Slack overview also stops repeating completed/cancelled task notes to stay
within message limits. Full evidence remains in durable state; all task IDs,
titles and statuses remain on the board. Five bridge checks pass and the
canonical board update succeeded.
