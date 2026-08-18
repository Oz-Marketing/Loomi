# Playbooks — the standard way a rooftop is run

Plan for making "how we run a Chevrolet store" a **thing in the system** rather
than a thing in someone's head: a named, versioned definition that can be
applied to an account, kept in sync with it, and audited against it.

Status: **Phase 0 built** (read-only coverage audit, flag-gated). Phases 1–3
specified, unbuilt. See §7.

Rebased onto `main` on 2026-08-16, at which point the audit grew four checks
covering the ad generator's companion offer email — see §4.4 and §8.

---

## 1. Where we stand

Loomi already encodes "the standard setup" in at least seven places. Each one
was built for its own feature, stores its own shape, and knows nothing about
the others.

| Fragment | Where | Scope | Versioned? |
|---|---|---|---|
| Six lifecycle audiences, auto-seeded | `LIFECYCLE_PRESETS` (`src/lib/smart-list-presets.ts`) + `Account.lifecyclePresetsSeededAt` | hard-coded to automotive | no |
| Offer watch scope, offer-type priority, template map | `AdAutomationConfig` | per account | no |
| Objective, budget, geo, UTM, destination | `AdLaunchPreset` | per account + platform | no |
| Co-op rules and template pre-approval | `AdCoopRulePack`, `AdTemplateCoopApproval` | per OEM | pack version + `docHash` |
| Department fan-out for onboarding | `TEMPLATES` in `projects/new/_components/intake-form.tsx` | picks teams, seeds no tasks | no |
| Pacing alert thresholds | `AlertRule` | global, not per-brand | no |
| Budget structure | `BudgetLine`, `MetaAdsPacerPeriodBudget` | per account + month | no |

Nothing joins them. So the question that actually matters across a 38-rooftop
group —

> **which of these stores is missing it?**

— has no answer short of opening 38 tabs. That question is the product. The
bundle is just what makes the answer actionable.

---

## 2. Definition

A **playbook** is a named, versioned definition of the standard way a certain
kind of account is run, plus a per-account link recording that this
rooftop follows it.

It is not a template (one artifact) and not a preset (one setting). It is the
bundle — audiences, flows, automation config, launch preset, co-op-approved
creative, budget shape, alert thresholds, and the human checklist — under one
key, with a version.

Three flavours are worth naming, and they compose:

1. **Brand / OEM** — Chevrolet, Ford, Honda. Co-op rule pack, disclaimer
   templates, approved plates, offer-type priority, brand assets. Keys off
   `Account.oem` / `Account.oems`.
2. **Department motion** — New Sales, Used Sales, Service, Parts, F&I.
   Audiences, flows, cadence, ad category, budget split, KPI targets. This is
   what actually differs between "we run service for this store" and "we run
   everything".
3. **Season / event** — Model Year End, Truck Month, Presidents Day, Service
   Winterization. A *timed* bundle that spins up an Initiative, tasks,
   creative, and budget lines across N rooftops in one action.

### Three verbs

- **Apply** — new rooftop, pick playbooks, everything provisions. Turns a
  three-week onboarding checklist into a form.
- **Inherit** — the parent Account (e.g. a group like YAG) or the OEM owns the
  playbook; rooftops follow it live, per-step detachable.
- **Audit** — a coverage matrix of which rooftops actually match.

Audit ships first. It is read-only, it proves value across the whole group on
day one, and it tells us empirically which steps are worth automating before
we write a single writer.

---

## 3. Why the audit is Phase 0, not a nice-to-have

Three reasons, in order of weight.

**It cannot break anything.** No writes, no schema, no migration. It reads
what is already there and renders it. The blast radius is a page.

**It is the requirements document for Phases 1–3.** Every check that comes
back green across all 38 rooftops is a step not worth automating. Every check
that is red on 30 of them is the first thing the apply engine should do. We do
not have to guess the contents of a playbook — we measure it.

