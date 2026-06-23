# Changelog

Autonomous ship log. The **Quiz Maintainer** routine prepends one entry per run
(newest first) recording what it shipped from the Google Drive specs. Hand-written
notes are welcome above the auto entries.

<!-- routine: insert each run's entry directly below this line, newest first -->

## 2026-06-23 — pipeline + control docs set up (manual)
- Autonomous CI/CD live: push to `main` → gates → Fly deploy → post-deploy e2e
  smoke → auto-rollback. (`ce72873`, `011fbe8`)
- Lockfile regenerated so `npm ci` passes on Linux. (`a7e294b`)
- Scope control added: `_roadmap.md` (Drive), `docs/spec-status.md`, this changelog.

_No autonomous spec runs yet — the first scheduled run records the first auto entry._
