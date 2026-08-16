# Permissions & roles architecture

A proposal to replace the single global `User.role` string with a granular,
per-sector model. Written against the code as of the merge of #342.

## Where we are today

Permissions are two fields on `User`:

| Field | Shape | Meaning |
| --- | --- | --- |
| `role` | one string | `developer` \| `super_admin` \| `admin` \| `client` |
| `accountKeys` | JSON array | which sub-accounts you can see |

Everything else is derived from those two. `src/lib/roles.ts` exposes three
buckets — `ELEVATED_ROLES` (developer, super_admin), `MANAGEMENT_ROLES` (+admin),
`ALL_ROLES` — and every guard picks one.

### The problem, measured

There are 242 `requireRole(...)` guards across the API. Their distribution:

| Guard | Count | Share |
| --- | --- | --- |
| `('developer','super_admin','admin')` | 118 | 49% |
| `...MANAGEMENT_ROLES` (identical set) | 89 | 37% |
| `('developer','super_admin','admin','client')` | 15 | 6% |
| `...ELEVATED_ROLES` | 12 | 5% |
| `('developer','super_admin')` | 5 | 2% |
| `('developer')` | 3 | 1% |

**207 of 242 guards (86%) are the same check: "are you internal staff?"**

So in practice Loomi has *two* permission levels — staff and client — spread
across four sectors, ~19 Studio surfaces, ~19 Reporting reports, and 8 Projects
surfaces. A designer who should only touch Ad Generator templates holds the same
grant as the account manager who can send a blast to 265k contacts.

The only sector-level distinction that exists anywhere is one line in
`src/app/app/layout.tsx`: Projects is staff-only. Reporting has none —
`requireReportingAccess()` checks authentication and account scope and nothing
else, so any user with an account assignment can query every report including
Budget and Executive.

### Three specific defects worth fixing on the way through

1. **`accountKeys = []` means two opposite things.** For `admin`/`super_admin` it
   means *all accounts*; for `client` it means *none*. Nothing in the column says
   which. It works today only because `authOptions.jwt` repairs it at token-mint
   time (`src/lib/auth.ts:419` swaps the empty array for every account key), so
   the session never carries the ambiguous value. That single repair is load-bearing
   for the whole app: any code reading `User.accountKeys` from the database rather
   than from the session gets the opposite answer. It's a latent trap rather than a
   live bug, and an explicit `scopeMode` retires it.
2. **No sensitive-action tier.** Sending a blast, exporting contact PII, editing
   markup/margin, and rotating integration credentials are all just "staff".
3. **`User.department` and `TeamMembership.role` already model the real
   organization** (Design, Account Management, Development, Leadership,
   Marketing, Sales, Operations; member/lead) and neither one grants anything.

## The model: three independent axes

The mistake in the current design is that one enum answers three different
questions. Split them.

```
   WHO you are            WHERE you can act          WHAT you can do
   ───────────            ─────────────────          ───────────────
   platform tier     ×    account scope         ×    sector roles
   (staff/client)         (which sub-accounts)       (per-sector grants)
```

### Axis 1 — Platform tier (unchanged in spirit, 4 → 3 values)

Stays on `User.role`. This answers only "what kind of principal is this",
never "what may they do".

| Tier | Meaning |
| --- | --- |
| `developer` | Break-glass superuser. Bypasses all checks, every bypass audit-logged. Us, not clients. |
| `staff` | Internal Oz employee. Grants nothing by itself — sector roles do the work. |
| `client` | External dealer user. Grants nothing by itself, and may hold **only** `reporting.*` roles. |

#### Which sectors each tier can reach

Studio, Projects, and Agency are **internal sectors**. Reporting is the only one
clients enter, which makes it the only sector where a permission bug is
externally visible — worth remembering when sequencing the rollout.

| Sector | `staff` | `client` |
| --- | --- | --- |
| Agency | yes | never |
| Studio | yes | never |
| Projects | yes | never |
| Reporting | yes | **only sector** |

