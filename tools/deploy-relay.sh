#!/usr/bin/env bash
#
# Put Slake's relay helper on Cloudflare (once, or to update it).
#
# You need three things, all from your free Cloudflare account:
#   CLOUDFLARE_API_TOKEN   a token made from the "Edit Cloudflare Workers" template
#   TURN_KEY_ID            from Realtime > TURN > Create (the key's ID)
#   TURN_KEY_API_TOKEN     shown once when you create that TURN key
# Set them in the Replit shell, then:
#   rm -rf /tmp/slake && git clone -q --depth 1 https://github.com/johnmitchellxxx/slake /tmp/slake && bash /tmp/slake/tools/deploy-relay.sh
#
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for v in CLOUDFLARE_API_TOKEN TURN_KEY_ID TURN_KEY_API_TOKEN; do
  if [ -z "${!v:-}" ]; then echo "ERROR: $v is not set." >&2; exit 1; fi
done
cd "$HERE/worker"
echo "==> [1/3] Deploying the worker..."
OUT="$(npx --yes wrangler@3 deploy 2>&1)"; echo "$OUT"
URL="$(printf '%s' "$OUT" | grep -o 'https://[A-Za-z0-9.-]*workers.dev' | head -1)"
if [ -z "$URL" ]; then echo "ERROR: couldn't find the worker's address in the output above." >&2; exit 1; fi
echo "==> [2/3] Putting the secrets on it..."
printf '%s' "$TURN_KEY_ID" | npx --yes wrangler@3 secret put TURN_KEY_ID >/dev/null
printf '%s' "$TURN_KEY_API_TOKEN" | npx --yes wrangler@3 secret put TURN_KEY_API_TOKEN >/dev/null
echo "==> [3/3] Checking it answers..."
curl -fsS "$URL" | head -c 200; echo
echo ""
echo "==> Done. Tell Claude this address: $URL"
