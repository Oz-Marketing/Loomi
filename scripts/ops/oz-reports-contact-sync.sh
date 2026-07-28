#!/usr/bin/env bash
#
# Oz Reports → Loomi contact sync driver.
#
# Runs ON THE OZ REPORTS HOST (cPanel, 162.214.77.252 — the "CRON Server"
# entry in app/Config/Whitelist.php). It walks the Loomi bridge endpoints in
# app/Controllers/Loomi.php, which pull new/updated sales, service and lead
# records and POST them to Loomi's /api/ingest/* endpoints.
#
# Canonical copy lives in the loomi-app repo at scripts/ops/. Deployed copy
# lives at ~/bin/oz-reports-contact-sync.sh on the Oz Reports host. See
# docs/oz-reports-contact-sync.md for install + crontab.
#
# Usage:
#   oz-reports-contact-sync.sh <job> [extra-query]
#
# Jobs:
#   leads     Hourly. Leads only, 2-day window — the time-sensitive feed.
#   nightly   Daily. Sales + service customers, per-visit/per-deal events,
#             plus a 3-day leads catch-up so leads still land if the hourly
#             job is wedged. Uses the controller's default windows
#             (service 7d / sales 45d).
#   sweep     Weekly. Every endpoint with ?all=1 — full history, fanned out
#             ONE DEALER PER REQUEST (38 rooftops of all-time history in a
#             single request would be killed by the timeout mid-run). This is
#             the only run that repairs edits to OLD records: the incremental
#             windows filter on event date (closedate / contractdate /
#             lead_time), not on a last-modified column, so a phone-number
#             change or opt-out flip on a two-year-old purchase is invisible
#             to them. Ingest is an idempotent merge, so this is safe.
#             Expect hours, not minutes. Pass dealer=KEY to sweep just one.
#
# Extra query (optional 2nd arg) is appended to every request, e.g.
#   oz-reports-contact-sync.sh nightly dry_run=1
#   oz-reports-contact-sync.sh sweep dealer=youngHonda
#
# Exit codes: 0 = clean (or skipped because another run holds the lock),
#             1 = hard failure (transport, HTTP, unparseable response),
#             2 = partial — some per-dealer batches reported errors,
#            64 = bad usage.
#
# Quiet on success by design: everything goes to the log file, and only
# failures print to stderr, so `MAILTO=` in the crontab gives you
# failure-only mail instead of a nightly wall of text.

set -uo pipefail

# ─────────────────────────────────────────────────────────────
# Config — override any of these in ~/.loomi-sync.env
# ─────────────────────────────────────────────────────────────
CONFIG_FILE="${LOOMI_SYNC_CONFIG:-$HOME/.loomi-sync.env}"
# shellcheck source=/dev/null
[ -f "$CONFIG_FILE" ] && . "$CONFIG_FILE"

OZ_BASE="${OZ_BASE:-https://ozreports.com}"
# Space-separated dealer_map.loomi_set values to walk. Find them with:
#   SELECT loomi_set, COUNT(*) FROM dealer_map
#    WHERE loomi_account_key <> '' GROUP BY loomi_set;
SETS="${SETS:-0}"
LEADS_DAYS="${LEADS_DAYS:-2}"
NIGHTLY_LEADS_DAYS="${NIGHTLY_LEADS_DAYS:-3}"
# Deliberately NOT ~/logs — on cPanel that directory holds the domain access
# logs and is under cPanel's own rotation.
LOG_DIR="${LOG_DIR:-$HOME/loomi-sync/logs}"
LOG_RETENTION_DAYS="${LOG_RETENTION_DAYS:-30}"
LOCK_DIR="${LOCK_DIR:-$HOME/.loomi-sync.lock}"
STALE_LOCK_HOURS="${STALE_LOCK_HOURS:-6}"
# Per-request ceiling. Incremental windows are small; 30 min is generous.
CURL_MAX_TIME="${CURL_MAX_TIME:-1800}"
# Sweeps run one dealer at a time (see run_sweep) but a single rooftop's whole
# sales+service history is still tens of thousands of contact-by-contact
# upserts, so give each dealer its own hour.
SWEEP_MAX_TIME="${SWEEP_MAX_TIME:-3600}"
# Leave empty to auto-detect (see detect_php). cron on cPanel runs with a
# minimal PATH that often lacks php even though the host is a PHP host.
PHP_BIN="${PHP_BIN:-}"

