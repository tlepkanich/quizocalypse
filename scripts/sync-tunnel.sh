#!/usr/bin/env bash
# Read the current cloudflared tunnel URL from its local metrics endpoint,
# rewrite shopify.app.toml to point at it, and deploy a new app version.
#
# Run this in a second terminal whenever `npm run dev` starts (or restarts).
# The trycloudflare quick-tunnel URL rotates on every restart; this script
# automates the redeploy so Shopify admin loads the live tunnel.

set -euo pipefail

CF_METRICS="http://localhost:20241"
TOML="shopify.app.toml"
WAIT_TIMEOUT=60

cd "$(dirname "$0")/.."

# Wait for cloudflared to come up.
echo "Waiting for cloudflared metrics endpoint on $CF_METRICS ..."
for i in $(seq 1 "$WAIT_TIMEOUT"); do
  if curl -sf -m 2 "$CF_METRICS/ready" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# Confirm ready.
if ! curl -sf -m 2 "$CF_METRICS/ready" >/dev/null 2>&1; then
  echo "ERROR: cloudflared metrics endpoint not reachable after ${WAIT_TIMEOUT}s." >&2
  echo "Is \`npm run dev\` running in another terminal?" >&2
  exit 1
fi

# Extract hostname.
HOSTNAME=$(curl -sf -m 2 "$CF_METRICS/quicktunnel" | sed -E 's/.*"hostname":"([^"]+)".*/\1/')
if [[ -z "$HOSTNAME" ]]; then
  echo "ERROR: failed to read tunnel hostname from $CF_METRICS/quicktunnel" >&2
  exit 1
fi

TUNNEL_URL="https://$HOSTNAME"
echo "Live tunnel: $TUNNEL_URL"

# Check if the toml already matches — skip deploy if no change.
CURRENT=$(grep -E '^application_url' "$TOML" | sed -E 's/.*"(https:[^"]+)".*/\1/')
if [[ "$CURRENT" == "$TUNNEL_URL" ]]; then
  echo "shopify.app.toml already points at this tunnel. Skipping deploy."
  exit 0
fi

# Update application_url + all redirect URLs to the new host.
# Match anything *.trycloudflare.com plus the placeholder shopify.dev URL.
sed -i.bak -E "s|https://[a-z0-9-]+\.trycloudflare\.com|$TUNNEL_URL|g" "$TOML"
sed -i.bak -E "s|https://shopify\.dev/apps/default-app-home|$TUNNEL_URL|g" "$TOML"
rm "$TOML.bak"

echo "Updated $TOML:"
grep -E "application_url|trycloudflare" "$TOML" | sed 's/^/  /'

echo ""
echo "Deploying new app version ..."
shopify app deploy --allow-updates