This is an invariant, not a default: the assignment layer rejects a `client`
tier paired with a non-Reporting sector, and the assignment UI never offers the
combination. Enforcing it in one function is what stops "client with a stray
Studio grant" from ever becoming a state we have to reason about.

**Sector is not a tight enough bound on its own.** `reporting.analyst` and
`reporting.admin` both confer `reporting.budget.view` and
`reporting.executive.view`, so "clients may hold Reporting roles" would leave a
dealer one dropdown away from internal budget figures. The invariant is
therefore role-level — `canTierHoldRole()`, not just `canTierHoldSector()`:

| Tier | May hold |
| --- | --- |
| `client` | `reporting.client`, `reporting.viewer` — nothing else, ever |
| `staff` | any role in any sector |
| `developer` | everything, by bypass |

The resolver applies the same test, so a row left behind by a demotion confers
nothing even before anyone prunes it. A test enumerates the complete set of
permissions a client can reach (`reporting.access` and `reporting.report.view`),
so any future role edit that widens it fails loudly.

Personal settings — Notifications and Appearance — are not a sector and stay
available to every tier, matching Tier 3 of `settings-architecture.md`.

`super_admin` and `admin` disappear as tiers — they become *sector roles*
(`agency.owner`, `agency.admin`), which is what they were actually being used
for.

### Axis 2 — Account scope (fix the empty-means-two-things bug)

```prisma
scopeMode   String  @default("listed")  // all | listed
accountKeys String  @default("[]")
```

`all` means every account, explicitly. `listed` means exactly the keys named,
and an empty list means *nothing* — which is then a real, reportable state
instead of an accident. Org-level inheritance keeps working as it does now: a
key pointing at an organization expands to its sub-accounts.

### Axis 3 — Sector roles

A user holds **at most one role per sector**, and only in sectors they've been
granted. No role in a sector = that sector isn't in their nav and its API
returns 403.

#### Agency — platform configuration (the cog modal)

| Role | Adds |
| --- | --- |
| `owner` | Everything, including industries, default markup, alert rules, co-op guideline library, field blueprints |
| `admin` | Sub-accounts, users, teams, knowledge base. **Not** platform config. |
| `user_manager` | Invite / deactivate / reassign users only |

Today's `isElevated` gate on Industries/Markup/Alerts becomes `agency.owner`;
today's `hasAdminAccess && isAdmin` becomes `agency.admin`.

#### Studio — marketing production

| Role | Adds |
| --- | --- |
| `lead` | All of Studio, including template publish and co-op approval |
| `producer` | Create/edit campaigns, emails, flows, forms, landing pages, audiences |
| `designer` | Ad Generator, Templates, Reusable Blocks, Assets — nothing outbound |
| `viewer` | Read + comment |

The `designer` role is the one that pays for this whole exercise: it's the grant
your design team should have had all along.

#### Reporting

| Role | Adds |
| --- | --- |
| `admin` | Every report, including Budget and Executive; can configure report availability per account |
| `analyst` | Every report; no configuration |
| `client` | The client-facing report set for their accounts. Never Budget, never cost/markup figures. |
| `viewer` | A named subset of reports |

Reporting is also the one sector that needs **per-report** granularity rather
than per-sector, because which reports a dealer sees is a commercial decision
that varies per account. Model that as a per-account allowlist of report keys
attached to the `client`/`viewer` role, not as more roles.

#### Projects

| Role | Adds |
| --- | --- |
| `admin` | All initiatives, tasks, teams, budget; assign anyone |
| `lead` | Initiatives and tasks for teams they lead; assign within team |
| `member` | Tasks assigned to them; comment, log time |
| `requester` | File requests; see only their own |

`lead` should read from the `TeamMembership.role = 'lead'` rows that already
exist rather than duplicating that fact.

### Sensitive capabilities — granted explicitly, never inherited

These sit outside sector roles. Holding `studio.lead` does not confer them; they
are assigned per user and every use is audit-logged.

| Capability | Guards |
| --- | --- |
| `blast.send` | Irreversible outbound email/SMS to real contacts |
| `contacts.pii.export` | Bulk contact export |
| `finance.spend.view` | Cost, markup, margin figures |
| `finance.markup.manage` | Editing markup and rate cards |
| `integrations.credentials.manage` | Meta/Google/Mailgun token rotation |
| `user.impersonate` | Viewing as another user |

