# Settings architecture

How Settings is organised across Loomi's surfaces. Written 2026-08-14 to end the
drift between Studio, Reporting, Projects, and Agency View.

## The problem being fixed

Settings today is one page pretending to be three, wrapped in three different
navs, alongside two unrelated settings systems.

- **One page, three hosts.** `src/app/settings/page.tsx` is re-exported verbatim
  by `src/app/reporting/settings/page.tsx` and `src/app/app/settings/page.tsx`.
  The tab list (`useSettingsTabs`) is gated by **scope** (agency / org /
  sub-account) and **role**, but is almost entirely surface-blind — a single
  surface check exists in the whole file (`contact-fields` hidden on App). So
  Reporting offers Industries, Markup, Alert Rules, Co-op Guidelines and the
  Knowledge Base.
- **Three nav behaviours for one route family.** Studio and Projects swap the
  sidebar to `SettingsNav` on a `/settings/*` route. Reporting never swaps — its
  sidebar has no `SettingsNav` import — and styles its active pill differently
  (solid primary vs 10% tint). Agency View deliberately doesn't swap either,
  because `buildAgencyNav` promotes the settings destinations into an inline
  MANAGE / CONFIGURE rail. That rail exists **only** in the Studio sidebar.
- **Two definitions of one list.** `buildAgencyNav` declares its own items and
  carries a comment admitting it must be hand-synced with `useSettingsTabs` or a
  tab renders with no way to reach it.
- **Three settings systems, three URL grammars.** The global tab page
  (`/settings/<tab>`); sub-account settings via `SETTINGS_TABS` in
  `subaccount-detail.tsx`, reachable at *two* shapes (path-based
  `/subaccount/<slug>/settings/<tab>` and query-based
  `/settings/subaccounts/<key>?tab=`); and messaging settings at
  `/messaging/settings/{sending,sms,suppressions}`, which appears in no settings
  nav at all.
- **Personal settings scattered across four places.** Appearance is a settings
  tab *and* a sidebar footer toggle. Profile is a standalone `/profile` page
  reached only from the top-bar dropdown, with a mirror at `/reporting/profile`.
  Notifications is the one thing already right — `NOTIFICATION_CATEGORY_SURFACE`
  filters categories by surface, and that mechanism is the model for the rest.

## The model: three tiers, one grammar

### Tier 1 — Agency Settings

One set, one rail, identical on all three hosts. Owns the platform and who is in
it.

| Group | Items |
| --- | --- |
| Manage | Sub-Accounts, Users, Teams, Field Blueprints, Knowledge Base |
| Configure | Industries, Markup, Alerts, Co-op Guidelines |

**Locked decision:** Agency Settings lives in a **large modal**, not the app
shell.

- **Entered** by the cog in the top bar, on every surface. That slot used to
  hold the bug reporter, which moved into the user dropdown.
- **Left** by the close button, the backdrop, or Escape.
- Rendered as a frosted-glass panel (`glass-modal`) over a heavily blurred
  backdrop, with the Manage/Configure rail down the left.
- **Nothing about the surrounding page changes** while it's open: no route
  change, no account-scope switch, no nav swap. You come back to exactly what
  you were doing.

Because the account scope is deliberately left alone, anything that would
otherwise filter by it is told explicitly that it is in agency scope:

- `useAgencySettingsNav()` evaluates the registry with `isAdmin` forced on —
  asking with the ambient scope would return the active *sub-account's*
  settings instead of the platform's. Role gating still applies.
- `UsersTab` takes `agencyScope`, which bypasses the sub-account filter so the
  roster is fleet-wide.
- The sub-account list is rendered without `restrictKeys`.

**Users here are the AGENCY's people, not a sub-account's.** One list was
serving both, so agency staff turned up inside every sub-account they cover and
clients turned up in the platform roster. They're split by role now:
`agencyScope` lists developer / super_admin / admin; a sub-account's Users tab
lists its clients. An agency user being *assigned* to sub-accounts is what the
Sub-Accounts column shows — it makes them an agency member covering that
account, not one of its users. New users created here start as `admin` for the
same reason: created as a Client, the row would save and immediately vanish
from the roster it was added to.

The modal has its own `agency-settings-title-actions` portal slot for tab
actions. It must not reuse the page's `settings-title-actions` id: opened over a
settings page, `getElementById` would resolve to the page's slot and render the
button behind the overlay.

**Drill-ins stay inside the modal.** Opening a sub-account or a user used to
push a route, which closed the tier in all but name — the record appeared in the
app shell, behind the overlay, in exactly the place this tier is not supposed to
live. `AccountsList`, `UsersTab`, `SubAccountDetailPage`, `UserDetail` and
`NewUser` all take an optional "open this in place" callback (`onOpenAccount` /
`onOpenUser` / `onCreateUser`) plus an `onBack`; with no callback they navigate
exactly as before, so the routed pages are unchanged. Switching rail tabs always
drops back to the list.

The item list lives in one registry (`settings-registry.ts`) that the rail, the
sub-account settings rail, and the Settings page all render from, so they cannot
disagree about who sees what.