JOB="${1:-}"
EXTRA_QUERY="${2:-}"

usage() {
  # Print the header comment block (everything after the shebang, up to the
  # first line of actual code) rather than a hard-coded line range that goes
  # stale the moment someone edits the docs.
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0" >&2
}

# ─────────────────────────────────────────────────────────────
# Plan: which endpoints, with which window, for this job
# ─────────────────────────────────────────────────────────────
case "$JOB" in
  leads)
    PLAN=("pushleads|days=${LEADS_DAYS}")
    ;;
  nightly)
    PLAN=(
      "pushcustomers|"
      "pushcustomersps|"
      "pushevents|"
      "pusheventsps|"
      "pushleads|days=${NIGHTLY_LEADS_DAYS}"
    )
    ;;
  sweep)
    # Endpoint list only — the sweep does NOT use PLAN. It fans out per dealer
    # (run_sweep) because one request covering all 38 mapped rooftops' full
    # history would never finish inside a sane timeout.
    SWEEP_ENDPOINTS="pushcustomers pushcustomersps pushleads pushevents pusheventsps"
    PLAN=()
    CURL_MAX_TIME="$SWEEP_MAX_TIME"
    ;;
  *)
    echo "ERROR: unknown or missing job: '${JOB}'" >&2
    usage
    exit 64
    ;;
esac

mkdir -p "$LOG_DIR" || { echo "ERROR: cannot create log dir $LOG_DIR" >&2; exit 1; }
LOG_FILE="${LOG_DIR}/sync-$(date '+%Y-%m-%d').log"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/loomi-sync.XXXXXX")" || exit 1
BODY="${TMP_DIR}/response.json"
DISCOVER_BODY="${TMP_DIR}/discover.json"
PARSER="${TMP_DIR}/summarize.php"

FAILURES=()
HARD_FAIL=0
PARTIAL=0

log() {
  printf '[%s] [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$JOB" "$*" >> "$LOG_FILE"
}

# Record a problem: log it, and remember it for the stderr summary that
# turns into cron mail.
fail() {
  log "FAIL $*"
  FAILURES+=("$*")
}

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# ─────────────────────────────────────────────────────────────
# Lock — one sync at a time. A weekly sweep can outlive the next hourly
# leads run, and two of these hammering the same MySQL box is how you
# turn a slow night into a stuck one.
#
# mkdir-based rather than flock: portable to whatever util-linux the
# shared host happens to ship.
# ─────────────────────────────────────────────────────────────
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf 'pid=%s job=%s started=%s\n' "$$" "$JOB" "$(date '+%Y-%m-%d %H:%M:%S')" \
      > "${LOCK_DIR}/owner"
    trap 'rm -rf "$LOCK_DIR"; cleanup' EXIT
    return 0
  fi

  # Someone holds it. Stale (crashed run, killed process) or genuinely busy?
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin "+$((STALE_LOCK_HOURS * 60))" 2>/dev/null)" ]; then
    log "WARN breaking stale lock (older than ${STALE_LOCK_HOURS}h): $(cat "${LOCK_DIR}/owner" 2>/dev/null)"
    echo "WARN: broke a stale sync lock older than ${STALE_LOCK_HOURS}h — a previous run died. See ${LOG_FILE}" >&2
    rm -rf "$LOCK_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf 'pid=%s job=%s started=%s\n' "$$" "$JOB" "$(date '+%Y-%m-%d %H:%M:%S')" \
        > "${LOCK_DIR}/owner"
      trap 'rm -rf "$LOCK_DIR"; cleanup' EXIT
      return 0
    fi
  fi

  log "SKIP another sync holds the lock: $(cat "${LOCK_DIR}/owner" 2>/dev/null)"
  return 1
}

# ─────────────────────────────────────────────────────────────
# Locate a PHP CLI.
#
# cron's PATH on shared hosting is typically just /usr/bin:/bin, so `php`
# frequently isn't on it even though the box serves a PHP app. Probing the
# usual cPanel locations beats asking an operator who may have no shell
# access to go find the binary.
#
# PHP_BIN in ~/.loomi-sync.env always wins when it's usable.
# ─────────────────────────────────────────────────────────────
PHP_CANDIDATES="
php
/usr/local/bin/php
/usr/bin/php
/opt/cpanel/ea-php84/root/usr/bin/php
/opt/cpanel/ea-php83/root/usr/bin/php
/opt/cpanel/ea-php82/root/usr/bin/php
/opt/cpanel/ea-php81/root/usr/bin/php
/opt/cpanel/ea-php80/root/usr/bin/php
/usr/local/cpanel/3rdparty/bin/php
"

