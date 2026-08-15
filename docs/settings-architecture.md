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

The modal has its own `agency-settings-title-actions` portal slot for tab
actions. It must not reuse the page's `settings-title-actions` id: opened over a
settings page, `getElementById` would resolve to the page's slot and render the
button behind the overlay.

The item list lives in one registry (`settings-registry.ts`) that the rail, the
sub-account settings rail, and the Settings page all render from, so they cannot
disagree about who sees what.

**Terminology:** "Agency Settings" everywhere — the rail, the cog's tooltip, and
the account switcher's fleet-wide entry. "Agency View" is retired.

#### The three non-settings agency pages

Agency scope currently also has the roll-up Dashboard, the shared Template
library, and the agency Media library. These are **not** settings and do not
belong in this rail. They are to be rehomed onto the **Organization
sub-account**: the org sub-account gains the agency-level asset library and
template capabilities, and the dashboard stays at sub-account level.

Until that lands they remain reachable under agency scope on a non-settings
route, so nothing goes dark. Once rehomed, the switcher's Agency Settings entry
can go too, leaving the cog as the only door.

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

**Users** is scoped to the active sub-account, and when that sub-account is an
organization it rolls up its children — the filter runs on `scopedAccountKeys`,
the same hierarchy expansion the other roll-up views use.

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
- **In Agency Settings** — not shown; it would point at the page you're on. The
  theme toggle takes that slot instead.

A sub-account user never sees platform config, on any surface.

The user dropdown holds Profile, theme, **Report a Bug**, and Logout. It no
longer carries a cross-surface link — the sidebar's surface switcher offers all
three, so a single "Studio"/"Reporting" entry was a second, narrower door to the
same place.

## Migration slices

1. **Nav unification.** One registry behind the agency rail + `useSettingsTabs`.
   Reporting and Projects render the same rail; Reporting gains the
   `SettingsNav` swap it lacked. Active-pill styling unified across the three
   sidebars. *Done.*
2. **Agency Settings as a place.** Cog entry, back button, scope stash/restore,
   no switcher, bug reporting moved to the user dropdown. *Done.*
3. **Rehome the three agency pages** onto the Organization sub-account (asset
   library + templates at agency level; dashboard at sub-account level), then
   drop the switcher's "Agency" scope entry.
4. **Tier 2.** Surface-filter the sub-account panels, retire the `?tab=` URL
   shape, fold messaging settings in, split Integrations by surface.
5. **Tier 3.** Add `/u/<userId>/settings/*` plus host mirrors, fold `/profile`
   in and delete it, then add the per-sector preference storage a group at a
   time.
