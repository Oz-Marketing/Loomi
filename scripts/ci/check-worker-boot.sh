#!/usr/bin/env bash
# Boots the pg-boss worker against DATABASE_URL and fails unless it comes up,
# stays up, and shuts down cleanly.
#
# Why: one queue that was never createQueue'd makes boss.schedule() throw 23503,
# the process exits, and PM2 crash-loops the whole worker — campaign sends, flow
# ticks and the ad-gen chain all silently dead while the web app looks healthy.
# That has happened three times (CLAUDE.md, "The worker").
# src/worker/queue-registration.test.ts catches that one shape statically; this
# catches anything else that only fails at runtime.
#
# Needs a database that has had `prisma db push`. Run from the repo root:
#   DATABASE_URL=postgresql://... scripts/ci/check-worker-boot.sh
set -uo pipefail

READY_TIMEOUT=${READY_TIMEOUT:-120}   # seconds to reach "[worker] ready" (tsx cold start)
STAY_UP=${STAY_UP:-30}                # seconds it must then keep running
LOG=${LOG:-worker-boot.log}

: > "$LOG"
node --import tsx src/worker/index.ts > "$LOG" 2>&1 &
pid=$!

fail() {
  echo "::error::Worker boot check failed: $1"
  echo "----- worker log -----"
  cat "$LOG"
  kill "$pid" 2>/dev/null
  exit 1
}

alive() { kill -0 "$pid" 2>/dev/null; }

# 1. Comes up.
for ((i = 0; i < READY_TIMEOUT; i++)); do
  grep -q '^\[worker\] ready$' "$LOG" && break
  alive || fail "the worker exited before it was ready"
  sleep 1
done
grep -q '^\[worker\] ready$' "$LOG" || fail "no '[worker] ready' after ${READY_TIMEOUT}s"
echo "Worker ready after ~${i}s."

# 2. Stays up. The every-minute and every-5-minute schedules get their first
# tick inside this window, so a job that crashes the process on run shows here.
for ((i = 0; i < STAY_UP; i++)); do
  alive || fail "the worker exited ${i}s after becoming ready"
  sleep 1
done
echo "Worker still running ${STAY_UP}s later."

# 3. Shuts down cleanly on SIGTERM (what PM2 sends on a deploy).
kill -TERM "$pid"
for ((i = 0; i < 20; i++)); do
  alive || break
  sleep 1
done
alive && fail "the worker didn't exit within 20s of SIGTERM"
wait "$pid"
code=$?
[ "$code" -eq 0 ] || fail "the worker exited with code $code on SIGTERM, expected 0"

echo "Worker booted, stayed up, and shut down cleanly."