# ─────────────────────────────────────────────────────────────
# curl capability probe.
#
# --retry-connrefused landed in curl 7.52 (2016); shared hosting often ships
# 7.29 from the CentOS 7 era, where an unknown option makes curl exit 2
# WITHOUT making a request — every endpoint "fails" instantly. So probe for it
# rather than assuming.
#
# `curl --help all` lists every option on 7.65+; on older builds it exits
# non-zero and the plain `--help` fallback lists them instead.
# ─────────────────────────────────────────────────────────────
curl_supports() {
  { curl --help all 2>/dev/null || curl --help 2>/dev/null; } | grep -q -- "$1"
}

# Retry transient DNS/connection/5xx failures. Safe to retry: every push is an
# idempotent upsert on the Loomi side.
CURL_RETRY_ARGS="--retry 2 --retry-delay 30"
if curl_supports '--retry-connrefused'; then
  CURL_RETRY_ARGS="${CURL_RETRY_ARGS} --retry-connrefused"
fi

# Human-readable curl exit codes, so a failure names its own cause instead of
# leaving someone to look up the number.
curl_exit_meaning() {
  case "$1" in
    2)  echo "curl rejected an option (unsupported flag for this curl version)" ;;
    3)  echo "malformed URL — check OZ_BASE" ;;
    6)  echo "could not resolve host — check OZ_BASE and DNS" ;;
    7)  echo "could not connect — is the web server up on this host?" ;;
    22) echo "HTTP error returned by the server" ;;
    28) echo "timed out (exceeded ${CURL_MAX_TIME}s)" ;;
    35) echo "TLS handshake failed" ;;
    60) echo "TLS certificate could not be verified" ;;
    *)  echo "see curl's exit code $1" ;;
  esac
}

