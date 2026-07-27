#!/usr/bin/env bash
#
# Scheduled refresh of the STAGING Meta-pacer data from PRODUCTION.
#
# Runs ON the staging droplet (staging's Postgres is local to it; prod is the
# managed DO database). Wiring:
#   - TARGET (write) = the droplet's own staging DB, taken from the app env
#     (.env.local → DATABASE_URL). Because it's 127.0.0.1, it can only ever be
#     this droplet's DB — the copy can't accidentally target prod.
#   - SOURCE (read)  = production, from a root-only secret file (see below).
#
# The underlying script (scripts/sync-meta-pacer-from-prod.ts) reads SOURCE,
# writes TARGET, refuses to run if the two are identical, and never writes
# SOURCE — so prod is safe even if something here is misconfigured.
#
# One-time droplet setup:
#   1. Create the prod-URL secret (root only):
#        umask 077
#        printf "SOURCE_DATABASE_URL='%s'\n" \
#          'postgresql://doadmin:PASSWORD@loomi-prod-…ondigitalocean.com:25060/defaultdb?sslmode=require' \
#          > /root/.meta-pacer-sync.env
#   2. Allow this droplet on the PROD database's Trusted Sources (DO console).
#   3. Add the cron entry (root crontab), e.g. nightly at 03:30:
#        30 3 * * * bash /var/www/loomi-studio/current/scripts/ops/sync-meta-pacer-cron.sh >> /var/log/meta-pacer-sync.log 2>&1
#
# NOTE: each run REPLACES staging's pacer tables with prod's — any manual edits
# made on staging between runs are overwritten. That's the point of a mirror,
# but pick a time when you're not mid-test.
set -Eeuo pipefail

APP_CURRENT=/var/www/loomi-studio/current
SECRET_ENV=/root/.meta-pacer-sync.env

cd "$APP_CURRENT"

if [ ! -f "$SECRET_ENV" ]; then
  echo "ERROR: $SECRET_ENV not found — create it with SOURCE_DATABASE_URL (prod)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source "$APP_CURRENT/.env.local"   # provides DATABASE_URL (staging, local)
# shellcheck disable=SC1090
source "$SECRET_ENV"               # provides SOURCE_DATABASE_URL (prod)
set +a

export TARGET_DATABASE_URL="$DATABASE_URL"

echo "=== $(date -u +%FT%TZ) meta-pacer sync starting ==="
npx tsx scripts/sync-meta-pacer-from-prod.ts --apply
echo "=== $(date -u +%FT%TZ) meta-pacer sync finished ==="
