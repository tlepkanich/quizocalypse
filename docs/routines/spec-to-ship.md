# Routine: Spec → Ship (autonomous, no PR review)

Turns new/changed product specs in the Drive specs folder into shipped code on
`quizocalypse-studio.fly.dev`, with **no human PR review** — deliberately, while
the app is pre-production. The safety net is automated, not a reviewer:

- The strict gate chain (`typecheck && test && build && lint`) is a **hard stop**
  in [`scripts/ship.sh`](../../scripts/ship.sh) — a failing gate aborts *before*
  anything reaches prod.
- A **post-deploy e2e smoke** runs against the live deploy; if it fails, the
  script **rolls back** to the previous Fly image automatically.
- A few irreversible changes (destructive migrations, auth/secrets/billing)
  **always pause** for a human, regardless of PR policy.

> **Flip to PR-gated later:** when the app hits production-readiness, change step 4
> of the prompt to "open a PR and stop" instead of running `scripts/ship.sh`.
> Nothing else changes.

---

## The routine prompt

Paste this into the cloud routine's instructions.

```
You maintain the quizocalypse app (repo: github.com/tlepkanich/quizocalypse,
deployed at quizocalypse-studio.fly.dev). Each run, turn new or changed product
specs into shipped code. PR review is intentionally skipped right now — the
automated gates in scripts/ship.sh are the safety net, not a human.

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

4. SHIP. Run: bash scripts/ship.sh
   It runs the strict gate chain (typecheck && test && build && lint) as a HARD
   stop, captures the current live image, pushes, deploys to Fly, waits for
   health, runs the post-deploy e2e smoke, and auto-rolls-back if the smoke
   fails. If ship.sh aborts on a gate, FIX the root cause and re-run — never
   bypass a gate. If it rolls back, report the failure and STOP; do not retry
   blindly.

5. CARVE-OUTS — stop and report instead of proceeding if a spec requires any of:
   - a destructive DB migration (dropping/renaming columns or tables, or a
     backfill that can lose data);
   - any change to authentication, sessions, secrets, billing, or rate-limit /
     risk controls;
   - anything you are not confident you fully understood.
   These pause regardless of PR policy because they are hard to reverse.

6. REPORT. Summarize: which specs shipped (with the deployed commit SHA), which
   were already implemented, which were skipped and why. If nothing was in
   scope, say so briefly.
```

---

## One-time setup (in the cloud routine's environment)

| Need | How |
| --- | --- |
| **Repo write access** | The GitHub integration the routine already uses. |
| **`FLY_API_TOKEN`** | Add as a routine secret. `fly tokens create deploy -a quizocalypse-studio` generates a deploy-scoped token. This is the **only** new credential — runtime secrets (DB, Anthropic, Shopify, encryption key) already live on Fly. |
| **Node deps** | `npm ci` at the start of each run. |
| **Playwright browser** | `npx playwright install --with-deps chromium` (needed for the post-deploy smoke). |
| **`jq`** | For rollback-image capture. If absent, deploy still works but auto-rollback is disabled (the script warns). |

The gates (`typecheck`/`test`/`build`/`lint`) need **no secrets** — the tests are
deterministic and don't hit the network — so a missing key can't silently green a
broken build.

## What `scripts/ship.sh` guarantees

1. On `main`, clean tree, something new to ship — else it no-ops.
2. **Destructive migration → abort** (grep tripwire on the migration diff).
3. **Gates are a hard stop** — no deploy unless all four pass.
4. Captures the live image, pushes, deploys via Fly's remote builder.
5. Polls the deploy for HTTP 200, then runs `npm run e2e` (one retry to absorb
   transient live flakiness).
6. Smoke fails → **rollback to the captured image**; if the image couldn't be
   captured or rollback fails, it dies loudly so a human steps in (it never
   leaves prod silently broken).

## Notes / gotchas
- The Fly app is a **single always-on machine**; `fly deploy` restarts it, so
  every ship has a brief (~25–40s) boot window — the smoke waits for it.
- Migrations apply **on boot** (`prisma migrate deploy`), so additive schema
  changes ship with the code automatically. Destructive ones are the carve-out.
- `--remote-only` is used so the routine needs **no local Docker**.