detect_php() {
  if [ -n "$PHP_BIN" ] && command -v "$PHP_BIN" >/dev/null 2>&1; then
    printf '%s\n' "$PHP_BIN"
    return 0
  fi
  local candidate
  for candidate in $PHP_CANDIDATES; do
    if command -v "$candidate" >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# ─────────────────────────────────────────────────────────────
# Response summarizer.
#
# The bridge returns HTTP 200 even when individual dealer batches failed —
# per-dealer errors live inside summary.<dealer>.errors[]. So the exit
# status has to come from parsing the body, not from the status line.
#
# Written in PHP because PHP is the one interpreter this host is
# guaranteed to have (it runs the app); jq usually isn't installed.
# ─────────────────────────────────────────────────────────────
write_parser() {
  cat > "$PARSER" <<'PHP'
<?php
$raw = @file_get_contents($argv[1]);
$data = json_decode((string) $raw, true);

if (!is_array($data) || !array_key_exists('summary', $data)) {
    $snippet = trim(substr(preg_replace('/\s+/', ' ', (string) $raw), 0, 300));
    echo "  !! not a Loomi push summary. Body: {$snippet}\n";
    exit(1);
}

if (!empty($data['dry_run'])) {
    echo "  (dry run — nothing was sent to Loomi)\n";
}

$errors = 0;
$tCand = $tCreated = $tUpdated = $tSkipped = 0;

foreach ($data['summary'] as $dealer => $b) {
    $account = (string) ($b['account'] ?? '-');
    $cand    = (int) ($b['candidates'] ?? 0);
    $created = (int) ($b['created'] ?? 0);
    $updated = (int) ($b['updated'] ?? 0);
    $skipped = (int) ($b['skipped'] ?? 0);

    $tCand += $cand; $tCreated += $created; $tUpdated += $updated; $tSkipped += $skipped;

    printf(
        "  %-34s %-20s cand=%-6d created=%-6d updated=%-6d skipped=%-5d\n",
        substr((string) $dealer, 0, 34), substr($account, 0, 20),
        $cand, $created, $updated, $skipped
    );

    foreach ((array) ($b['errors'] ?? []) as $e) {
        $errors++;
        printf("    !! %s: %s\n", $account, substr((string) $e, 0, 300));
    }
}

printf(
    "  TOTAL dealers=%d candidates=%d created=%d updated=%d skipped=%d batch_errors=%d\n",
    count($data['summary']), $tCand, $tCreated, $tUpdated, $tSkipped, $errors
);

exit($errors > 0 ? 2 : 0);
PHP
}

# Last-resort summarizer for a host with no usable PHP CLI. Loses the
# per-dealer table but keeps the two verdicts that matter: is this actually a
# push summary, and did any dealer batch fail? Same exit codes as the PHP
# parser (0 clean / 1 not-a-summary / 2 batch errors).
fallback_summary() {
  local body="$1"

  if ! grep -q '"summary"' "$body"; then
    printf '  !! not a Loomi push summary. Body: %s\n' \
      "$(head -c 300 "$body" | tr -s '[:space:]' ' ')"
    return 1
  fi

  printf '  (no php on this host — raw check only, %s bytes; set PHP_BIN in %s for per-dealer detail)\n' \
    "$(wc -c < "$body" | tr -d ' ')" "$CONFIG_FILE"

  if grep -q '"errors"' "$body"; then
    echo "  !! response contains per-dealer errors:"
    grep -o '"errors":\[[^]]*\]' "$body" | head -20 | sed 's/^/    /'
    return 2
  fi

  return 0
}

# One endpoint × one set.
run_call() {
  local endpoint="$1" query="$2" set="$3"
  local url="${OZ_BASE}/loomi/${endpoint}/${set}"
  local qs="$query"

  if [ -n "$EXTRA_QUERY" ]; then
    qs="${qs:+${qs}&}${EXTRA_QUERY}"
  fi
  [ -n "$qs" ] && url="${url}?${qs}"

  log "→ ${url}"
  local started=$SECONDS http rc

  # shellcheck disable=SC2086 # CURL_RETRY_ARGS is an intentional word list
  http=$(curl -sS \
    --max-time "$CURL_MAX_TIME" \
    $CURL_RETRY_ARGS \
    -o "$BODY" -w '%{http_code}' \
    "$url" 2>>"$LOG_FILE")
  rc=$?

  local elapsed=$((SECONDS - started))

  if [ "$rc" -ne 0 ]; then
    HARD_FAIL=1
    fail "${endpoint}/${set}: curl exited ${rc} after ${elapsed}s — $(curl_exit_meaning "$rc")"
    return
  fi

  if [ "$http" != "200" ]; then
    HARD_FAIL=1
    case "$http" in
      301|302)
        fail "${endpoint}/${set}: HTTP ${http} redirect — this host's IP is almost certainly not in app/Config/Whitelist.php (IpFilter bounces unlisted callers to /)"
        ;;
      401|403)
        fail "${endpoint}/${set}: HTTP ${http} — check the Loomi ingest secret in app/Config/APIKeys.php"
        ;;
      500)
        fail "${endpoint}/${set}: HTTP 500 — Loomi Base URL / Ingest Secret may be unset in app/Config/APIKeys.php"
        ;;
      *)
        fail "${endpoint}/${set}: HTTP ${http} after ${elapsed}s"
        ;;
    esac
    return
  fi

  local prc
  if [ -n "$RESOLVED_PHP" ]; then
    "$RESOLVED_PHP" "$PARSER" "$BODY" >> "$LOG_FILE" 2>&1
    prc=$?
  else
    fallback_summary "$BODY" >> "$LOG_FILE" 2>&1
    prc=$?
  fi
  log "  ${endpoint}/${set} done in ${elapsed}s (parser rc=${prc})"

  case "$prc" in
    0) ;;
    2)
      PARTIAL=1
      fail "${endpoint}/${set}: some dealer batches reported errors — see ${LOG_FILE}"
      ;;
    *)
      HARD_FAIL=1
      fail "${endpoint}/${set}: response was not a push summary — see ${LOG_FILE}"
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────
# Sweep — full history, one dealer per request.
#
# The incremental jobs can safely batch every dealer into one request because
# their windows are days wide. A full sweep cannot: 38 mapped rooftops of
# all-time sales + service is tens of thousands of contact-by-contact upserts
# per dealer, so a single request would be killed mid-run by the timeout —
# every Sunday, having silently done partial work.
#
# So discover the dealers each endpoint is mapped to, then walk them one at a
# time. Bounded work per request, failures attributable to a rooftop, and
# progress visible in the log as it goes.
# ─────────────────────────────────────────────────────────────

