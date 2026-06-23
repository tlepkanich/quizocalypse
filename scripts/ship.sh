#!/usr/bin/env bash
# ship.sh — autonomous gate → deploy → smoke → rollback for quizocalypse-studio.
#
# Used by the cloud "spec → ship" routine (docs/routines/spec-to-ship.md).
# PR review is intentionally skipped while the app is pre-production, so the
# AUTOMATED gates here are the only thing between a change and prod — they are
# HARD stops. A bad deploy is caught by a post-deploy e2e smoke and rolled back
# to the previous image.
#
# To re-enable human review at production-readiness: have the routine open a PR
# instead of calling this script (one-line change in the routine prompt).
#
# Requires in the environment:
#   - node + npm, with deps installed (npm ci)
#   - fly (flyctl) and FLY_API_TOKEN   (deploy + rollback)
#   - chromium for Playwright          (npx playwright install --with-deps chromium)
#   - jq                               (rollback-image capture; optional but recommended)

set -euo pipefail

APP="quizocalypse-studio"
BASE_URL="${SMOKE_BASE:-https://quizocalypse-studio.fly.dev}"
BRANCH="main"

cd "$(dirname "$0")/.."   # repo root

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Best-effort: load .env for LOCAL runs. In the cloud routine the environment is
# provided via the routine's secrets, so .env is usually absent — that's fine.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# ---------------------------------------------------------------------------
# 0. Preconditions
# ---------------------------------------------------------------------------
[ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ] \
  || die "not on $BRANCH (on $(git rev-parse --abbrev-ref HEAD)) — refusing to ship"
git diff --quiet && git diff --cached --quiet \
  || die "uncommitted changes — commit them before shipping"
command -v fly >/dev/null || die "flyctl not installed"
: "${FLY_API_TOKEN:?FLY_API_TOKEN must be set to deploy}"

git fetch -q origin "$BRANCH" || die "could not fetch origin/$BRANCH"
if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ]; then
  log "Nothing to ship — HEAD already matches origin/$BRANCH."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Migration safety — destructive schema changes NEVER auto-ship
# ---------------------------------------------------------------------------
# Migrations apply on boot (docker-start: prisma migrate deploy). Additive ones
# are safe; destructive ones can lose data, so they require a human regardless
# of PR policy.
if git diff --name-only "origin/$BRANCH...HEAD" -- prisma/migrations | grep -q .; then
  if git diff "origin/$BRANCH...HEAD" -- prisma/migrations \
       | grep -iqE '^\+.*(drop (table|column)|drop constraint|alter column .* drop|truncate|delete from)'; then
    die "destructive migration detected — refusing to auto-deploy. A human must review the schema change."
  fi
  log "Additive migration(s) detected — will apply on boot."
fi

# ---------------------------------------------------------------------------
# 2. Gates — the HARD stop. Any failure aborts BEFORE anything reaches prod.
# ---------------------------------------------------------------------------
log "Gate 1/4 · typecheck"; npm run typecheck
log "Gate 2/4 · tests";     npm test
log "Gate 3/4 · build";     npm run build
log "Gate 4/4 · lint";      npm run lint
log "All gates green ✓"

# ---------------------------------------------------------------------------
# 3. Capture the current live image (rollback target), then push
# ---------------------------------------------------------------------------
log "Capturing current live image for rollback"
OLD_IMAGE="$(fly releases --app "$APP" --image --json 2>/dev/null \
  | jq -r 'map(select(.Status=="complete"))[0].ImageRef // .[0].ImageRef // empty' 2>/dev/null || true)"
if [ -n "$OLD_IMAGE" ]; then
  log "Rollback target: $OLD_IMAGE"
else
  warn "could not capture the current image — automatic rollback will be UNAVAILABLE this run"
fi

log "Pushing $BRANCH to origin"
git push origin "$BRANCH"

# ---------------------------------------------------------------------------
# 4. Deploy (remote builder — no local Docker needed in the cloud routine)
# ---------------------------------------------------------------------------
log "Deploying $(git rev-parse --short HEAD) to $APP"
fly deploy --remote-only --app "$APP" \
  || die "fly deploy failed — the previous release is still live (nothing to roll back)"

# ---------------------------------------------------------------------------
# 5. Wait for health, then run the post-deploy smoke (the review substitute)
# ---------------------------------------------------------------------------
log "Waiting for the deploy to answer (boot runs migrate deploy ~25-40s)"
for i in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL" || echo 000)"
  # Root 302→/studio; any 2xx/3xx means the server booted and is routing.
  if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then log "Live ($code)"; break; fi
  [ "$i" = "40" ] && die "deploy never came up (last: $code) after ~2min"
  sleep 3
done

log "Post-deploy e2e smoke against $BASE_URL (one retry to absorb live flakiness)"
if npm run e2e || npm run e2e; then
  log "Smoke passed ✓"
else
  printf '\033[1;31m✗ smoke FAILED on the new deploy\033[0m\n'
  if [ -n "$OLD_IMAGE" ]; then
    log "Rolling back to $OLD_IMAGE"
    if fly deploy --image "$OLD_IMAGE" --remote-only --app "$APP"; then
      die "rolled back to the previous release. Investigate the failed change before retrying."
    else
      die "ROLLBACK FAILED — prod may be broken. Intervene now: fly releases --app $APP"
    fi
  else
    die "smoke failed and no rollback image was captured — intervene now: fly releases --app $APP"
  fi
fi

log "Shipped $(git rev-parse --short HEAD) → $BASE_URL ✓"
