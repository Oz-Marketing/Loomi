# Working in this repo

How to work on Loomi — gates, conventions, and the traps that have cost real
deploys. Rules only; the reasoning lives in `docs/`.

Three files, three jobs — don't duplicate between them:

| File | Answers |
| --- | --- |
| `loomi-knowledge.md` | **What the product is** — surfaces, features, data model. Source of truth for the in-app AI. |
| `docs/*.md` | **How one module works** — specs, runbooks, architecture decisions. |
| `CLAUDE.md` (this) | **How to work here** — gates, authorization, conventions, traps. |

`loomi-knowledge.md` carries a maintenance obligation: any change that adds,
removes, or meaningfully alters a feature, surface, integration, or data model
updates the relevant section **in the same change**.

---

## Environment

- Repo lives at `~/Oz Marketing/Projects/Loomi/Code/loomi-app`. **Never put code
  under `~/Documents` or `~/Desktop`** — both are iCloud-synced, which once
  tracked ~438k files, made `next dev` cold-compiles take 396s, and corrupted
  `.git` via an ENOSPC-truncated `git gc`.
- Run `npx prisma generate` after any `npm install`, or the app 500s with
  `Cannot find module '.prisma/client/default'`.
- **Restart `next dev` after every `prisma generate`.** The dev server holds the
  generated client in memory and does NOT pick up a new one on hot reload, so a
  freshly added field throws `Unknown field 'x' for select statement` at runtime
  while `npm run verify` passes — tsc reads the regenerated types off disk. A
  green verify is not evidence the running app agrees with the schema.
- Dev login: `connor@ozmktg.com` / `admin123`. Surfaces are host-routed
  (`src/proxy.ts`) — `app.localhost:3000`, `marketing.localhost:3000`, etc.
- **Many worktrees live under `.claude/worktrees/` and all point `npm run dev` at
  port 3000.** Whoever starts first owns it, so `localhost:3000` often serves a
  *different branch than the one you are editing*. Before diagnosing any "the UI
  doesn't show X", confirm whose server it is:
  `lsof -a -p $(pgrep -f "next-server" | head -1) -d cwd -Fn`. Fix by setting
  `"autoPort": true` in your worktree's gitignored `.claude/launch.json`.
- Worktrees need **real** `node_modules` — a symlinked one makes Turbopack panic
  with "Symlink node_modules is invalid".

## Gates before you push

`npm run verify` and `npm run test` are the gates. **There is no lint script.**

