#!/usr/bin/env bash
#
# preview.sh — spin up a local preview of ANY branch without disturbing your
# working checkout. It creates a throwaway git worktree next to the repo, reuses
# your installed deps + env, generates a matching Prisma client, and runs the
# Next dev server (webpack — Turbopack chokes on the symlinked node_modules).
#
#   bash scripts/preview.sh <branch>     # e.g. feat/reporting-ga4
#   bash scripts/preview.sh --clean      # remove all preview worktrees
#
# Then open the printed URL. The reporting surface lives at reporting.localhost.
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREV="$(cd "$REPO/.." && pwd)/.loomi-previews"

# ── cleanup ──
if [[ "${1:-}" == "--clean" || "${1:-}" == "clean" ]]; then
  if [ -d "$PREV" ]; then
    for wt in "$PREV"/*/; do
      [ -d "$wt" ] && git -C "$REPO" worktree remove --force "$wt" 2>/dev/null || true
    done
    rm -rf "$PREV"
  fi
  git -C "$REPO" worktree prune
  echo "✓ preview worktrees removed"
  exit 0
fi

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: bash scripts/preview.sh <branch>   (or --clean)" >&2
  exit 1
fi

# Prefer the branch as it exists on origin so previews track GitHub.
git -C "$REPO" fetch origin --quiet 2>/dev/null || true
REF="$BRANCH"
if git -C "$REPO" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  REF="origin/$BRANCH"
fi
if ! git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
  echo "✗ branch not found locally or on origin: $BRANCH" >&2
  exit 1
fi

SAFE="${BRANCH//[^a-zA-Z0-9._-]/-}"
WT="$PREV/$SAFE"
mkdir -p "$PREV"

if [ -d "$WT" ]; then
  # Refresh an existing preview worktree to the latest commit on that ref.
  git -C "$WT" reset --hard "$REF" --quiet
else
  git -C "$REPO" worktree add --force --detach "$WT" "$REF" >/dev/null
fi

# Reuse the main checkout's installed deps + env. Generate a Prisma client that
# matches THIS branch's schema (don't symlink the client — branches can differ).
ln -sfn "$REPO/node_modules" "$WT/node_modules"
[ -f "$REPO/.env" ] && ln -sf "$REPO/.env" "$WT/.env"
[ -f "$REPO/.env.local" ] && ln -sf "$REPO/.env.local" "$WT/.env.local"
echo "▸ generating Prisma client for $BRANCH…"
( cd "$WT" && npx prisma generate >/dev/null 2>&1 || true )

# First free port from 3010.
PORT=3010
while lsof -ti "tcp:$PORT" >/dev/null 2>&1; do PORT=$((PORT + 1)); done

echo ""
echo "  ▸ previewing:  $BRANCH"
echo "  ▸ studio:      http://localhost:$PORT"
echo "  ▸ reporting:   http://reporting.localhost:$PORT     (e.g. /websites)"
echo "  ▸ stop:        Ctrl-C        cleanup: bash scripts/preview.sh --clean"
echo ""

cd "$WT" && exec npx next dev --webpack -p "$PORT"