**Terminology:** "Agency Settings" everywhere — the rail and the cog's tooltip.
"Agency View" is retired.

#### Agency scope is not a place

The switcher's "Agency Settings" entry is **gone**. It listed a scope you
stepped into — a shell whose nav was Dashboard / Templates / Assets and whose
footer Settings link opened the platform config as a *page*. That was the second
door the modal was meant to replace, and having both is what made the tier feel
like two different things.

What this means concretely:

- The account switcher lists sub-accounts and nothing else.
- `AccountType`'s `admin` mode survives only as the UNRESOLVED state — the beat
  between "authenticated" and "we know which sub-account to open".
  `resolveDefaultAccountKey` closes it as soon as the account list lands,
  preferring the largest Organization (the widest view anyone gets now) and
  falling back to the first account by name. A stale `admin` cookie resolves the
  same way.
- The sidebar's footer Settings link is always Tier 2; it can no longer point at
  `/settings/subaccounts` or `/settings/users`. Those tabs are gated on
  `isAdmin`, so the app-shell Settings page simply stops offering them and
  redirects old links to the first tab the scope can see.
- `AgencyDashboard` is deleted. Its content — org list, counts, quick links —
  was a scope-level home for a scope that no longer exists.

#### The agency-level work pages

The roll-up Dashboard, the shared Template library and the Loomi/OEM asset
library were the three non-settings things agency scope carried. **They are not
being rehomed onto a combined org view — there is no cross-account browsing mode
any more, on purpose.** Settled 2026-08-15:

- Sharing is a SCOPE, not a view. A shared or OEM asset already resolves into
  every library it covers, so an admin standing in any sub-account sees, filters
  and manages the shared pool in place. A fleet-wide grid was a second way to
  look at the same rows.
- What sharing can't express — "that rooftop's photo, as mine" — is a **copy**:
  `POST /api/media/[id]/copy`, offered as "Copy to…" on any asset including
  inherited ones. See docs/asset-management.md §3.
- Roll-up where it's genuinely aggregate (Contacts, the Projects boards) is the
  Organization account's job, via `isGroup` + `scopedAccountKeys`.

So the following were **deleted**, not parked: the Asset Library's "All
Accounts" grid and its scope rail, the all-accounts Flows and Flow-analytics
views, and the unscoped copy of the Emails & SMS list.

Two things lived inside those views without belonging to them, and kept their
own door instead of dying with them:

- **Rights & Activity** (the licence sweep's health and what's expiring) is a
  compliance monitor, not a browsing mode. It's an admin-only toggle in the
  Asset Library now — its readings are fleet-wide wherever you open it, and a
  stopped sweep has to be visible to somebody.
- **Flow templates** (flows with no `accountKey`, which sub-accounts deploy
  from) are reachable through a **Templates** switch on the Flows page, role-
  gated. A switch, not a scope: the active sub-account doesn't change.
- **Collections** moved into the account library's rail, where the assets they
  hold are. They were browsable only from the agency rail, so "Add to
  collection" was creating sets nobody could open again.

Publishing to the shared scopes is preserved and now gates on admin *role*
rather than agency scope: the "Loomi library" and "Shared — all `<brand>`
sub-accounts" upload targets, and Move-scope, work from inside any sub-account.

### Tier 2 — Sub-account

The tenant's own config. The shape is **core + sector**, and the rail says so:
two headings, **"Sub-Account Settings"** then **"Studio / Reporting / Projects
Settings"**.

| Group | Section | Studio | Reporting | Projects |
| --- | --- | :---: | :---: | :---: |
| Sub-Account Settings | General | ✓ | ✓ | ✓ |
| | Users | ✓ | ✓ | ✓ |
| | Branding | ✓ | ✓ | ✓ |
| | Integrations | ✓ | ✓ | ✓ |
| *Sector* Settings | Domains | ✓ | — | — |
| | Custom Fields | ✓ | — | — |
| | Notifications | ✓ | — | ✓ |
| | Appearance | ✓ | ✓ | ✓ |

Domains and Custom Fields sit under the sector heading, not the account one:
they exist because Studio publishes pages and shapes contact records, not
because the sub-account has them.

**General** is the old "Company" / "Sub-Account" tab, renamed. The key moved
`company` → `general`; the old key still resolves (`canonicalSubaccountSection`)
and `/settings/company` redirects, so existing links keep working.

**Users** is that tenant's CLIENT users, scoped to the active sub-account, and
when that sub-account is an organization it rolls up its children — the filter
runs on `scopedAccountKeys`, the same hierarchy expansion the other roll-up
views use. Agency staff assigned to the account are not listed here; they live
in Agency Settings → Users.

**Notifications** follows the categories: `NOTIFICATION_CATEGORY_SURFACE` maps
every category to studio or app, so Reporting has none and the tab would open
empty there.