## Permission keys

`<sector>.<resource>.<action>` — flat strings, defined once in a registry.

```
agency.users.manage          studio.campaigns.publish
agency.subaccounts.create    studio.adgen.template.publish
agency.platform.configure    reporting.budget.view
projects.initiative.create   reporting.report.view:<reportKey>
```

Roles are **static code**, not database rows — a table in
`src/lib/permissions/registry.ts` mapping each sector role to its permission
set, in exactly the idiom `settings-registry.ts` already uses. Only *assignments*
are persisted. A UI for authoring custom roles is a later phase, and probably
never needed.

### Resolution

```
effective(user, accountKey) =
    ( sectorRoleGrants(user)          // union of their per-sector roles
    ∪ explicitAllows(user)            // sensitive capabilities
    ) − explicitDenies(user)          // denies always win
    ∩ scopeAllows(user, accountKey)
```

`developer` short-circuits to allow, with an audit row.

## Data model

`User.role` keeps its column (values change). Two new tables:

```prisma
model UserSectorRole {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  sector String // agency | studio | reporting | projects
  role   String // owner | admin | lead | producer | designer | member | viewer | ...

  @@unique([userId, sector])
  @@index([userId])
}

model UserCapabilityGrant {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  capability String   // blast.send, finance.spend.view, ...
  effect     String   @default("allow") // allow | deny
  scopeKey   String   @default("")      // "" = everywhere in their scope
  grantedById String?
  reason     String?
  createdAt  DateTime @default(now())

  @@unique([userId, capability, scopeKey])
}
```

`scopeKey` is an empty string rather than null, and that is load-bearing:
Postgres treats NULLs as distinct in a UNIQUE constraint, so a nullable column
would let an `allow` and a `deny` row for the same *global* capability both
insert and leave the outcome to insertion order. `''` is never a valid
`Account.key`, so it cannot collide with a real scope.

Because a scoped grant belongs to one account and `PermissionSubject` is
account-agnostic, `loadSubject(userId, { accountKey })` folds in that account's
grants alongside the global ones. Omitting `accountKey` applies only global
grants — under-granting rather than leaking one account's exception fleet-wide.

## Enforcement

`requireRole(...)` is replaced by:

```ts
const { ctx, error } = await requirePermission('studio.campaigns.publish', {
  accountKey,
});
if (error) return error;
```

Because 86% of the 242 call sites are the *same* guard, the migration is
mechanical: each route gets the permission key its path already implies, and a
single codemod pass does the bulk of it. On the client, `settings-registry.ts`
already has the right shape — its `visible: (s) => s.hasAdminAccess && s.isAdmin`
predicates become `can('agency.users.manage')`, which deletes the
`isAdmin`/`isElevated`/`hasAdminAccess` triple in `SettingsScope`.

## Migration path

Each phase ships independently and is safe to stop after.

| Phase | Work | Behavior change | State |
| --- | --- | --- | --- |
| 0 | Permission registry + `requirePermission()` that internally delegates to today's role buckets | **None.** Pure indirection, lets every call site migrate before semantics move. | **Done** |
| 1 | Add the two tables + `scopeMode`, the assignment data layer, and the coarse backfill (see below) | None — old checks still authoritative, and nothing reads the new rows. | **Done** |
| 2 | Sector-role assignment UI in the Users tab, so roles can be set by hand. Assign roles at user-creation time. | None — assignments recorded, not yet enforced. | **Done** |
| 3 | Migrate the 251 call sites to permission keys, then flip enforcement one sector at a time behind `PERMISSIONS_ENFORCE_*`, Projects first. | Enforcement begins. | **Migration complete** (252/252, zero `requireRole` left). Flags still all off. |
| 4 | Sensitive capability grants + per-report allowlists + audit log | Blast/PII/finance locked down. | **Done.** Capability flag still off. |

### The access delta, and why it is checked in code

