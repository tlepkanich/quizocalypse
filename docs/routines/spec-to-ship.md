# Routine: Spec → Ship (autonomous, no PR review)

Turns new/changed product specs in the Drive specs folder into shipped code on
`quizocalypse-studio.fly.dev`, with **no human PR review** — deliberately, while
the app is pre-production. The safety net is automated, not a reviewer:

- **Deploy lives in CI** ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)).
  The routine just implements + pushes to `main`; the workflow runs the gate
  chain (`typecheck && test && build && lint`), and only if all four pass does it
  deploy to Fly.
- A **post-deploy e2e smoke** runs against the live deploy; if it fails, the
  workflow **auto-rolls-back** to the previous Fly image.
- A few irreversible changes (destructive migrations, auth/secrets/billing)
  **always pause** for a human, regardless of PR policy.

> **Flip to PR-gated later:** when the app hits production-readiness, change step 4
> of the prompt to "open a PR and stop" instead of pushing to `main`. The `check`
> job already runs on PRs, and the `deploy` job only runs on push to `main`, so a
> PR will gate-check but won't deploy until you review + merge. Nothing else changes.

---

## The routine prompt

Paste this into the cloud routine's instructions.

```
You maintain the quizocalypse app (repo: github.com/tlepkanich/quizocalypse,
deployed at quizocalypse-studio.fly.dev). Each run, turn new or changed product
specs into shipped code. PR review is intentionally skipped right now — the
gates + post-deploy smoke + auto-rollback in the GitHub Actions workflow
(.github/workflows/ci.yml) are the safety net, not a human.

1. INTAKE. List the Google Drive specs folder (ID
   1SGz6sN_Xw9OU-_MLbrdBaWG6Oy2WIZZP). A spec is in scope if its modifiedTime is
   within the last 26 hours (overlap your schedule so nothing slips the gap).
   Read each in-scope spec in full.

2. TRIAGE. For each spec, determine the delta vs the current code: what it asks
   for, and what is already implemented. If a spec is fully implemented, record
   "no change needed" and skip it. If a spec is ambiguous or underspecified in a
   way that changes the implementation, STOP on that spec and report the
   question — do not guess.

3. IMPLEMENT. On the main branch, implement the outstanding delta only. Match the
   surrounding code's conventions; do NOT add unrequested features. Write or
   extend tests for new logic. If a schema change is needed, hand-author an
   ADDITIVE Prisma migration (never destructive — see CARVE-OUTS). Commit with a
   clear message.

4. SHIP. Run the gate chain locally first, so a red build never lands on main:
     npm run typecheck && npm test && npm run build && npm run lint
   If any gate fails, FIX the root cause — never push a failing build. When all
   four pass, push to main:
     git push origin main
   The "CI / Deploy" workflow then re-runs the gates and, only if green, deploys
   to Fly, waits for health, runs the post-deploy e2e smoke, and auto-rolls-back
   on smoke failure. Watch that run: if the deploy job fails or rolls back,
   report it and STOP — do not retry blindly.

5. CARVE-OUTS — stop and report instead of proceeding if a spec requires any of:
   - a destructive DB migration (dropping/renaming columns or tables, or a
     backfill that can lose data);
   - any change to authentication, sessions, secrets, billing, or rate-limit /
     risk controls;
   - anything you are not confident you fully understood.
   These pause regardless of PR policy because they are hard to reverse.

6. REPORT. Summarize: which specs shipped (with the pushed commit SHA + the CI
   run result), which were already implemented, which were skipped and why. If
   nothing was in scope, say so briefly.
```

---

## One-time setup

| Where | Need | How |
| --- | --- | --- |
| **GitHub repo → Settings → Secrets → Actions** | `FLY_API_TOKEN` | `fly tokens create deploy -a quizocalypse-studio` → paste as a new repository secret named exactly `FLY_API_TOKEN`. This is the **only** new credential; until it exists the `deploy` job stays *skipped*, not failed. |
| **Cloud routine env** | Repo + Google Drive connectors | The routine reads the specs folder (Drive) and pushes code (repo). |
| **Cloud routine env** | Node + deps | `npm ci` so it can run the gate chain locally before pushing. (No Playwright needed in the routine — the smoke runs in CI.) |

Runtime secrets (DB, Anthropic, Shopify, encryption key) already live on Fly, so
the deploy needs nothing beyond `FLY_API_TOKEN`. The gates need **no** secrets —
the tests are deterministic and offline — so a missing key can't silently green a
broken build.

## What the CI workflow guarantees

1. Gates run on every push to `main` **and** every PR; `deploy` runs only on push
   to `main`, only after gates pass, and only once `FLY_API_TOKEN` exists.
2. **Gates are a hard stop** — `deploy` `needs: [check]`, so a red gate means no
   deploy.
3. Captures the live image (best-effort), deploys via Fly's remote builder, polls
   for HTTP 200, then runs the e2e smoke (one retry for transient flakiness).
4. **Smoke fails on a release that actually went live → rollback** to the captured
   image. If the deploy step itself failed, the prior release is still serving, so
   it does *not* roll back.
5. The Fly token is scoped to only the three `flyctl` steps — it's never in the
   environment of `npm ci` / playwright / the smoke (untrusted third-party code).

## Manual / local alternative — `scripts/ship.sh`

[`scripts/ship.sh`](../../scripts/ship.sh) does the same gate→deploy→smoke→rollback
from a laptop (it also gates **before** pushing, and refuses destructive
migrations). Use it for a manual deploy outside CI; the autonomous routine relies
on the CI workflow instead.

## Notes / gotchas
- The Fly app is a **single always-on machine**; deploy restarts it, so every ship
  has a brief (~25–40s) boot window — the smoke waits for it.
- Migrations apply **on boot** (`prisma migrate deploy`), so additive schema
  changes ship with the code. Destructive ones are the carve-out.
- The deploy uses `--remote-only` (Fly's builder), so CI needs no Docker.
