# WIS-028 — published history pop-up

Owner follow-up 1791154731.634999 in the WIS-027 Slack thread requested a
pop-up instead of navigating to a dedicated page. The standalone decider
builder now opens its existing published snapshots in a shared QzModal.
Confirmation replaces the list inside that same modal. Existing direct history
URLs remain usable; the builder entry no longer navigates there.

## Two-lens adversarial review

Persistence: pending autosaves settle before opening, including edits made during
an in-flight save. The editor is inert behind the modal. Restore keeps the
existing shop-scoped, Zod-validated, generation-guarded updatedAt compare-and-swap.
The window cannot close during restore. On success the current builder URL
reloads, replacing both local draft and undo state without saving the old doc.
No publish, runtime, schema or legacy path changes. Other tabs remain the same
explicitly documented limitation as WIS-027: close them before restoring.

Interaction and authorization: the modal uses the shared portal, focus trap,
background inertness and scroll lock. Cancel returns to the list; Escape/Close/
Done return to the builder. The History trigger is the focus fallback after a
save temporarily disables it. Failed restores restore focus and offer history
reload; reloading clears the obsolete error. Only history summaries reach the
browser; existing studio authentication and shop-scoped loader/action remain.
Expected missing/legacy history errors render inside the modal instead of
throwing the user out of the editor. Unexpected errors still reach Remix's
error boundary.

## Verification

A disposable local quiz borrows only the fixture's shop. CUA checks cover the
in-place list, single-window confirmation, Cancel, pending heading-save flush,
stale conflict and reload, older/latest restore, keyboard dismissal and
responsive screenshots. Database comparisons verify that publishedJson,
status and version do not change. Full unpiped gates and CI/deploy results are
recorded in the durable Slack backlog at completion.