The promise that flipping a flag is safe only holds if you know exactly what
changes. `registry.test.ts` computes, for every legacy role, the permissions
held today (via the legacy buckets) against the permissions the backfilled
sector roles give:

| Legacy role | Gains | Loses |
| --- | --- | --- |
| `developer` | — | — |
| `super_admin` | — | the 5 sensitive capabilities |
| `admin` | — | 4 sensitive capabilities |
| `client` | — | `reporting.budget.view`, `reporting.executive.view` |

**Nothing gains anything**, and that is asserted per role. Losing access is a
reviewable product decision; gaining it by accident is a security incident.
Writing this check is what caught two mistakes the design had missed:

- `agency.admin` originally carried `agency.users.manage`, which is
  elevated-only today (`POST /api/users`). Every existing admin would have
  gained the ability to create and delete users. That permission now belongs to
  `agency.owner` and `agency.user_manager`.
- The backfill originally put `admin` on `reporting.analyst` and
  `projects.member`, quietly removing nine permissions an admin holds today.
  Same reasoning as `studio.lead`: the backfill's job is to be boring.

The client row is the one intended removal, and it is the point of the whole
exercise — today every reporting read is merely "authenticated", so a dealer can
reach Budget and Executive.

### Agency: where the bucket is the point

Agency is the only sector where a single directory mixes legacy buckets, and
those distinctions are real rules that were nearly lost:

| Action | Bucket today | Permission |
| --- | --- | --- |
| List users | staff | `agency.users.view` |
| Invite a user | staff | `agency.users.invite` |
| Create / delete a user | **elevated** | `agency.users.manage` |
| Change someone's avatar | **developer** | `agency.users.avatar` |
| Edit a sub-account | staff | `agency.subaccounts.edit` |
| Create / delete a sub-account | **elevated** | `agency.subaccounts.create` / `.archive` |
| Read industries / markup / alert rules | staff | `agency.industries.view`, `agency.markup.view`, `agency.alerts.view` |
| Change any of them | **elevated** | `agency.platform.configure`, `finance.markup.manage` |

So an admin can invite a user but not create one, and can edit a sub-account but
not create one. `agency.admin` therefore carries **neither** `users.manage` nor
`subaccounts.create`/`.archive` — granting any of them would have widened every
existing admin. `agency.owner` has them; `agency.user_manager` covers user
administration for someone who needs nothing else.

Per-account CRM, SendGrid and Twilio config map to
`integrations.credentials.manage`, which is a sensitive capability rather than a
role grant — that is what it exists for.

### Cross-surface routes, and the ANY-of guard

Some routes genuinely serve two sectors. `GET /api/contacts` backs both the
Studio contact list and the Reporting surface's Contacts page
(`reporting/contacts`, `reporting/lists`), which is exactly why its legacy guard
admits `client`. The same is true of `GET /api/flows` and `GET /api/blasts/email`,
which the client dashboards read.

Guarding those with a `studio.*` permission alone would 403 every dealer, so
`requirePermission` accepts an array meaning **any of**:

```ts
await requirePermission(['studio.contacts.view', 'reporting.report.view'])
```

Staff enter through the Studio half, dealers through the Reporting half. The
legacy bucket of an ANY-of requirement is the most permissive of its members, so
the codemod's behaviour-preservation check still applies unchanged. There is no
"all of" form — nothing has needed one.

### Deliberate narrowings

Everything else in the migration preserves its legacy bucket exactly. These
three routes do not — they admitted `client` and no longer do:

| Route | Now guarded by | Why |
| --- | --- | --- |
| `POST /api/blasts/email` | `studio.email.edit` | Created a blast and, with `processNow`, sent it immediately. A dealer-role user could email a contact list. |
| `POST /api/blasts/email/process` | `studio.email.edit` | Drains the send queue. |
| `POST /api/flows/[id]/duplicate` | `studio.flows.edit` | Client-reachable write to a Studio resource. Harmless, but the same shape. |