All three sectors render this from one component (`SubAccountDetailPage`) and one
sector-gated list (`subaccountSectionsForScope`). Studio reaches it at
`/subaccount/<slug>/settings/<section>`; Reporting and Projects have no
`/subaccount/*` route tree, so their Settings link uses the admin-browse shape
`/settings/subaccounts/<key>?tab=<section>` against the active account.

Still to fold in:

- Messaging settings (`sending` / `sms` / `suppressions`) are sub-account config,
  not a feature island. They belong here under the Studio filter.
- Integrations should split by sector — reporting providers (StackAdapt, Google
  Ads, GoHighLevel) on Reporting, CRM and sending providers on Studio. Today
  both sectors get the same panel.

### Tier 3 — Personal

Yours, not the account's. Same shell on every surface; contents vary by sector.

**Route: `/u/<userId>/settings/<tab>`.**

Why an id and not a name: there is no `firstName` column — `User.name` is a
single `String` and it is not `@unique` (only `email` is), so a first-name key
would be a substring of a display string that changes on rename. A bare name or
id at the app root would also need a root-level `[user]` dynamic segment, which
competes with every top-level route: a user named "Media" becomes unreachable,
and any new top-level route silently shadows a person. Ids are cuids and stable.

The rail heading is **"Your settings"** — not the user's name. The id stays in
the path as the stable key; the heading stays generic, so the tier reads as
"mine" without the UI having to interpolate a name it doesn't cleanly have.

Like `/settings`, `/u/*` is host-rewritten by `src/proxy.ts`, so it needs mirror
route files under `/reporting/u/*` and `/app/u/*` — the same pattern `/settings`
already uses.

**Shared by all three sectors** (same three tabs, same order, everywhere):

- **Profile** — name, title, email, avatar, password. Folds in the standalone
  `/profile` page and its `/reporting/profile` mirror; both are then deleted.
- **Appearance** — theme, later density and default sidebar state. The sidebar
  footer toggle stays as the shortcut.
- **Notifications** — already surface-filtered via `NOTIFICATION_CATEGORY_SURFACE`.

**Studio adds:**

- Default sub-account on entry (which scope you land in)
- Composer identity — your sending name and signature, where a sub-account
  permits multiple senders
- Builder defaults — ad-builder snap/grid, default preview size, media library
  list vs grid

**Reporting adds:**

- Default date range and comparison period (every report re-asks today)
- Default landing report / dashboard
- Number and currency formatting; whether margins show by default
- My report subscriptions — which scheduled emails *I* receive, distinct from
  what the account sends to clients

**Projects adds:**

- Default view (Initiatives / Board / Table / Calendar) and default grouping
- My Work defaults — filters and sort
- Working hours / capacity, for calendar and load
- Mention and assignment cadence — belongs under Notifications rather than
  duplicating the mechanism

Only Profile, Appearance and Notifications exist today. Everything else is new
preference storage on the user record.

## The two doors

**Cog (top bar)** → Agency Settings. Hidden for roles with no platform access.

**Footer "Settings" link** → the tier that matches your scope:

- **Inside a sub-account, admin role** — Tier 2, `/subaccount/<slug>/settings`.
- **Everyone else** — Tier 3, `/u/<userId>/settings`.

A sub-account user never sees platform config, on any surface.

The user dropdown holds Profile, theme, **Report a Bug**, and Logout. It no
longer carries a cross-surface link — the sidebar's surface switcher offers all
three, so a single "Studio"/"Reporting" entry was a second, narrower door to the
same place.

**The help desk** is the "?" in the top utility bar, beside Notifications. It
was a "Get Help" button in the sidebar footer, which put a way *out* of the
product (to a person) among the destinations *inside* it. The "?" previously
opened the AI assistant; that keeps its own floating bubble, which is where
people already reach for it.

## Migration slices

1. **Nav unification.** One registry behind the agency rail + `useSettingsTabs`.
   Reporting and Projects render the same rail; Reporting gains the
   `SettingsNav` swap it lacked. Active-pill styling unified across the three
   sidebars. *Done.*
2. **Agency Settings as a place.** Cog entry, back button, scope stash/restore,
   no switcher, bug reporting moved to the user dropdown. *Done.*
3. **Retire agency scope.** Switcher entry gone, default scope resolves to a
   sub-account, agency tabs no longer render in the app shell, drill-ins stay
   inside the modal, agency-vs-client rosters split by role, shared-asset
   publishing re-gated on role, Projects' cross-account board moved onto the
   `isGroup` roll-up. *Done.*
4. **Retire the cross-account views** rather than rehoming them: copy replaces
   the browse grid, Rights and Flow templates keep their own doors, Collections
   move into the account rail. *Done.* The open question this closed — whether
   an org account's library should show a merged pool of its children's assets —
   is answered "no": an org account is a sub-account that happens to have
   children, and its library is its own.
4. **Tier 2.** Surface-filter the sub-account panels, retire the `?tab=` URL
   shape, fold messaging settings in, split Integrations by surface.
5. **Tier 3.** Add `/u/<userId>/settings/*` plus host mirrors, fold `/profile`
   in and delete it, then add the per-sector preference storage a group at a
   time.
