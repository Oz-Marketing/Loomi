#!/usr/bin/env bash
# After `deploy:prepare`, asserts that every index (or constraint) an ensure-*
# script creates actually exists in DATABASE_URL.
#
# Why: `prisma db push` drops any index the Prisma schema can't describe. A
# partial unique index created BEFORE the push is therefore gone by the time the
# app starts — the script reports success and the guarantee silently isn't
# there. That happened to AdLaunch_live_offer_key (the guard against launching
# the same ad twice) until its script moved after the push.
#
# The names come from the scripts themselves, so a new ensure script is covered
# without editing this file. If a name can't be found, that fails too, rather
# than letting the script go unchecked.
set -euo pipefail

steps=$(node -p "require('./package.json').scripts['deploy:prepare']")
scripts=$(grep -oE 'scripts/ensure-[a-z0-9-]+\.ts' <<<"$steps" | sort -u)
db_url="${DATABASE_URL%%\?*}" # psql doesn't understand Prisma's ?schema= suffix

missing=0
checked=0
# The name a script creates: `const INDEX… = '…'` / `indexname = '…'` for an
# index, `const FK = '…'` for a foreign key. `|| true`: no match is handled below.
names_in() {
  { grep -oE "(const (INDEX[A-Z_]*|FK) = |indexname = )'[A-Za-z0-9_]+'" "$1" || true; } |
    grep -oE "'[A-Za-z0-9_]+'" | tr -d "'" | sort -u
}

for script in $scripts; do
  names=$(names_in "$script")
  if [ -z "$names" ]; then
    echo "::error file=$script::Couldn't find the index or constraint name this script creates. Give it a 'const INDEX = ...' (or 'const FK = ...') so scripts/ci/check-deploy-indexes.sh can verify it survives db push."
    missing=$((missing + 1))
    continue
  fi
  for name in $names; do
    checked=$((checked + 1))
    found=$(psql "$db_url" -Atc "select (select count(*) from pg_indexes where schemaname = 'public' and indexname = '$name') + (select count(*) from pg_constraint where conname = '$name')")
    if [ "$found" -ge 1 ]; then # a UNIQUE constraint also shows as an index
      echo "ok       $name  ($script)"
    else
      echo "::error file=$script::Index $name doesn't exist after deploy:prepare. If it's a partial index, the script must run AFTER 'prisma db push', which drops indexes the schema can't describe."
      missing=$((missing + 1))
    fi
  done
done

echo "Checked $checked indexes and constraints from $(wc -w <<<"$scripts" | tr -d ' ') ensure scripts; $missing problem(s)."
[ "$missing" -eq 0 ]