Closed on an explicit decision (Connor, 2026-08-15: "clients shouldn't be able
to send blasts"), not as a side effect — the codemod refuses to change a bucket
unless the narrowing is listed with a reason, and it prints every one it applies.

**These took effect immediately, without `PERMISSIONS_ENFORCE_STUDIO`.** The
Phase 0 shim checks the legacy bucket of the *permission*, so swapping a guard
from an `authenticated` role list to a `management` permission excludes clients
straight away. Verified with a real client account against the flag turned off:
403 on all three, while `GET /api/blasts/email` still returns 200 and staff see
only normal validation errors.

Phase 4's `blast.send` capability then narrows sending further — from "any staff"
to the people who should actually be sending.

One loose end: `POST /api/blasts/email` still contains a
`session.user.role === 'client'` recipient-scoping branch that is now
unreachable. Harmless defence-in-depth; delete it whenever that file is next
touched.

### Where the subject comes from

Sector roles, `scopeMode` and capability grants ride on the **JWT**, alongside
`role` and `accountKeys`, and refresh on the same five-minute cycle
(`AUTH_USER_SELECT` and the refresh block in `src/lib/auth.ts`). So
`requirePermission()` costs no database query.

This matters more than it looks. `subjectFromSession()` originally derived roles
from `legacySectorRolesFor(role)` — which would have meant every hand-assignment
made in Settings → Users was ignored the instant enforcement flipped, with a
user narrowed to `studio.designer` still resolving as `studio.lead`. The legacy
mapping survives only as a fallback for tokens minted before the field existed.

Impersonation clears `_roleCheckedAt` on both entry and exit, so the token
reloads permissions for the new user id rather than wearing the target's name
with the impersonator's access.

**Phase 2 must also assign roles when a user is created.** The backfill is
guarded by an `AppSetting` key so it runs once — deliberately, because Phase 2
lets an admin *remove* a role by hand and an unguarded seed would put it back on
the next deploy (Loomi has been bitten by exactly that, with the changelog
entries that kept reappearing). The cost of guarding it is that users created
afterwards get no rows, so `scripts/backfill-sector-roles.ts` counts and warns
about users holding no sector role at all — they would have *no* access once the
enforcement flags flip.

Note the ordering: **the assignment UI ships before enforcement**, so roles are
assigned by hand and verified against the current roster while the old checks
are still the ones being obeyed. Nobody gets locked out by a wrong seed value.

The backfill is therefore deliberately dumb — no inference from `department`:

- `developer` → `developer` tier, all sectors at their top role
- `super_admin` → `staff` + `agency.owner`, `studio.lead`, `reporting.admin`, `projects.admin`
- `admin` → `staff` + `agency.admin`, `studio.lead`, `reporting.analyst`, `projects.member`
- `client` → `client` + `reporting.client`, and nothing else

`admin` deliberately lands on `studio.lead`, not `studio.producer`: an admin can
publish templates, activate flows, deploy forms and launch ads today, and
removing those at rollout is the kind of silent regression this phasing exists to
prevent. The backfill's job is to be boring.

The narrower roles — `studio.designer`, `studio.producer`, `studio.viewer` — are
the whole point of the exercise, but they get assigned by hand in the UI, to the
people who should have them, while the old checks are still authoritative.

## What this does not do

- **No custom role builder.** Roles stay in code until there's a real second
  agency using Loomi.
- **No per-field permissions.** `finance.spend.view` hides cost columns
  wholesale; it does not do per-column masking.
- **No approval workflows.** `producer` not being able to publish means the
  button is absent, not that it opens a review queue. Ad Gen already has its own
  co-op approval flow; don't generalize it here.

## Phase 4 — sensitive capabilities

The six capabilities no sector role confers, and where each is enforced:

| Capability | Enforced at |
| --- | --- |
| `blast.send` | `POST /api/blasts/email` (only when `processNow`), `/blasts/email/process`, and both `[id]/schedule` routes |
| `contacts.pii.export` | `POST /api/contacts/export` |
| `finance.markup.manage` | `PUT /api/default-markup`, `PUT /api/billing-markups` |
| `integrations.credentials.manage` | Per-account CRM / SendGrid / Twilio, and Google Business Profile OAuth |
| `user.impersonate` | `POST /api/impersonate` |
| `finance.spend.view` | Every ad report — strips internal cost from the payload |

Sending layers the capability on top of the sector role via
`requireAllPermissions(['studio.email.edit', 'blast.send'])`. Both matter:
`blast.send` alone would admit someone holding the grant but no Studio role, and
`studio.email.edit` alone is exactly the status quo the capability exists to
tighten. Note the split on `POST /api/blasts/email` — saving a draft needs only
the sector role; the capability is checked inside the handler, because whether
the request sends depends on the body.

### Contact export needed an endpoint to exist first

`contacts.pii.export` had nothing to guard. The CSV was built entirely in the
browser from rows already fetched, so there was no server-side moment where
"this person is taking 265,000 names, emails and phone numbers out of Loomi"
could be checked or recorded. Gating the bulk read instead was not an option:
the Reporting Contacts page uses the same endpoint, so it would have locked
dealers out of their own contacts.

`POST /api/contacts/export` now builds the CSV server-side, checks the
capability, scopes the query to the caller's accounts, and writes an audit row.

### The audit trail

`PermissionAuditLog` records both halves of the question "who gave this person
the ability to send blasts, and what have they sent since":

- `grant` / `revoke` — an administrative change, with actor and subject
- `use` — someone exercised a capability ("Sent email blast X to 1,204 recipients")
- `bypass` — a developer-tier user passed a check they hold no grant for.
  Break-glass is fine; silent break-glass is not.

Writes are best-effort and never block the action they describe. A blast that
sent but wasn't logged is bad; a blast that failed to send *because* logging
failed is worse.

### Seeding, and why it looks too permissive

`scripts/backfill-capability-grants.ts` grants each capability to exactly the
people who can already do it today — so `blast.send` starts out on every staff
member. That is deliberate, and the same reasoning as the Phase 1 backfill: with
an empty grants table, turning the flag on removes all six from everyone at once.

Narrowing is then **evidence-based rather than guesswork**: let it run, read the
`use` entries to see who actually sends and exports, and revoke from everyone who
never does. Guessing up front locks someone out mid-campaign.

### `finance.spend.view` closed a live leak

`applyMargins()` grosses each cost field up by the agency margin and keeps the
raw platform value beside it as `actual_<field>`. Those keys, plus the `margin`
percent itself, were being serialised straight into the ad-report responses —
for **every** viewer, dealers included. Anyone with devtools could recover what
Oz actually pays:

    margin = 1 - actual_spend / spend

Nothing in the UI reads either. `actual_*` is referenced nowhere at all, and
`margin` is declared in all three ad-report components and rendered by none of
them, so the fields were pure leak with no upside.

`stripInternalCost()` removes both, recursively — they sit on nested rows
(`campaigns[]`, `daily[]`, `devices[]`), not just top-level metrics. The four
margin-bearing routes (`ads`, `google`, `google/ad-groups`, `stackadapt`) apply
it whenever `ctx.canViewSpend` is false. `GET /api/reporting/me` returns
`canViewSpend` so the front end can hide cost columns rather than render blanks.

### Per-report allowlists

`AccountReportAccess` answers a different question from the permission, and the
two are checked in that order:

1. **Permission** — may this ROLE see this kind of report? Budget and Executive
   have their own permissions; everything else needs `reporting.report.view`.
   This is the security boundary.
2. **Allowlist** — does THIS sub-account expose this report to its clients? A
   dealer buying Meta ads and nothing else shouldn't get an empty Call Tracking
   page. Curation, applied only to someone the permission already admitted.

Staff bypass the allowlist entirely: it describes what a dealer is shown, not
what an account manager may look at.

**The allowlist is opt-OUT.** Every client-eligible report defaults to visible,
so deploying it changes nothing; it does something only once someone turns a
report off for a specific sub-account.

An earlier draft defaulted Call Tracking, Billboards and Direct Mail ROI to
*hidden*, on the theory that most dealers don't buy them. That would have
silently removed three reports from every live client the day this shipped —
a narrowing nobody asked for, and not one anyone would trace back to a
permissions release. A test now pins the no-op default.

A missing row therefore means the registry's `defaultForClients`, not "off", so
adding a report doesn't require writing a row for every account first. And
`CLIENT_ELIGIBLE_REPORTS` only contains reports gated by `reporting.report.view`,
so no allowlist row can ever surface Budget or Executive however it's set. A test
pins that.

Both checks were verified live against a real dealer account: Budget 403s on the
permission, a default-off report 403s on the allowlist with a *different*
message, an explicit row turns either direction on or off, and staff see all of
it regardless.

### Editing it

**Reporting → sub-account → Reports**, behind `reporting.configure`. Budget and
Executive never appear in the list, so the panel cannot be used to expose them,
and a client hitting the endpoint gets a 403 naming the permission.

Saving writes an explicit row for *every* eligible report, including the ones
left at their default — storing only the differences would mean a later change
to `defaultForClients` silently re-enabled something a dealer had switched off.
Only actual changes are audit-logged.

### Integration status

Switching a report on doesn't make it work. Most reports are a view onto an
integration, so enabling one for a dealer whose Meta ad account was never linked
hands them an empty page — and the person who ticked the box has no way to know
until the dealer complains. `resolveReportSources()` answers that per account,
in three states that are deliberately different claims:

| State | Means | Checked by |
| --- | --- | --- |
| `builtin` | Loomi's own data; nothing to connect | Contacts, Lists, Engagement, Leads |
| `connected` | The source this report needs is there | A configured ID, or ingested rows |
| `missing` | It isn't — the report will render empty | — |

Some sources are a configured ID (`metaAdAccountId`, `googleAdsCustomerId`,
`stackadaptAdvertiserId`, a `GbpConnection` row); others are the presence of
ingested rows (reviews, calls, billboards, mail, DMS sale/service events). Both
report as `connected`, but `detail` says which, so the badge never claims more
than was actually checked.

The banner totals only reports that are **on and empty** — a disconnected source
on a report nobody sees isn't a problem worth shouting about. "Match connected"
is the bulk action that does the real job: on for everything with a source, off
for the rest.

**The Integrate button only appears where there is somewhere to go.**
`reportIntegration()` maps Meta / Google Ads / StackAdapt to their modal in the
Integrations tab, and Business Profile to the report page that hosts its OAuth
panel. Everything else returns `null` on purpose:

- Websites (GA4) is mapped agency-wide in `GA4_PROPERTY_MAP`, not per account.
- Reviews, calls, billboards, mail and the DMS trends are **ingested**. Nothing
  to connect; the data either arrives or it doesn't.

A button that opened the wrong screen would imply the fix is one click away when
it isn't, so those rows show the badge and its tooltip and no button.

One implementation note worth keeping. `ReportingIntegrationCards` derives its
open modal from the parent's requested provider rather than copying it into
local state in an effect. The effect version fired correctly and still showed
nothing: switching tabs remounts that component, so the copy was discarded on
the very next render.

### The nav filters itself

`GET /api/reporting/my-reports` returns what the caller can open on an account,
so the sidebar doesn't advertise doors that won't open — and doesn't
reimplement the permission and allowlist rules in the browser, where they would
drift. It isn't a security boundary; each report route runs the same check.

Two traps, both now covered by tests:

- **The nav's ad-platform key is not the report key.** `/ads/meta` is the report
  called `ads`; `/ads/blasts` is `engagement`. Slicing the platform off the href
  and using it as a report key hid Meta Ads from every client, and the first
  version of the mapping test missed it because that branch bypassed the map.
- **An unmapped destination is treated as not gated.** A link that 403s is a
  better failure than a report that silently vanishes because someone added a
  route and forgot the map. A test fails CI if a Digital Ads platform has no
  entry. `/ads/ad-templates` is deliberately ungated — it has no registry entry
  and is visible today.

### Still to do

- The end-to-end cost strip could not be exercised locally: the ad reports need
  Meta/Google credentials this machine doesn't have. `stripInternalCost` is unit
  tested and `canViewSpend` was verified false for a client and true for staff,
  but the assembled payload should be eyeballed once on staging.