**It answers the consistency pitch directly.** "Every store gets the same
setup, and here is the screen that proves it" is a different sales
conversation from "we have a process". See `docs/dealer-teamwork-parity.md`.

---

## 4. Phase 0 — the coverage audit (built)

### 4.1 Shape

Everything lives under `src/lib/playbooks/`:

```
types.ts        Check / playbook / result types. No prisma, no react.
checks.ts       The check registry — 25 pure functions over an audit context.
definitions.ts  Six Phase 0 playbooks: named bundles of check ids.
context.ts      The ONLY prisma module. Batched reads → one context per account.
audit.ts        Pure orchestration: context × definitions → coverage.
```

`context.ts` is deliberately the only place that touches the database, and it
issues a **fixed number of queries regardless of account count** (nine
`findMany`s, then in-memory indexing). A per-account query loop over 38
rooftops × 25 checks is the obvious way to write this and the wrong one.

Everything else is pure, so `checks.test.ts` builds contexts by hand and
asserts on them with no database.

### 4.2 Check result vocabulary

| Status | Meaning |
|---|---|
| `pass` | Observed state matches the playbook. |
| `fail` | Observed state does not match, and the gap is real work. |
| `warn` | Configured, but in a state that will bite — stale, unconfirmed, or partially set. |
| `na` | The playbook does not apply to this account. **Not scored.** |

Coverage % = `pass / (pass + warn + fail)`. `na` is excluded from both halves
— a Google check on a store that does not run Google is not a 100% and not a
0%, it is not a question.

Severity is separate from status: `blocking` (publishing is impossible),
`standard` (the setup is incomplete), `advisory` (worth knowing, not a defect).
The UI sorts by severity within a playbook so a blocking red never sits below
an advisory one.

### 4.3 Applicability, and the honest caveat

Phase 0 has no `PlaybookApplication` table, so it infers applicability from
observable account facts — `category === 'Automotive'`, an OEM is set, a Meta
ad account id exists, an `AdAutomationConfig` row exists.

**That inference is a stand-in, and it is exactly what a real playbook
removes.** "This store has a Google customer id, so presumably it should have a
conversion action" is a guess. "This store follows Automotive Paid Search v2,
which requires a conversion action" is a fact. Phase 1 replaces every
`appliesTo` predicate with the explicit link; until then the audit can be wrong
in both directions and the UI says so.

### 4.4 The checks

Six playbooks, 25 checks.

**`automotive-foundation`** — applies to any Automotive / Powersports account.

| Check | Severity | Passes when |
|---|---|---|
| `account.oem` | standard | `oems` or `oem` is set |
| `account.branding` | standard | a light logo **and** a primary colour resolve (own or inherited up the parent chain) |
| `account.timezone` | standard | `timezone` is set |
| `account.rep` | advisory | `accountRepId` is set |

**`automotive-paid-social`** — applies when a Meta ad account or a pacer plan exists.

| Check | Severity | Passes when |
|---|---|---|
| `meta.ad_account` | blocking | `metaAdAccountId` is set |
| `meta.page_confirmed` | blocking | `metaPageId` set **and** `metaAssetsConfirmedAt` non-null — warns when the id is set but nobody signed off |
| `meta.pixel` | standard | `metaPixelId` and `metaDefaultConversionEvent` both set |
| `meta.timezone_synced` | advisory | `metaTimezone` cached by the sync |
| `ads.launch_preset` | blocking | an `AdLaunchPreset` for `meta` exists — and, when `launchMode` is `attach_existing`, `targetAdSetId` is set |

**`automotive-paid-search`** — applies when a Google customer id or a Google budget goal exists.

| Check | Severity | Passes when |
|---|---|---|
| `google.customer_id` | blocking | `googleAdsCustomerId` is set |
| `google.conversion_action` | standard | `googleConversionAction` is set |

**`automotive-pacing`** — applies when a pacer plan or a Meta ad account exists.