- **`npm run verify`, never bare `npx tsc --noEmit`.** Verify runs tsc twice and
  the second pass adds `--noUnusedLocals --noUnusedParameters`. An unused import
  passes locally and fails CI (cost a red build on PR #295).
- **`rm -f tsconfig.tsbuildinfo` before the verify run you intend to trust.**
  `incremental: true` lets a stale cache report success while skipping a file it
  should have re-checked — a new test typechecked clean locally three times and
  still failed CI.
- After rebasing onto staging, also `npx prisma generate` (schema drift causes
  phantom errors in unrelated files) and `rm -rf .next` (stale route types
  reference files other branches deleted).
- Verify only proves types. It does not exercise the UI, the worker, or a deploy.

## Branches, deploys, and authorization

- Push `staging` → deploys `staging.loomilm.com`. Push `main` → deploys
  production (`studio.loomilm.com`). Both ~3 min, blue/green on DigitalOcean.
- `typecheck.yml` is a **reusable** workflow (`pull_request` + `workflow_call`,
  deliberately no `push`). Both deploy workflows call it as a `verify` job and
  declare `deploy: needs: [build, verify]`, so a red typecheck stops the deploy.
  **Never remove its `pull_request` trigger** — branch protection on main *and*
  staging requires a check named exactly `verify`, and dropping the trigger
  blocks every PR forever.
- An admin direct push bypasses branch protection and **skips the required
  `verify` check** — nothing gates it but your own local run.
- **Never push `staging` or `main` unless Connor asks for that specific push.**
  A staging push auto-deploys and runs `prisma db push` against a shared
  environment. Authorization is per-push and does not extend forward: "keep going
  with X" is a build instruction and never carries a push with it. Commit, report
  that it's ready, end the turn with the branch unpushed.
- When he *does* ask to merge to main, go straight to
  `gh pr merge <n> --merge --admin` — he is the reviewer and can't self-approve,
  so the required review is pure friction. This covers the review override only;
  still wait for CI, and for the staging deploy when the change routes through it.
- Staging is **shared** — merge into it, never force-push.

## Database and deploy-time scripts

Schema ships via `prisma db push`, not migrations. `deploy:prepare` chains
~20 `ensure-*` / `backfill-*` / `seed-*` scripts, and **the deploy's SSH step
times out at 15 minutes.**

- **Never put a per-row loop in a deploy-time backfill.** Prod is ~265k contacts
  across 33 accounts; a `prisma.x.update()` loop got through 14 accounts in ~11
  minutes before being killed. Rewritten as one set-based `UPDATE … FROM (SELECT
  … GROUP BY)` per account it finished all 33 in 5m24s. `$executeRaw` with
  `Prisma.sql` composes fine.
- **Local timings are not a forecast** — local Postgres predicted ~11s for work
  that took 5m24s on the managed DO database (~30x). Staging has ~13 contacts.
- **No global "already populated?" skip guard on a backfill.** A partial run
  leaves it looking satisfied and the remaining accounts are skipped forever.
  Guard per-account, or drop the guard and let an idempotent recompute self-heal.
- `db push` **refuses to add a unique constraint**, and the deploy has no
  `--accept-data-loss` (correctly — it isn't scoped and would silently drop
  columns). The pattern is an idempotent `scripts/ensure-*.ts` that adds any
  missing column *then* creates the index, wired into `deploy:prepare` and
  `db:sync` before the push. See `scripts/ensure-adcreative-offer-unique.ts`.
- A deploy that fails at build/prepare is **safe** — the release symlink never
  flips, so prod keeps serving the previous release.
- Droplet env is `/var/www/loomi-studio/shared/.env.local`. Edit there, not the
  release copy (deploys overwrite it), then
  `pm2 restart <blue|green> --update-env`.
- **Take `DATABASE_URL` from the running process, never from a file** — staging
  had a six-month-stale root `.env` pointing at a different managed database,
  sitting exactly where you'd look.
- **`NEXT_PUBLIC_*` never goes on the droplet.** Those are inlined by
  `next build`, which runs on the GitHub runner; the droplet only receives the
  finished `.next` tarball. A build-time flag added to `shared/.env.local` has no
  effect and no visible error — the feature just stays off. Add it to the build
  step's `env:` instead.
- Droplet CLI scripts that render need `NODE_ENV=production`, or `launchBrowser()`
  reaches for puppeteer's Chrome and dies on missing GTK libs.

## The worker

`src/worker/index.ts` registers every queue in a straight line, and
`boss.schedule()` has a foreign key onto `pgboss.queue`. **One queue that was
never `createQueue`'d throws 23503, exits the process, and PM2 crash-loops the
entire worker** — campaign sends, flow ticks, trigger polling, the whole ad-gen
chain, all silently dead while the web process stays healthy.

This happened **three times with the same queue**. `src/worker/queue-registration.test.ts`
now asserts every queue that is `work`ed or `schedule`d is also `createQueue`'d.

- When a flow enrollment, scheduled campaign, or ad-gen job "does nothing",
  **check the worker is alive before reading engine code**: `pm2 jlist` and
  compare `restart_time` against uptime. High restarts + seconds of uptime is
  this bug. `npm run worker:start` reproduces a boot crash locally in seconds.
- A green prod worker does **not** mean the code is correct — the `pgboss.queue`
  row may already exist from an earlier deploy. Prod survives what staging dies on.

## UI conventions

- **American English only** — color, behavior, organization, gray, canceled,
  center. Pre-existing British spellings in the repo are grandfathered; never add
  new ones.
- **Say "account", and "group" for an account that owns others.** Never
  "sub-account", "rooftop", or "organization" in user-facing prose. This reverses
  an earlier "sub-account" directive — don't reinstate it.
  - Rename **prose only** — JSX text, placeholders, labels, toasts, empty states.
    Identifiers and routes stay (`subaccount`, `/subaccount/`, `SubAccountDetailPage`).
  - **The article trap:** "a sub-account" → "**an** account". A naive
    find-and-replace produces "a account" across the app (42 occurrences).
  - **Never rename `'@type': 'Organization'`** in `app/marketing/page.tsx` —
    that's schema.org JSON-LD, not copy.
- **Everything that changes on screen animates.** Reach for the primitives in
  `src/app/globals.css` rather than inventing per-component transitions:
  `<Collapse>` (`src/components/ui/collapse.tsx`) for height, `animate-modal-in`,
  `animate-dropdown-in`, `animate-slide-in-right`, `animate-fade-in-up` +
  `animate-stagger-N`. Chevrons rotate; never swap glyphs. Anything new must also
  be added to the `prefers-reduced-motion` block. See `docs/ui-motion.md`.
- **Help text goes in a Tooltip by the label**, not a muted paragraph below the
  control. Exception: short self-explanatory segmented-toggle labels need none.
- **Padding/margin uses `SpacingBox`** (`src/lib/forms/editor/PropertyControls.tsx`)
  — 4 inputs with labels below and a link/chain toggle. Never per-side sliders or
  stacked rows. Import the existing component; don't duplicate it.
- **Agency/platform settings render only in the cog's modal.** Drill-ins stay
  inside it (`z-[260]`; the modal is `z-[200]`) — a `router.push` lands the record
  in the app shell *behind* the overlay. There is no cross-account browsing view;
  sharing is a scope (`accountKey: null`) and the case it can't express is a copy.
  Don't rebuild a merged org library. See `docs/settings-architecture.md`.

## Permissions and scope

- Use `userRole` for "may this user do this". Use `isGroup` / `isRollup` /
  `scopedAccountKeys` for "does this scope span several accounts".
- **Never add a new `useAccount().isAdmin` gate.** Agency scope is retired, so
  `isAdmin` is just the beat between authenticated and account-resolved, and
  `resolveDefaultAccountKey` closes that window — it's effectively always false.
  Anything gated on it is dead UI.
- **Clients get Reporting, plus review of their own OEM offers.** Projects and
  Agency are internal. Studio is entered for exactly ONE role — `studio.client`,
  carrying `studio.access` + `studio.adgen.view` + `studio.adgen.edit` +
  `studio.campaigns.view` and nothing else, so a dealer can take the
  manufacturer's offer as generated or adjust it. It withholds `generate` (runs
  come from the nightly job), `launch` (that commits real ad spend), and
  `create` — dealers are handed pre-built OEM offers, and an ad started from
  scratch has no manufacturer program behind it and no co-op provenance.
  Changed 2026-09-03; it was Reporting-only before.
  - **A client's Studio home is CAMPAIGNS, not the Ad Generator** (2026-09-04).
    A run's ads and its offer email are one deliverable, and the campaign is the
    only place they sit together — the Ad Generator list shows half of it. The
    list page redirects the client tier to `/campaign-builder`; they still reach
    the ad EDITOR by opening a design from the campaign, which is what
    `studio.adgen.edit` is for. That link must be the BARE `/ad-generator/<id>`
    — there is no `/subaccount/[slug]/ad-generator` route, and the account href
    builder prefixes every path, so a prefixed link 404s for every client (it
    did, until 2026-09-10; `assetEditorPath` has the test).
  - **`automationOnly` is an entitlement, not a filter.** `listCampaigns` turns
    it into `where.source = 'automation'` and the `[id]` route 404s a
    non-automation campaign for the client tier. Never move that bound into a
    list component — `studio.campaigns.view` unfiltered would hand a dealer
    every manual blast, flow and landing page on their account.
  - **`studio.adgen.create` is deliberately separate from `.edit`.** Don't
    collapse them: a client must be able to edit a generated ad and must not be
    able to originate one.
  - The bound is **role-level, not sector-level** — `CLIENT_ALLOWED_SECTOR_ROLES`,
    not `CLIENT_ALLOWED_SECTORS`. `reporting.analyst`/`admin` confer budget and
    executive, and every other Studio role confers campaigns, templates and
    assets. Never add a second Studio role to that list.