# Ask an endpoint which accounts it covers, using a deliberately cheap dry run
# (a 1-day window builds almost no payload, but the response still names every
# mapped dealer — the controller creates each dealer's summary bucket before it
# checks for emptiness). Parsed with grep so this works with no PHP CLI.
discover_dealers() {
  local endpoint="$1" set="$2" url http
  url="${OZ_BASE}/loomi/${endpoint}/${set}?dry_run=1&days=1"

  # shellcheck disable=SC2086 # intentional word list
  http=$(curl -sS \
    --max-time 300 $CURL_RETRY_ARGS \
    -o "$DISCOVER_BODY" -w '%{http_code}' \
    "$url" 2>>"$LOG_FILE")

  [ "$http" != "200" ] && return 1
  grep -o '"account":"[^"]*"' "$DISCOVER_BODY" | sed 's/.*:"//; s/"$//' | sort -u
}

run_sweep() {
  local endpoint set keys key count

  for endpoint in $SWEEP_ENDPOINTS; do
    for set in $SETS; do
      # An operator-pinned dealer wins — `sweep dealer=youngHonda` should sweep
      # exactly that rooftop, not rediscover all of them.
      if printf '%s' "$EXTRA_QUERY" | grep -q 'dealer='; then
        run_call "$endpoint" "all=1" "$set"
        continue
      fi

      if ! keys="$(discover_dealers "$endpoint" "$set")" || [ -z "$keys" ]; then
        HARD_FAIL=1
        fail "${endpoint}/${set}: dealer discovery failed — cannot chunk the sweep (check the log for the dry-run response)"
        continue
      fi

      count=$(printf '%s\n' "$keys" | wc -l | tr -d ' ')
      log "${endpoint}/${set}: sweeping ${count} dealer(s), one request each"

      for key in $keys; do
        run_call "$endpoint" "all=1&dealer=${key}" "$set"
      done
    done
  done
}

# Machine-readable last-run marker, so a human (or another check) can see
# when this job last completed without grepping logs.
write_status() {
  local code="$1"
  cat > "${LOG_DIR}/status-${JOB}.json" <<EOF
{
  "job": "${JOB}",
  "finishedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "exitCode": ${code},
  "durationSeconds": ${SECONDS},
  "failures": ${#FAILURES[@]},
  "logFile": "${LOG_FILE}"
}
EOF
}

# ─────────────────────────────────────────────────────────────
# Run
# ─────────────────────────────────────────────────────────────
if ! acquire_lock; then
  # Not an error: the previous run is still working. The Loomi-side health
  # check is what catches a pipeline that is genuinely falling behind.
  exit 0
fi

RESOLVED_PHP="$(detect_php)" || RESOLVED_PHP=""
if [ -n "$RESOLVED_PHP" ]; then
  write_parser
fi

log "=== start job=${JOB} sets='${SETS}' base=${OZ_BASE} extra='${EXTRA_QUERY}' php=${RESOLVED_PHP:-none} curl_retry='${CURL_RETRY_ARGS}'"

if [ -z "$RESOLVED_PHP" ]; then
  log "WARN no PHP CLI found — using the coarse fallback summarizer. Set PHP_BIN in ${CONFIG_FILE} to restore per-dealer detail."
fi

if [ "$JOB" = "sweep" ]; then
  run_sweep
else
  for entry in "${PLAN[@]}"; do
    endpoint="${entry%%|*}"
    query="${entry#*|}"
    for set in $SETS; do
      run_call "$endpoint" "$query" "$set"
    done
  done
fi

if [ "$HARD_FAIL" -ne 0 ]; then
  EXIT_CODE=1
elif [ "$PARTIAL" -ne 0 ]; then
  EXIT_CODE=2
else
  EXIT_CODE=0
fi

log "=== end job=${JOB} exit=${EXIT_CODE} duration=${SECONDS}s failures=${#FAILURES[@]}"
write_status "$EXIT_CODE"

# Prune old logs. Keeps a shared-hosting home directory from growing forever.
find "$LOG_DIR" -maxdepth 1 -name 'sync-*.log' -type f \
  -mtime "+${LOG_RETENTION_DAYS}" -delete 2>/dev/null

# Failure-only output → cron mails you exactly when something needs a human.
if [ "$EXIT_CODE" -ne 0 ]; then
  {
    echo "Oz Reports → Loomi sync '${JOB}' finished with exit ${EXIT_CODE}"
    echo "Log: ${LOG_FILE}"
    echo
    for f in "${FAILURES[@]}"; do echo "  - ${f}"; done
  } >&2
fi

exit "$EXIT_CODE"