| Check | Severity | Passes when |
|---|---|---|
| `pacer.plan` | blocking | a `MetaAdsPacerPlan` row exists |
| `pacer.period_budget` | standard | this month's `MetaAdsPacerPeriodBudget` carries a non-zero goal |
| `pacer.markup` | advisory | `markup` is set (passes with a note when falling back to the 0.77 default) |
| `budget.managed` | advisory | `managedByBudget` is true for this month |

`budget.managed` is expected to be red almost everywhere, on purpose. The
budget module is built but not switched on, and a per-rooftop count of *how
un-switched-on it is* is the only honest picture of that migration.

**`automotive-ad-automation`** — applies when an `AdAutomationConfig` row exists.

| Check | Severity | Passes when |
|---|---|---|
| `adgen.config_enabled` | standard | the config exists and `enabled` is true |
| `adgen.template_map` | blocking | `templateMap` has at least one entry |
| `adgen.notify` | standard | `notifyUserIds` is non-empty |
| `adgen.inventory_feed` | standard | an active feed synced `ok` within 3 days |
| `adgen.recent_run` | standard | an `AdAutomationRun` touching this account within 3 days |
| `coop.template_approved` | blocking | every mapped template has a live `AdTemplateCoopApproval` for one of the account's makes whose `docHash` equals the template's current `designHash` — warns when an approval exists but the design has moved |
| `adgen.email_enabled` | advisory | `emailEnabled` is true |
| `adgen.email_template` | blocking | no shell configured (composed from the brand kit), or the configured `Template` exists, is v2, and carries an `{{offers}}` block |
| `adgen.email_audience` | standard | `emailAudienceId` resolves to an `Audience` on THIS account |
| `adgen.email_recent` | standard | an offer email drafted within 35 days |

The four email checks are `na` unless `emailEnabled` — the companion email is off
by default, and reporting every automated rooftop as failing a feature nobody
switched on is exactly the "red everywhere" noise that makes an audit ignorable.
`adgen.email_recent` uses 35 days rather than the ad run's 3, because an email is
only drafted when the offer SET changes and an OEM programme routinely holds for
a full cycle.

**`automotive-lifecycle`** — applies to any Automotive / Powersports account.

| Check | Severity | Passes when |
|---|---|---|
| `audiences.lifecycle_seeded` | standard | `lifecyclePresetsSeededAt` is non-null |
| `contacts.ingest_recent` | standard | an `IngestRun` within 7 days |
| `email.sender_identity` | standard | `senderEmail` and `sendingDomain` both set |
| `sms.twilio` | advisory | a messaging service or phone number is configured |

### 4.5 Surface

`/playbooks` on the App host (internal staff only — the App layout already
bounces client roles to Studio). Flag-gated behind
`NEXT_PUBLIC_ENABLE_PLAYBOOKS`, off by default like the Ad Generator.

Two views over one payload:

- **By account** — a row per rooftop, a coverage bar, and per-playbook
  pass/warn/fail counts. Expand a row for the individual checks with their
  detail strings and a link to the screen that fixes each one.
- **By check** — a row per check, showing how many rooftops fail it. This is
  the view that drives Phase 1 scope.

`GET /api/playbooks/audit` returns the whole matrix. Account scope is enforced
with `getAccountScope` / `filterAccountKeysByAccess`, so an admin restricted to
three rooftops audits three rooftops.

---

## 4b. Creative playbooks — Phase 1's first slice (built)

The `Playbook` model below now exists, scoped to **`creative`** only: the ad
template + sizes and the offer-email shell that go together, authored once for
the agency and applied to many accounts. `scope`/`scopeValue` are on the
model so the other flavours can arrive without a migration; nothing reads them
yet.

### The one decision that shaped it

A playbook **presets** an account's creative rather than owning it.
`AdAutomationConfig.templateMap` / `sizeIds` / `emailTemplateId` stay the single
source of truth for what a run uses, and `playbookId` is only a link. So:

- generation never resolves a playbook — no new failure mode in the run path;
- deleting a playbook unlinks rooftops instead of blanking their setup
  (`onDelete: SetNull`);