- **Never widen by accident.** `registry.test.ts` asserts each legacy role gains
  exactly the permissions in its `ALLOWED_GAIN` entry — `[]` for everyone but
  `client`. A widening has to be typed out by someone who meant it; one extra
  permission still fails. Run and extend it before any role edit. See
  `docs/permissions-architecture.md`.
- **Studio permission enforcement is OFF** (`PERMISSIONS_ENFORCE_STUDIO`), so for
  most Studio routes `requirePermission` falls back to the coarse legacy buckets
  and the registry role is ignored. `adGeneratorAllowed()` and
  `campaignAccessFor()` deliberately ask the registry directly, because "a client
  who may see their offers and nothing else" has no legacy expression —
  `management` locks them out, `authenticated` lets in everyone. Flipping the
  flag makes those gates redundant, never wrong.
- Sensitive capabilities (`blast.send`, `contacts.pii.export`,
  `finance.spend.view`, `finance.markup.manage`,
  `integrations.credentials.manage`, `user.impersonate`) are explicit-grant only
  and can never be conferred by a sector role.
- SSO never **creates** a user — accounts stay invite-provisioned. Roles and
  account grants always come from our tables, never the identity provider.

## Reporting is client-facing

Everything under `/reporting` and `/api/reporting/*` is seen by **clients** —
`requireReportingAccess` admits the client tier.

