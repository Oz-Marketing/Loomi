#!/usr/bin/env bash
#
# Dump Oz Dealer Tools' billboard inventory as JSON, for import-odt-billboards.ts.
#
# RUN THIS ON THE ODT HOST. `database.default.hostname` is `localhost`, so the
# app database is not reachable from anywhere else.
#
#   cd /path/to/oz-dealer-tools
#   /path/to/loomi-app/scripts/odt-dump-billboards.sh > odt-billboards.json
#
# Credentials are read out of ODT's own .env, so nothing has to be typed on a
# command line (where it would land in shell history) or pasted into a file.
# Point ODT_ENV at it if you run from elsewhere:
#
#   ODT_ENV=/path/to/oz-dealer-tools/.env ./odt-dump-billboards.sh > out.json
#
# ── WHY JSON AND NOT THE USUAL TAB DUMP ─────────────────────────────────────
# `notes` is free-form TEXT. A newline or tab typed into it silently corrupts a
# `mysql -B` export: rows split, columns shift, and the import lands garbage
# without anything failing. JSON_OBJECT escapes those characters, so the file
# either parses or it doesn't — no quiet corruption.
#
# ── WHY LEFT JOIN ───────────────────────────────────────────────────────────
# `organization_id` is nullable. An INNER JOIN would drop orphaned boards in
# SQL, before anyone could see them. They come through instead and the importer
# reports them as skipped, so a board that doesn't make the move is a decision
# rather than an accident.
#
# `status = 'deleted'` rows are excluded: Loomi deletes rows instead of
# tombstoning them, so that state has no equivalent to import into.
set -euo pipefail

ENV_FILE="${ODT_ENV:-.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Can't find ODT's .env at '$ENV_FILE'. Run from the oz-dealer-tools root, or set ODT_ENV." >&2
  exit 1
fi

# Read the three settings out of .env without sourcing it — the file is CI4
# config, not shell, and sourcing it would execute whatever it contains.
odt_env() {
  sed -n "s/^[[:space:]]*database\.default\.$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -1
}
DB_NAME="$(odt_env database)"
DB_USER="$(odt_env username)"
DB_PASS="$(odt_env password)"

if [[ -z "$DB_NAME" || -z "$DB_USER" ]]; then
  echo "Couldn't read database.default.database / .username from '$ENV_FILE'." >&2
  exit 1
fi

echo "Dumping '$DB_NAME' as user '$DB_USER'…" >&2

# MYSQL_PWD keeps the password off the process list, where -p would expose it
# to every other user on the box.
MYSQL_PWD="$DB_PASS" mysql -N -B --raw -u "$DB_USER" "$DB_NAME" -e "
  SELECT JSON_OBJECT('boards', COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
    'id',                b.id,
    'organization_id',   b.organization_id,
    'org_name',          o.name,
    'is_group_level',    b.is_group_level,
    'provider_name',     b.provider_name,
    'billboard_number',  b.billboard_number,
    'artwork_url',       b.artwork_url,
    'facing_direction',  b.facing_direction,
    'avg_daily_traffic', b.avg_daily_traffic,
    'price_per_period',  b.price_per_period,
    'num_periods',       b.num_periods,
    'period_type',       b.period_type,
    'expiration_date',   b.expiration_date,
    'renewed_at',        b.renewed_at,
    'latitude',          b.latitude,
    'longitude',         b.longitude,
    'status',            b.status,
    'notes',             b.notes
  )), JSON_ARRAY()))
  FROM billboards b
  LEFT JOIN organizations o ON o.id = b.organization_id
  WHERE b.status <> 'deleted';
"