- **override state is derived, never stored.** Comparing the config's columns to
  the definition needs no `stepStates` column, no backfill, and cannot go stale.
  §5 Phase 2's stored `synced | detached` is the thing this avoids.

Overrides are per-step with a per-step undo, not one "reset to playbook" — a
whole-bundle re-apply throws away deliberate overrides the person wasn't looking
at. Resetting the ad template also clears the size selection, because sizes
belong to a design and ids picked against another template render nothing.

### Where it lives

| Piece | File |
|---|---|
| Pure resolution — parse, hash, diff, reset | `src/lib/playbooks/creative.ts` |
| The only prisma module | `src/lib/playbooks/library.ts` |
| Library CRUD + template options | `src/app/api/playbooks/library/` |
| Authoring UI (Playbooks → Library) | `src/app/app/playbooks/_components/playbook-library.tsx` |
| Selection + override badges | the automation **Config** tab |

Authoring is agency-wide and deliberately NOT in an account's settings: a
playbook exists to be applied to many rooftops, and building it from inside one
of them is how it quietly becomes that rooftop's private setting. For the same
reason the authoring dropdowns offer only shared templates — a design owned by
one account would render nothing everywhere else.

`definitionHash` normalizes key and size ORDER before hashing, and only a real
content change bumps `version`. Renaming a playbook, or re-saving it untouched,
must not mark every rooftop as behind.

### Traps found building it

- **`save_config` is a full replace.** Every field the form holds must reach
  `toPayload`, or flipping the automation on/off switch — which re-posts the
  saved scope through that same function — silently resets it.
  `use-automation.test.ts` pins this for every field, keyed off `ScopeForm`, so
  a future field that skips the payload fails at the type level.
- **`db push` refuses to add a unique constraint to an existing table.** A new
  `@unique` needs an `ensure-*-unique.ts` script in `deploy:prepare` ahead of
  the push. CI never catches this — CI pushes to a fresh database, where the
  constraint is born with the table, so it fails on staging and prod only.
- **The picker must carry every option's definition, not just the followed
  one.** Resolving only the saved playbook means picking a different one presets
  nothing until a save round-trips — which reads as the feature being broken.

### VIN-sourced generation

The automation was already VIN-driven — `resolveWatchScopes` reads `currentNewStock`
(every `InventoryVehicle` with `condition: 'new'`, `soldAt: null`) and watches
every model with stock, so blank filters mean EVERYTHING on the lot. Four empty
text boxes made that look like unfinished setup, so Config now states the default
and proves it with a coverage chain: **VINs → trims → with a live offer → ads this
run**. The filters became collapsed narrowing.

`adsThisRun` reuses generation's own `stockGate`/`stockGatePassed` rather than
re-deriving the rule — note `minStock: 0` means NOT ENFORCED, so a vehicle with
offers and no stock still counts.

**Trim matching was a correctness bug, and it was free to fix.** MarketCheck is
queried by `make`/`model`/`year`/`zip` — trim is NOT a request parameter, it comes
back ON each incentive. The pipeline was paying for it and discarding it, so a
Silverado LT programme could be attached to High Country stock and published with
a resolved disclaimer for an offer those VINs never qualified for. `selectOffer`
now takes `stockedTrims`; matching is a token-PREFIX test, because `'ltz'.includes('lt')`
is true and a substring test attaches LT programmes to LTZ stock, while `LT` must
still cover `LT Trail Boss`. Unknowns never reject. Verified against Young Chev:
83 VINs, 39 trims, and the live LT / Custom / untrimmed-APR programmes all
correctly eligible.

The gate is applied in generation, the shadow report's "would choose", AND the dry
run — the dry run's own comment already warns that a diagnostic contradicting
production is worse than none.

