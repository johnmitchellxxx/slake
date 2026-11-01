#!/usr/bin/env bash
#
# Publish the Slake web page to slake.pantheon.live (its own Vercel project,
# separate from the Pantheon site).
#
# Run it anywhere VERCEL_TOKEN is set (the Pantheon Replit has it):
#   rm -rf /tmp/slake && git clone -q --depth 1 https://github.com/johnmitchellxxx/slake /tmp/slake && bash /tmp/slake/tools/publish-web.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE="${VERCEL_SCOPE:-xjohnmitchell-6311s-projects}"
DOMAIN="${SLAKE_DOMAIN:-slake.pantheon.live}"
# The folder's name becomes the Vercel project's name the first time.
OUT="$(mktemp -d)/slake"

if [ -z "${VERCEL_TOKEN:-}" ]; then
  echo "ERROR: VERCEL_TOKEN is not set. Run this from the Pantheon Replit shell." >&2
  exit 1
fi

echo "==> [1/3] Building the Slake page..."
node "$HERE/tools/build-web-preview.js" "$OUT"

echo "==> [2/3] Deploying to Vercel..."
cd "$OUT"
npx --yes vercel@latest deploy --prod --yes --scope "$SCOPE" --token "$VERCEL_TOKEN"

echo "==> [3/3] Pointing $DOMAIN at it..."
npx --yes vercel@latest domains add "$DOMAIN" slake --scope "$SCOPE" --token "$VERCEL_TOKEN" 2>&1 | tail -5 || true

echo ""
echo "==> Done. Open https://$DOMAIN"
echo "    First time only: if it says the domain isn't set up, add a DNS record"
echo "    where pantheon.live's DNS lives:  CNAME  slake  ->  cname.vercel-dns.com"