- Never return `cost`, `revenue`, `byLineType`, `knownRevenue`, `uncostedAmount`,
  `defaultMarkup`, or an agreement's per-fee breakdown from a reporting route.
- **`spendTarget` is the trap.** It is `amount × markupSnapshot`; beside `amount`
  it lets anyone divide one by the other and read the markup. Treat it as margin.
- **Project explicitly rather than deleting keys** — `src/lib/reporting/budget-view.ts`
  builds a new object, so a field added upstream stays out of Reporting until
  someone opts it in. Its test walks the object graph and fails on a banned key
  *or* a margin value under a renamed key. Copy that pattern for any new
  client-facing projection.
- One code path. Never strip fields conditionally by role.

## "Built" does not mean "on"

A recurring shape in this codebase: substantial, tested machinery sitting behind
a default-off flag. **Before calling any feature done, check its enablement
path** — grep for `@default(false)`, a `*_ENABLED` env flag, or a shadow-mode
guard.

- **Budgets:** `docs/budget-module.md` marks phases through C "Built", and the
  ledger maths genuinely are. But `syncPeriodBudgetFromLines` returns
  `not_managed` unless `managedByBudget` / `googleManagedByBudget` are on, and
  both are `@default(false)`. **Every planner and pacer number is still typed by
  hand.** Never describe budgets as done or wired in.
- **Ad Generator automation:** all four phases shipped, running in shadow mode.
- **Help desk → monday:** built, but `MONDAY_API_TOKEN` is unset everywhere, so
  submissions take the email fallback. A staging test producing an email instead
  of a ticket is not a bug.
- A phase table records **what was written, not what is running.**

## Assorted traps

- **Maizzle is gone.** Email renders via react-email (`renderEmailTemplate()` in
  `src/lib/email/render.ts`); HTML-only templates pass through uncompiled. Legacy
  `<x-base>`/`<x-core>` markup is unsupported and renders raw. The remaining
  `maizzle` mentions in `src/` are comments recording the removal.
- **Don't re-run the pacer alerts cron after ~18:00 MDT.** Dedupe keys are
  `${ad.id}:${type}:${todayISO()}` with a 20h window, and prod runs on UTC — a
  late re-run is already on the next UTC date and silently eats the following
  morning's scheduled alerts. If a run is missed, let the next schedule take it.
  (`CRM Contact Sync Health` is read-only and safe to re-run any time.)
- **Mailgun: never mix DKIM key pairs across domains.** `studio.loomilm.com` and
  `loomilm.com` each have their own pair; a domain's two `pdk1`/`pdk2` selectors
  always come from the same one. Cloudflare truncates the two rows identically.
  DKIM CNAMEs must be **grey cloud / DNS-only** — proxying silently breaks them.
- **`SMTP_FROM` is not transactional-only** — it's also the default from-address
  for bulk campaign blasts, form notifications, and CRM lead mail. Don't repoint
  it to send invites from a different address; add separate
  `SMTP_TRANSACTIONAL_*` vars instead.
- **monday sanitizes long-text as HTML on the way in** — `Name <email>` arrives as
  `Name `, silently. Any column carrying user prose needs the `<`/`>` → `‹`/`›`
  re-glyphing that `src/lib/support/help-desk.ts` does. And never
  `create_labels_if_missing` for Location — account names and board labels were
  authored separately, so it litters the board with near-duplicates.
- **Don't reintroduce a seed that writes changelog rows.** Old entries kept
  returning because `seed-changelog-entries.ts` ran in both `build` and
  `deploy:prepare`, upserting fixed ids every deploy.
- `NotificationPreference` has independent `enabled` (bell) and `emailEnabled`
  (inbox). Use `resolveChannels` / `loadChannelMap` from
  `src/lib/notifications/types.ts` — the old `isNotificationEnabled` ignores the
  email opt-out.
- **Ad Generator seed data is not auto-deployed.** OEM offer rules and disclaimer
  templates are applied **per-environment** (`scripts/seed-oem-rules-odt.ts` or
  the admin UI at `/ad-generator/oem-rules`). Code ships the form *fields*; the
  rule row makes them *required*.

## Internal presentations

Loomi Task Force decks and any internal Loomi presentation are for **agency
staff, not engineers**. No framework names, no "API endpoints"/"schema"/
"migrations"/"CI"/"droplet", no commit or test counts. Say what a person
experiences. **Don't put code-level problems on screen** — fix them, or reframe
as an investment decision. The hardening backlog is dev-facing only.