**Offer-type expansion** (`expandOfferTypes`) builds an ad per qualifying type
rather than only the best. Off by default: on a 12-model lot that is ~30 ads
against a `maxAdsPerRun` default of 10, and the cap would truncate to an arbitrary
subset. It costs no extra MarketCheck calls — the offers are already on file.
Generation now builds a work list of (vehicle × offer) up front, which also
collapsed an N+1 stock query into one read.

> **Trap found here.** `offerTypePriority` was stored per account but never on
> the form, so `save_config` — a full replace — reset a customised priority to
> lease/apr/cash every time anyone pressed Save. It is now on `ScopeForm`, shown
> as a reorderable chip row, and covered by the completeness test.

### Not built

- Applying a playbook to many accounts at once. Today it is picked per
  rooftop; the model supports the sweep, the UI doesn't.
- Version-behind prompting. `version` and `definitionHash` are recorded, but a
  rooftop on an older version isn't yet told so — that is §5 Phase 2.
- The step registry (`audience.preset`, `flow.template`, …). Creative is one
  hard-coded bundle, not a general step list.

---

## 5. Phases 1–3 (specified, unbuilt)

### Phase 1 — definition + apply

Three models, mirroring patterns already in the schema:

```prisma
model Playbook {
  id             String @id @default(cuid())
  key            String @unique   // stable slug, like AlertRule.key
  name           String
  scope          String           // category | oem | department | event
  scopeValue     String?          // "Chevrolet", "service", …
  version        Int    @default(1)
  definition     String @db.Text  // JSON: ordered steps
  definitionHash String           // staleness test, like AdTemplateCoopCheck.docHash
  publishedAt    DateTime?
}

model PlaybookApplication {
  id             String @id @default(cuid())
  accountKey     String
  playbookId     String
  appliedVersion Int
  stepStates     String @db.Text  // JSON: { [stepKey]: 'synced' | 'detached' }
  appliedById    String?
  appliedAt      DateTime @default(now())
  @@unique([accountKey, playbookId])
}

model PlaybookRun {
  id         String   @id @default(cuid())
  accountKey String?  // null = a sweep across every application
  kind       String   // audit | apply | sync
  startedAt  DateTime @default(now())
  finishedAt DateTime?
  stepsRun   Int      @default(0)
  stepsApplied Int    @default(0)
  issueCount Int      @default(0)
  detail     String?  @db.Text
  error      String?  @db.Text
}
```

`PlaybookRun` writes a row on **every** run including no-ops, exactly like
`IngestRun` and `AdAutomationRun`. Without heartbeat rows, "nothing drifted
this week" and "the sweep has been dead for three weeks" render identically.

Steps become typed handlers in a registry, each implementing `check()` /
`apply()` / `diff()`. Phase 0 ships only `check()`; Phase 1 fills in the other
two for the safe step types:

`audience.preset`, `flow.template`, `ad.automation_config`, `ad.launch_preset`,
`alert.rule`, `account.field`, `task.checklist`.

Every apply is idempotent via a stable step key per account — the same
discipline as `AlertRule.key` and `OemOfferSnapshot.fingerprint`. Apply runs in
**dry-run by default** and shows the diff before it writes, the way Ad Gen
shipped shadow mode before it wrote a row.

### Phase 2 — inherit / sync

Edit a playbook → every application on the prior version shows as behind →
push. Per-step `synced | detached`, where customising a step detaches it, so
there is no separate opt-out switch for anyone to get wrong.

This is the `template-sync.ts` model exactly. **Reuse it rather than inventing a
second one** — `resolveSyncState`, `isBehindTemplate`, and `classifyDocChange`
already encode the hard-won behaviour (a null state resolves to what the row
already did in practice, so it ships with no backfill).

### Phase 3 — event playbooks

Timed, multi-rooftop. "Apply Truck Month to these 11 Chevy stores" spins up an
Initiative, per-department tasks, ad drafts, and budget lines in one action,
with a start and an end date. This is where playbooks meet Projects, and it is
the one phase that should not start until Phases 1–2 are boring.

---

## 6. Traps in this codebase

