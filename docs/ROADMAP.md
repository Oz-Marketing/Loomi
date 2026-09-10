# Loomi Roadmap

Living document for planned but unbuilt features. When something ships,
move it out of this file (and into the changelog / CHANGELOG entry).

## In progress

_Nothing currently in active build — track open PRs in GitHub._

## Up next

### Campaigns — every channel from every door
- **Shipped**: the AI Campaign Builder at `/campaign-builder` (plan →
  generate → review; email, SMS, landing pages, forms), the manual
  wizard (email, SMS), and the OEM offer run landing as `Automated`
  campaigns — the client tier's Studio home.
- **Next**: manual gets landing pages, forms, flows and ads; the AI
  planner fills the `flows` slot it already has; an on-demand
  "Generate from OEM offers" on Campaigns that lands in the same
  monthly container the scheduled run uses. Ads from the AI planner are
  deliberately parked — for a vehicle account that IS the offer run.

### Forms analytics
- Build out `/reporting/websites` form-funnel rollup (submission counts,
  conversion by source, top abandonment fields). Studio has no
  per-form analytics today, so the API endpoint is net new.

### Landing pages rollup
- Aggregate per-LP analytics endpoints (`/api/landing-pages/[id]/analytics`)
  into an account-wide view for `/reporting/websites`. Each LP card
  links into its existing per-page detail.

### Ads reporting
- Surface Meta ad performance (spend, impressions, CTR) under
  `/reporting/ads`. Data already powers the studio Ad Planner /
  Ad Pacer tools; reporting just needs read-only visuals.

### Cross-surface date range filter
- `/reporting/engagement` currently uses a hardcoded `DEFAULT_DATE_RANGE`.
  Add a shared filter bar at the top of each reporting page driven by
  the same `DateRangeKey` enum studio already uses.

## Infrastructure / DevOps

### Move the production build off the droplet (build in CI)
- **Problem**: `deploy.yml` runs `npm ci` + `npm run build` (which ends in
  `next build --webpack`) **on the prod droplet** (`143.198.72.108`, 2 GB /
  ~1 vCPU). The Next build pegs the single core — observed ~84% CPU for the
  full ~7–8 min deploy window. Blue/green keeps the old slot serving, but on
  one vCPU the build still competes with live traffic.
- **Fix (Option A)**: build in the GitHub Actions runner (free, ephemeral
  compute) instead. Add `output: 'standalone'` to `next.config`, build +
  `prisma generate` in CI, tar the standalone output, `scp` to the droplet,
  swap the release symlink, `pm2 restart`. The droplet then does **zero**
  compilation, so deploy-time CPU stays flat.
- **Caveats**:
  - Pin `binaryTargets` in `schema.prisma` so the CI-generated Prisma engine
    matches the droplet platform (both x86_64 glibc/Debian, so compatible —
    just make it explicit).
  - Keep the DB migration step (`prisma db push` / ideally `prisma migrate
    deploy`) running **on the droplet via SSH** — it's network-bound, not the
    CPU cost, and needs the prod `DATABASE_URL`.
  - **Test on `staging` first** (`deploy-staging.yml` + `docs/staging-runbook.md`)
    before it touches prod.
- **Cheaper interim mitigations if A is deferred**: wrap the build in
  `nice -n19 ionice -c3` + a `cpulimit`/systemd `CPUQuota` so the live app wins
  the core, or bump the droplet to 2 vCPU.

## Backlog (lower priority)

- Account-aware deep-links from reporting → studio (e.g. clicking a
  flow row jumps into the flow editor with the right account context).
- Forms / Landing Pages individual analytics surfaced under reporting
  (drill-down from the rollup).
- More granular permissions for client users (which areas of reporting
  they can see).
