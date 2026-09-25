# PR checks

[`.github/workflows/pr-checks.yml`](../.github/workflows/pr-checks.yml) runs
three jobs in parallel on every pull request. Each catches a kind of failure
that has cost real deploys and that `verify` (typecheck and unit tests) can't
see. None is a required check yet; see [Promoting them](#promoting-them).

| Job | Catches | Time |
|---|---|---|
| `repo-rules` | CLAUDE.md rules in the lines the PR adds | seconds |
| `worker-boot` | a worker that crashes on boot | ~3 min |
| `deploy-prepare` | a deploy script that crashes, can't re-run, or loses an index | ~5 min |

---

## `repo-rules`

`scripts/ci/repo-rules.ts` reads the PR's diff and checks **only the lines it
adds**, so existing code is grandfathered and a PR is judged on what it adds.
Errors fail the job; warnings annotate the PR without failing it.

| Rule | Level | What it checks |
|---|---|---|
| `account-wording` | error | "sub-account", "rooftop", "organization" or "a account" in user-facing text |
| `american-spelling` | error | British spellings (colour, cancelled, centre…) in user-facing text |
| `next-public-build-env` | error | a **new** `NEXT_PUBLIC_*` variable missing from the build `env:` of `deploy.yml` or `deploy-staging.yml` |
| `unique-needs-ensure` | warning | a new `@unique` / `@@unique` with no `scripts/ensure-*.ts` in the PR |
| `loomi-knowledge` | warning | new pages or routes, or schema changes, without touching `loomi-knowledge.md` |

**"User-facing text"** means string literals and JSX text in `src/**/*.ts(x)`,
excluding tests. Identifiers, comments and test names aren't checked, and
neither is a lone lowercase token like `'cancelled'`, since that's a stored
status or a key, not prose.

The rules were calibrated against the 40 most recent merged PRs. Checking whole
lines flagged 17 of them, mostly `let cancelled = false` (React's effect-cleanup
idiom). The current version flags 8, and every hit is real UI text, such as
`title="Publish to sub-accounts"` or `'OUT OF LICENCE — do not use…'`.

**Run it locally** before pushing:

```bash
node --experimental-strip-types scripts/ci/repo-rules.ts origin/main
```

**If a rule is wrong on a line,** add `repo-rules-ignore` anywhere on that line
(in a comment is fine). Tests live in `scripts/ci/repo-rules.test.ts` and run
with `npm run test`.

---

## `worker-boot`

`scripts/ci/check-worker-boot.sh` starts the pg-boss worker against a fresh,
seeded database and fails unless it:

1. prints `[worker] ready` (the last line of startup in `src/worker/index.ts`),
2. is still running 30 seconds later, long enough for the every-minute jobs to
   fire once, and
3. exits 0 on SIGTERM, which is what PM2 sends during a deploy.

This complements `src/worker/queue-registration.test.ts`, which checks queue
registration statically. Scheduling a queue that was never created, using a
string literal the static test can't see, passes that test and fails this job
with the production error, `23503 … Queue … not found`.

Locally, against a database that has had `prisma db push`:

```bash
DATABASE_URL=postgresql://… scripts/ci/check-worker-boot.sh
```

---

## `deploy-prepare`

Runs the deploy's own `npm run deploy:prepare` chain twice:

1. **On an empty database,** the way a brand-new environment starts.
2. **Seeded, then again,** the way every later deploy runs: tables exist, and
   every script must be safe to run again.

Then `scripts/ci/check-deploy-indexes.sh` checks that every index or foreign key
an `ensure-*` script creates still exists. It reads the names from the scripts
themselves, so a new ensure script is covered automatically. If it can't find a
script's name, that fails too.

**What it found on day one:**

- **An empty database couldn't be prepared at all.** `drop-retired-ad-types` and
  `drop-organization-model` altered tables that didn't exist yet. Both now use
  `ALTER TABLE IF EXISTS`.
- **`AdLaunch_live_offer_key` never survived a deploy.** This partial unique
  index stops a retried ad launch from spending money twice. Its script ran
  before `prisma db push`, and push drops any index the schema can't describe.
  It now runs after the push, like `ensure-adrun-inflight-unique`.

This job doesn't predict timing. Local and CI Postgres run about 30x faster than
the managed production database (see CLAUDE.md).

---

## Promoting them

Branch protection requires only `verify`. To make one of these block merges,
add its job name (`repo-rules`, `worker-boot`, `deploy-prepare`) to the rule for
`main` and `staging` once it has a few weeks of green runs.