Found while building Phase 0. Each one is a real constraint, not a style note.

- **`AdLaunchPreset` is `@@unique([accountKey, platform])`.** One preset per
  rooftop per platform. An event playbook that wants a different objective
  cannot add a second. Either relax the constraint or have event playbooks
  write a launch *override*, not a preset.
- **`metaPageId` is deliberately human-confirmed, never bulk-matched.** The
  schema comment spells out why: the wrong Page publishes a Ford store's ad
  from the Chevy store's Page, and it is invisible until someone spots it in
  the feed. So `task.checklist` — emit a ticket for a person — has to be a
  first-class step type. A playbook that can only automate will either skip
  this or do it wrong.
- **Lifecycle audiences are code constants guarded by a timestamp flag**, not
  records. An apply engine must fold `lifecyclePresetsSeededAt` into
  `PlaybookApplication` or it will double-seed.
- **`managedByBudget` defaults false.** A playbook that writes `BudgetLine`s
  moves no pacer number until that flips, and flipping it per rooftop is a real
  decision, not a sane default.
- **Co-op approval is scoped to `docHash`, not template id.** Swapping a
  template version silently invalidates every approval that pointed at the old
  design. `coop.template_approved` surfaces exactly this, and it is the check
  most likely to catch something real on day one.
- **`AdAutomationRun.accountKey` is nullable** — null means a global sweep. A
  freshness check that filters on `accountKey = X` will report every rooftop as
  stale even while the sweep runs nightly.

---

## 7. Status and open decisions

| Phase | State |
|---|---|
| 0 — coverage audit | **Built**, flag-gated, read-only |
| 1 — definition + apply | **Creative slice built** (§4b); the rest specified |
| 2 — inherit / sync | Specified |
| 3 — event playbooks | Specified |

Phase 0 needed none of the decisions below — a check is a check regardless of
how playbooks are eventually scoped. Phase 1 needs all three.

1. **Primary scope axis.** Is a playbook fundamentally per-OEM, per-department,
   or both crossed (Chevrolet × Service)? *Recommendation: both, as
   independent playbooks an account can hold several of — which is what Phase
   0 already models, since an account is audited against every playbook whose
   `appliesTo` it satisfies.*
2. **Authorship.** Agency-wide only, or can a group account define its own?
   *Recommendation: agency-wide for Phase 1. Group-level authorship needs the
   inheritance chain in §5 Phase 2 to be solid first.*
3. **Strictness.** Does drift get flagged, or can a rooftop be blocked from
   detaching? *Recommendation: flag only, permanently. A hard block turns every
   legitimate one-off into a support ticket, and the audit already makes drift
   visible — which was the actual problem.*

---

## 8. The companion offer email (built 2026-08-16)

The first piece of a playbook that *writes* rather than audits — though it lands
inside the ad generator rather than a `Playbook` row, because Phase 1 isn't
built. It closes the open half of
[ad-generator-campaign-launch.md](./ad-generator-campaign-launch.md) ("The
direction beyond this"): one OEM programme now produces ads **and** an email,
against the same offers, under one `Campaign` row.

### Shape

```
poll offers → generate ads → generate ONE draft email from the same offers
```

`generateAllAccounts()` calls `generateOfferEmail()` after each account's ads, in
its own try — an email that fails to build must never lose the ads that were
already generated and recorded.

| File | Role |
|---|---|
| `automation/offer-email-doc.ts` | PURE: offers → v2 `EmailTemplate`. No prisma, no network. |
| `automation/generate-offer-email.ts` | Orchestration: read creatives + snapshots, render, persist a draft. |

### Decisions, and why

- **One email per RUN, not per offer.** An OEM drop routinely covers six models;
  six sends to one dealer list is how a database gets burned. The featured
  offers are exactly the ones that produced ads, so the email can never
  advertise something the paid side isn't running.
- **Always a draft.** There is deliberately no `mode: 'ready'` counterpart. The
  ads' auto-publish path creates PAUSED campaigns; email has no pause, and a
  wrong send is permanent.
- **Content is the manufacturer's, verbatim.** `programName`, `description`,
  `offerDetails` and `eligibility` pass straight through from the MarketCheck
  payload, and the disclaimer is reproduced exactly as `resolveDisclaimerText`
  resolved it *for the ad*. Nothing is reworded by a model. Numbers come from
  the creative's own `AdData`, so the email cannot disagree with the ad beside
  it.
- **One disclaimer per offer**, not one per email — each programme has its own
  terms.
- **Idempotent on the offer SET.** `EmailBlast.automationKey` is
  `adgen:<accountKey>:<hash of sorted fingerprints>`, so re-running over
  unchanged offers updates the one draft; a new offer yields a new key and a new
  draft. Same discipline as `AdCreative.offerFingerprint`. A draft that has left
  the `draft` state is never rewritten — a person has scheduled or sent it.
- **Pre-targeted, or untargeted.** The draft is pointed at the configured
  `Audience`. An audience belonging to another account is *refused*, not
  used, and the draft lands untargeted — which cannot send, and is the safe
  failure.

### Traps found while building

- **Block props are the components' own names.** `text`, `url`, `bgColor` — not
  `content`, `href`, `backgroundColor`. A wrong key renders a structurally valid
  but **blank** block rather than erroring, so `offer-email-doc.test.ts` renders
  through react-email for real. Nothing short of rendering catches it.
- **`EmailBlast` has no `accountKey` column** — accounts live in an
  `accountKeys` JSON array, so it cannot be grouped by account. The audit's
  last-email lookup parses `automationKey` instead.
- **Branding is read WITHOUT the inheritance chain**, unlike `account.branding`
  in the audit. That is deliberate: `generate-ads` resolves the creative's
  colours the same way, and an email whose brand colour disagrees with its own
  ad is worse than one that inherits nothing.
- **A missing EVOX jellybean drops the image, not the offer.** `resolveJellybean`
  returns null wherever EVOX is unconfigured or coverage is missing (Accord and
  Civic 404 today) — an offer with real numbers is still worth sending.

### Settings

An **Offer email** block on the automation Settings tab: an on/off switch plus
audience, shell template, and max-offers. It sits in its own block below the ad
settings rather than as another cell in that grid — everything above configures
the ADS, and a customer-facing send sitting inline among render settings is too
easy to switch on without noticing.

The shell is chosen from **rendered cards, not a dropdown** — the same treatment
the ad design gets, and for the same reason: the thing being chosen is a picture,
and a list of names makes a wrong pick invisible until the send goes out. Every
card is the real email HTML in a sandboxed iframe, built with this account's
own offers, branding and disclaimers.

A shell with no `{{offers}}` block still renders — as ITSELF, with no offers in
it — under a "nothing would be sent" label. Hiding it would answer the question
"why isn't my template here?" with silence.

`previewOfferEmail` shares the document builders with the generator and nothing
else. It deliberately isn't `generateOfferEmail` in dry-run: that function needs
a completed run's ads, writes a Campaign and a blast, and refuses outright on
exactly the states a preview most needs to SHOW. When no ads exist yet it draws
the layout with **obvious placeholders** (`$XXX/mo`) rather than plausible fake
figures, and says so — someone will screenshot this.

Choosing no audience warns that drafts will need one picked by hand.

> **The trap.** `save_config` is a FULL REPLACE — every field the request omits
> is reset to its column default. The email settings therefore had to join
> `ScopeForm` and `toPayload`, or merely flipping the automation on/off switch
> (which re-posts the saved scope through the same function) would silently wipe
> them. `use-automation.test.ts` pins this for every field, not just today's.

### Not built

- **SMS.** The same offers could drive it and `Campaign` already aggregates
  `smsBlasts`, but it wasn't asked for.
- **A landing page to point at.** The CTA uses `Account.website`; Phase D of the
  campaign-launch doc is what would replace it.
