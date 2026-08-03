# Budget module — Oz Reports → Loomi Projects

Plan for moving client budgeting out of Oz Reports and into Loomi, so the Ad
Pacer paces against a **real budget** instead of a hand-typed goal, and so a
budget can be distributed at the moment work is requested.

Status: **Built** — ledger, hub, intake wiring, pacer binding, distribute, and
settlement. The manual retype is gone for any month switched to budget-managed,
and closed months settle themselves. See §5.

---

## 1. Where we stand

Two systems, joined by a human retyping a number.

```
Oz Reports (CodeIgniter, MySQL)          Loomi (Next, Postgres)
────────────────────────────────         ──────────────────────
account_budgets      ← the ledger
  × margin_rules     → payable $
  × monthly actuals  → pacing report
        │
        │  ← a person reads the number
        ▼
   Ads Manager  ←──────────────────────  MetaAdsPacerPeriodBudget
                    (typed twice)          .baseBudgetGoal   ← hand-typed
                                           .addedBudgetGoal  ← hand-typed
                                                  │
                                                  ▼
                                           the whole pacing engine
```

Loomi's pacer is the better engine by a wide margin (§3). Oz Reports has the
better number. Neither has the link between a budget and the work that spends
it — that link is what this module adds.

---

## 2. What Oz Reports does today

One ledger table, `account_budgets` (separate `budget` MySQL DB), plus five
layers on top. Core columns:

```
account_id, spend_account_id, category_id, channel_id, campaign_name,
make_id, for_year, for_month, budget, special_budget_id, bulk_entry_id,
rep_notes, deleted_on
```

| Layer | Where | What it does |
|---|---|---|
| Gross → payable | `BudgetService::getMargin/calcSpend` | `margin_rules[channel_id][account_id]`, account `999` = per-channel agency default. `payable = budget × (1 − margin)` |
| Pacing | `BudgetService::computePacingLine` | Walks Jan→month accumulating `carry = (payable + carry) − actual`. Bands ±5% green / ±10% amber / else red, direction-agnostic |
| Carryover | `annual_budget_rollover` | One January seed per `(year_from, channel_id, account_id)`; everything after is derived by the walk |
| Pool | `sbsPoolAdd` / `sbsPoolAllocate` / `sbsPoolReturn` | Money enters unassigned (`for_month = 0`), then unassigned → category → channel → month. Each move writes a `logBudgetMove` row |
| Billing | `billing_lines`, `upsertForBudget` | 1:1 sidecar to a budget row, edited independently. `buy_update_mode: 'billing-only' \| 'budget-too'` so fixing an invoice doesn't silently rewrite the plan |

Plus `adset_allocations` — Google-only distribution of a channel's payable down
to campaigns/ad groups, ceiling-checked against the sub-line payable.

**It never writes to a platform.** The only Google mutate in the codebase is
`mutateConversionActions`.

### Keep these five ideas

1. **`account_id` vs `spend_account_id`** — bill one rooftop, spend from
   another. Required for co-op and group buys. Loomi has no equivalent.
2. **Pool → progressive allocation** — hold budget at the top, assign it as
   work is requested. The single best idea in the system, and exactly the
   behavior we want.
3. **`bulk_entry_id`** — one UUID across every row from one submission, so a
   12-store × 6-month batch edits and deletes as a unit.
4. **Gross vs payable as a first-class split**, not a report-time calculation.
5. **The billing sidecar's independence** from the plan.

### Fix these

| Flaw | Consequence |
|---|---|
| No write-back to platforms | Plan and execution joined by manual retyping |
| No FK from budget to work | `campaign_name` is free text. "What did this $5k buy?" is unanswerable |
| Actuals are **emailed CSVs** (`GA_MTD.csv`, `Facebook_MTD.csv`, wiped/replaced per month — `Import.php:762`) | Month-grain only; no day-level history exists |
| `account_name` / `*_readable` denormalized onto every row | Rename a channel, history disagrees with itself |
| `rep_notes` is concatenated text | Audit trail unqueryable. Moves get a ledger; edits don't |
| `margin_rules` is current-state | Change a margin, every historical report silently changes |
| `for_month = 0` means "pool"; `$GOOGLE = 2` hardcoded in calc code | Magic values throughout |
| `Budget.php` (1,439 ln) + `BudgetV2.php` (6,086 ln) + three view generations | Three coexisting implementations |
| `account_budgets` + `budget_utilization`, identical shape | Planned vs used as separate rows, not states. They drift |
| Carryover is January-seeded only | Can't apply March's underspend to June |

---

## 3. What Loomi already has

More than half the hard part:

- `MetaAdsPacerDailySpend` — per-day, per-object spend, with the daily budget
  in effect that day preserved across re-pulls.
- `MetaAdsPacerCarryoverApplication` — explicit ledger of arbitrary
  source-month → target-month applications. Strictly better than a Jan seed.
- `MetaAdsPacerMonthSnapshot` — immutable month freeze with reopen.
- `MetaAdsPacerAuditEntry` — typed, queryable, `groupId`-linked.
- [`markup.ts`](../src/lib/ad-pacer/markup.ts) — **one** markup lookup, **one**
  target formula (`effectiveSpendTarget`), and an unconfigured markup surfaces
  as a broken $0 rather than a plausible default.
- Two distinct pacing engines (Meta rolling-7-day + empirical overage
  allowance; Google monthly ceiling with mid-month reproration).
- **Both push paths exist** — `/api/meta-ads-pacer/[k]/push-budget`,
  `/api/google-ads-pacer/[k]/push-budget`.
- Daily 14:00 UTC scan (`meta-pacer-alerts.yml`) that pre-syncs fresh spend for
  every linked account before evaluating alerts.
- Projects: Initiative / Task / Team / TaskComment / TaskActivity, board +
  table + calendar + my-work, multi-account multi-department intake,
  launch-into-tool, linked-asset reconciliation.
- `dealer_map.loomi_account_key` already maps Oz Reports accounts to Loomi.

**The gap this module closed:** budget used to live as loose JSON in
`Task.details` — `budget`, `mailerBudget`, `radioBudget`, `tvBudget`,
`sponsorshipAmount`, `videoBudget`. Six unrelated number fields with no ledger
behind them, nothing able to sum or trace them. Removed in Phase 2; money is
now `BudgetLine` rows.

**Closed in Phase 3:** the pacer's `baseBudgetGoal` / `addedBudgetGoal` were
hand-typed. `syncPeriodBudgetFromLines` now writes them from the ledger for any
month opted into budget management, the pacer UI locks the inputs, and the save
route rejects a direct write with `409 budget_managed`.

---

## 4. Design

One money primitive. Not a port of `account_budgets` — a Loomi-native model
carrying the five good ideas.

### Principles

1. **One-way flow.** Budget owns *intent*; the pacer owns *execution*. Budget
   writes into `MetaAdsPacerPeriodBudget`; the pacer never writes back.
   Actuals flow back for display only. The moment this is bidirectional there
   are two sources of truth.
2. **`BudgetLine` is the only place a media dollar lives.** No budget fields in
   `Task.details`.
3. **Snapshot, don't derive.** Markup is frozen on the line at creation.
   History stops moving.
4. **No magic values.** Nullable columns for "unassigned", channel keys from a
   constants module, no hardcoded IDs in calc code — the discipline
   `markup.ts` already states.

### Models

Four models, in [`prisma/schema.prisma`](../prisma/schema.prisma) — the schema
is the source of truth and carries the full field-by-field commentary; this is
the shape and the reasoning.

| Model | Role |
|---|---|
| `ClientAgreement` | **What the client signed**, with real term dates. Total commitment + optional markup override. A year's target is *derived* from the term, not stored per year. Replaced the year-keyed `BudgetPlan` in Phase B — see §9. |
| `AgreementFee` | A recurring monthly charge inside a term, on a specific channel. Replaced `BudgetPlan.monthlyRetainer`, which was one unnamed number with no channel. |
| `BudgetLine` | **The ledger.** Every media dollar is one row. |
| `BudgetLineEvent` | Typed, queryable audit. Replaces both `rep_notes` string concatenation and the separate `logBudgetMove` table. |

`BudgetLine`'s load-bearing columns:

- **`accountKey` + `spendAccountKey`** — billed to vs spent from
  (oz-reports' `account_id` / `spend_account_id`). Equal in the ordinary case.
  The pacer rollup keys off `spendAccountKey`; billing keys off `accountKey`.
- **`year`** — always set, *including on pool lines*. A pool line has no period,
  so nothing else anchors it to a calendar year. When `period` is set the two
  must agree; `resolveYear` enforces it on every write.
- **`agreementId`** — which agreement this money draws against, when it draws
  against one. Nullable: plenty of spend is ad-hoc, and every line imported from
  Oz Reports predates the concept.
- **`period` + `channel`** — the two allocation axes. Both null = still in the
  pool. (oz-reports overloaded `for_month = 0`; nullable columns say it
  honestly and keep the index story clean.)
- **`amount`** — `Decimal @db.Decimal(12,2)`. Deliberately *not* the `String`
  the pacer money fields use: those mirror form input, this is a ledger that
  gets summed and compared against ceilings.
- **`markupSnapshot`** — the gross→spend factor frozen at creation. Resolved
  once, never re-derived, so changing an account's markup cannot rewrite last
  quarter's targets.
- **`source`** (`retainer | task | adhoc | pool`) and **`bucket`**
  (`base | added`) — bucket defaults from source but is stored and overridable.
- **`status`** (`planned | committed | live | settled | canceled`) — only
  `committed`/`live`/`settled` count against the pool.
- **`initiativeId` / `taskId`** — the link oz-reports never had.
- **`batchId`** — oz-reports' `bulk_entry_id`. One UUID across a whole
  submission, so a 12-store × 6-month fan-out edits and releases as a unit.

Relations were added to `Account` (billed + spend, named), `Initiative`, `Task`,
and `User` (event author).

### Channel constants

New `src/lib/budget/channels.ts`, in the shape of
[`ad-pacer/constants.ts`](../src/lib/ad-pacer/constants.ts). No IDs, no
literals in calc code:

```ts
export const BUDGET_CHANNELS = [
  { key: 'meta',      label: 'Meta',           category: 'Digital',     pacer: 'meta'   },
  { key: 'google',    label: 'Google Search',  category: 'Digital',     pacer: 'google' },
  { key: 'youtube',   label: 'YouTube',        category: 'Digital',     pacer: 'google' },
  { key: 'ott',       label: 'OTT / CTV',      category: 'Digital'      },
  { key: 'email_sms', label: 'Email / SMS',    category: 'Digital'      },
  { key: 'radio',     label: 'Radio',          category: 'Traditional'  },
  { key: 'tv',        label: 'TV',             category: 'Traditional'  },
  { key: 'billboard', label: 'Billboard',      category: 'Traditional'  },
  { key: 'print',     label: 'Print / Mailer', category: 'Traditional'  },
  { key: 'video',     label: 'Video / Photo',  category: 'Production'   },
  { key: 'pr',        label: 'PR / Sponsorship', category: 'Other'      },
] as const;
```

A channel with a `pacer` key is one the module can bind and push. Everything
else settles manually.

### Pacer binding

The one write path, `syncPeriodBudgetFromLines(spendAccountKey, period, platform)`:

```
Σ BudgetLine.amount
  WHERE spendAccountKey = ?
    AND period = ?
    AND channel.pacer = platform
    AND status IN ('committed', 'live')
    AND archivedAt IS NULL
  GROUP BY bucket
        │
        ▼
MetaAdsPacerPeriodBudget
  .baseBudgetGoal   ← Σ bucket='base'    (or .googleBaseBudgetGoal)
  .addedBudgetGoal  ← Σ bucket='added'   (or .googleAddedBudgetGoal)
        │
        ▼
effectiveSpendTarget(clientBudget, markup, appliedIn)   ← unchanged
```

`base` / `added` already means retainer vs add-on in the pacer, so the mapping
is free. Called on line create / edit / status change, and once from a
backfill. Skipped when the month is frozen (`isPeriodWritable`).

Below the period budget, allocation across pacer ad rows stays manual, with a
"distribute remaining" action that pre-fills — the equivalent of
`adset_allocations`, but on both platforms and with a real push behind it.

#### Who owns the number (settled)

Today the Meta and Google specialists type `baseBudgetGoal` / `addedBudgetGoal`
themselves. Budget management takes that over, so the handoff is explicit
rather than silent:

- **Managed is per-account opt-in**, carried on a `managedByBudget` flag —
  never inferred from "this month has lines." Inference breaks on a
  legitimately $0 month: it would read as unmanaged and quietly show a stale
  typed number. Opt-in is also what makes the year of parallel running with Oz
  Reports survivable, since most accounts won't have lines yet.
- **When managed, the goal fields go read-only** with a "managed by budget"
  badge, plus a per-month **unmanage** action that hands control back to the
  specialist and is logged to the audit trail. Locked-with-an-escape rather
  than locked-shut: a wrong budget line must never leave a specialist unable to
  act while a client waits.
- **Changes propagate immediately**, with an audit entry — no confirmation
  queue. A queue would mean the pacer knowingly paces against a number everyone
  already agrees is wrong.
- **Frozen months are never written.** `isPeriodWritable` already gates this.

Unmanaging is a per-(plan, period, platform) decision, so a Meta specialist
taking manual control of one month doesn't affect Google or any other month.

---

## 5. Phasing

| Phase | Scope | Status |
|---|---|---|
| **1 — Ledger** | The three models, channel registry, service layer, API | **Built** |
| **1b — Hub UI** | Per-account annual view: declared total, retainer generator, pool, lines by channel × month, allocate-from-pool | **Built** |
| **2 — Intake wiring** | Intake creates `BudgetLine`s; live remaining shown in the form; the six `Task.details` budget fields removed | **Built** |
| **3 — Pacer binding** | `syncPeriodBudgetFromLines` writes the goal pair; per-platform opt-in; UI locks + unmanage; save route guarded | **Built** |
| **3b — Distribute to ads** | "Spread the remaining across N unallocated ads" on the pacer's Base/Added cards (the `adset_allocations` equivalent, both platforms) | **Built** |
| **4 — Settlement** | Closed months settle from synced spend on the daily scan; non-platform by hand | **Built** |
| **A — Line type + cost** | `lineType` on every line and channel; `cost` for resold services; margin per line type in the hub | **Built** |
| **B — Agreements** | `ClientAgreement` + `AgreementFee` with real term dates; year targets pro-rated from the term | **Built** |
| **C — Flights** | A media buy entered as a date range; the monthly lines derived and day-weighted | **Built** |

### What exists

| File | What |
|---|---|
| [`prisma/schema.prisma`](../prisma/schema.prisma) | `ClientAgreement`, `AgreementFee`, `BudgetLine`, `BudgetLineEvent` + relations |
| [`src/lib/budget/channels.ts`](../src/lib/budget/channels.ts) | The channel registry + pacer-platform mapping |
| [`src/lib/budget/period.ts`](../src/lib/budget/period.ts) | Period helpers + `resolveYear` (the year/period invariant). Prisma-free so routes can validate without pulling in a DB client |
| [`src/lib/budget/term.ts`](../src/lib/budget/term.ts) | Agreement term arithmetic — `termMonths`, `monthsInYear`, `commitmentForYear`. Prisma-free, so the pro-rating that decides a client's target is unit-tested without a database |
| [`src/lib/budget/flight.ts`](../src/lib/budget/flight.ts) | Flight splitting — `flightMonths`, `splitFlight`. Day-weighted, exact to the cent. Prisma-free, so the modal previews with the same code the server writes with |
| [`src/lib/services/budget.ts`](../src/lib/services/budget.ts) | Agreement CRUD, create / allocate / return-to-pool / settle, rollups, `getPacerBudgetGoals`, fee-line generation |
| `src/app/api/budget/*` | `summary`, `agreements`, `agreements/[id]` (+`?generate=YYYY`), `flights`, `flights/[id]`, `categorize`, `lines`, `lines/[id]`, `lines/[id]/allocate`, `lines/[id]/settle`, `settle-period` |
| [`src/lib/budget/settlement.ts`](../src/lib/budget/settlement.ts) | Attribution math — exact-summing largest-remainder split, variance, attainment |
| `src/app/app/projects/budget` + `_components/budget-*` | The hub, agreement modal, categorize modal, add-line modal, line drawer |
| `api/meta-ads-pacer/[k]/budget-managed` | GET state / POST manage-unmanage, per platform |
| [`src/lib/projects/ui.ts`](../src/lib/projects/ui.ts) | `KIND_BUDGET_CHANNELS` — which channels each task Type can spend on |
| `createTicket` in [`services/projects.ts`](../src/lib/services/projects.ts) | Turns a ticket's requested budget into lines |
| [`scripts/migrate-budget-plans-to-agreements.ts`](../scripts/migrate-budget-plans-to-agreements.ts) | Deploy precursor: carries `BudgetPlan` rows into agreements and drops the table, because `db push` runs without `--accept-data-loss` and would otherwise fail the whole push |

Tests: `budget/period.test.ts`, `budget/channels.test.ts`, `budget/term.test.ts`,
`budget/flight.test.ts` and `budget/settlement.test.ts` run always (71 cases);
`services/budget.db.test.ts` (72 cases — ledger arithmetic, agreements, flights,
categorizing, the pacer binding, settlement) self-skips unless `RUN_DB_TESTS=1`,
matching `loomi-flows.db.test.ts`.

### Settlement as built

Replaces oz-reports' `budget_utilization` — a second table mirroring the budget
table's shape, which drifted from it. Here it's a state transition plus two
fields on the line the money already lives on.

- **`actualAmount` is in SPEND dollars**, same units as `spendTarget`, not
  client gross. It arrives as spend from the platform (or a human); grossing it
  back up through a markup would invent precision it doesn't have.
- **Attribution.** A month has N budget lines on a platform and M pacer ads,
  with no one-to-one mapping. The pacer does know actual per BUCKET (each ad's
  `budgetSource`), so settlement splits base/added first, then distributes each
  bucket's actual across its own lines in proportion to spend target.
- **Exact to the cent.** `distributeActual` uses largest-remainder in integer
  cents, so the parts sum to the total. A settlement report that doesn't
  reconcile to the penny is one nobody trusts.
- **Orphan spend is reported, not hidden.** Actual in a bucket with no line
  behind it usually means an ad was pointed at a budget source nothing funded —
  it comes back as `orphaned` rather than being folded into the other bucket.
- **Closed months only** (past the pacer's grace window) unless forced —
  settling a live month freezes a number that's still moving.
- **Re-running is safe.** Already-settled lines are skipped, which is what lets
  the daily scan just try everything in its lookback window.
- **Runs after the spend pre-sync** in the daily scan, never before. Ordering
  matters: settling first would freeze yesterday's numbers.
- **Settled money still counts against the year.** Closing a month must not
  make the budget vanish from the rollup — the client still paid it.
- **Reopening clears the actual.** Leaving it on a line that no longer claims to
  be settled would orphan the number in every rollup that reads it.

### Pacer binding as built

- **Opt-in per account, per platform, per month** — `managedByBudget` /
  `googleManagedByBudget` on `MetaAdsPacerPeriodBudget`. Lines existing is not
  consent; nothing is taken over until someone switches it on.
- **Managing syncs immediately**, so the inputs never sit locked showing a
  stale hand-typed figure. **Unmanaging leaves the last synced value** for the
  specialist to edit from.
- **A managed month with no lines writes $0**, not null. A real zero, not
  "unset" — the alternative is a locked field showing a number the ledger
  disagrees with.
- **Both sides of a move re-sync.** Editing a line's period or channel syncs the
  placement it left as well as the one it landed on; syncing only the
  destination would leave the old month still claiming money that moved.
- **Cross-account lines pace on the SPEND account.** A co-op line billed to a
  group but spending from a rooftop writes into the rooftop's plan, while the
  account summary still bills it to the group.
- **Sync never throws.** The ledger write already succeeded and is the source of
  truth; a briefly-stale pacer is recoverable (any later edit re-syncs it),
  whereas failing the budget write would lose it.
- **Frozen months are skipped**, and the save route returns `409 budget_managed`
  if a stale tab or direct API call tries to CHANGE a managed goal — rather than
  accepting it and letting the next sync silently revert it. The guard compares
  **values, not key presence**: the planner's autosave always spreads the
  current goals in alongside the ads, so rejecting on presence 409'd every ad
  edit on a managed month and the client swallowed it. Pinned by a regression
  test.

#### Distributing to ads (§3b)

The Base/Added cards in the pacer offer "Spread $X across N unallocated ads":

- **Evenly, not weighted.** Any weighting (flight length, last month's spend) is
  a guess the specialist can't see, and this is a starting point they adjust.
  Uses the same exact-to-the-cent `splitToCents` as settlement.
- **Skips finished rows** (`Completed Run`, `Off`) — funding those just hides
  the money. Drafts and scheduled ads are fair game; allocating ahead of launch
  is the normal case.
- **Skips `split` ads.** Their allocation spans both pools, so writing one from
  a single pool's remaining would silently move the other's.
- **Only offered when it would do something** — there's remaining to spread and
  somewhere to put it.

### Intake behavior as built

- Money is collected **per (Type, channel)** — one input per channel the Type
  can spend on, driven by `KIND_BUDGET_CHANNELS`. The six ad-hoc `Task.details`
  number fields are gone.
- Amounts are **per account.** A $1,000 ads request across three dealers creates
  three $1,000 lines. A shared creative still collapses to one task, but each
  account gets its own line pointing at it — money follows the accounts, the
  creative doesn't.
- Lines are created **`committed`**, not `planned`. Filing a funded ticket *is*
  the commitment; anything less would leave the remaining-budget figure the rep
  just read on that same form understating what's spoken for. Releasing it is an
  explicit action.
- The budget month defaults to the due date's month and follows it until the rep
  overrides it by hand.
- Budget failure is **non-fatal**: the tickets are the primary artifact, so a
  line that fails to write is reported back as `budgetError` and surfaced as a
  toast rather than rolling back the ticket.
- Lines are created **fresh**, not drawn from an existing pool line. Pool draw-down
  is the explicit `allocate` action in the hub. Intake filing past the declared
  total is what the over-allocation warning is for.

---

## 6. Migration from Oz Reports

**Built.** One-way push from the Oz Reports host into a Loomi ingest endpoint —
same shape as the contact sync, and for the same reason: the budget tables and
the `dealer_map.loomi_account_key` mapping both live there.

```
Oz Reports host                              Loomi
───────────────                              ─────
account_budgets  ┐
margin_rules     ├─► GET /loomi/pushbudgets ─► POST /api/ingest/budget-lines
special_budgets  │   (Loomi.php, Bearer secret)        │
dealer_map       ┘   ?dry_run=1 ?dealer=KEY ?year=N     ▼
                     ?deleted=1                     BudgetLine upsert
```

### What the source looks like (2026-07 snapshot)

| | |
|---|---|
| Live lines | 8,097 |
| Total budget | $11,403,231.54 |
| Accounts with budget | 44 (**38 mapped** to Loomi) |
| Years | 2025 – 2027 |
| Pool lines (`for_month = 0`) | 4 |
| Cross-account lines | 206 |
| Soft-deleted rows | ~3,600 |

**About half the money isn't media.** Contribution, Data Feed, Managed
Marketing Services, Lead Provider, Management Fee and friends account for
roughly $5.7M of the $11.4M. That's why `BUDGET_CHANNELS` mirrors all 44 Oz
channels rather than the media-only set the module started with: a hub showing
half a client's budget is worse than one showing none, because the first time
anyone reconciles against Oz Reports the number stops being trusted.

### Mapping

| Oz Reports | Loomi | Note |
|---|---|---|
| `account_budgets.id` | `externalId` = `ozreports:account_budgets:<id>` | Unique — makes the import an upsert |
| `account_id` → `loomi_account_key` | `accountKey` | Unmapped accounts are skipped and named |
| `spend_account_id` → key | `spendAccountKey` | A co-op line whose SPEND side is unmapped is skipped, never guessed |
| `budget` | `amount` | Client gross, exact |
| `margin_rules[ch][acct]`, 999 fallback | `markupSnapshot` = `1 − margin` | Resolved on the Oz side; see the caveat |
| `for_year` + `for_month` | `year` + `period` | `for_month = 0` → pool line (period null) |
| `channel_id` | channel key via `ozIds` | Ids 30 + 40 (both "Management Fee") collapse to one |
| `bulk_entry_id` | `batchId` | |
| `campaign_name`, else special budget name | `label` | |

### Decisions

- **Live rows only.** Soft-deleted rows aren't imported. `?deleted=1` sends
  their ids so lines imported earlier get retired — without it a dual-run
  leaks, since a deleted row simply stops appearing in the push.
- **Unmapped is reported, never guessed.** An Oz channel with no Loomi home,
  or an account with no key, comes back with its line count and dollar weight.
  Guessing a home is how money quietly lands in the wrong place.
- **`channel_id = 0` exists** — 3 live lines, $120,000. It has no channel and
  is reported like any other gap.
- **Margins have no history.** `margin_rules` is current-state only, so a 2025
  line gets today's margin and its spend target is an approximation. The gross
  figures are exact. (An earlier draft of this doc said to resolve the margin
  "at the row's own date" — that isn't possible.)
- **`budget_utilization` is not imported.** It's in gross dollars while
  `actualAmount` is spend dollars; settlement rebuilds actuals from the pacer
  instead of converting through an already-approximate markup.

### Running it

```
# See what would happen — writes nothing on either side
GET /loomi/pushbudgets?dry_run=1

# One dealer, one year, to sanity-check the shape
GET /loomi/pushbudgets?dealer=youngHondaOgden&year=2026

# The real thing, including retirement of deleted rows
GET /loomi/pushbudgets?deleted=1
```

Idempotent — re-run as often as you like. The response summarises rows sent,
created/updated/archived, unmapped dealers by name, and unmapped channels with
their dollar weight.

## 7. Deliberately out of scope for v1

- **Billing / invoicing.** `billing_lines`, departments, taxable flags,
  commission reports, mark-billed locking. A separate product surface;
  including it roughly doubles the work. `BudgetLine` leaves room for a
  sidecar later.
- **`make_id`.** Automotive-specific. `Account.oem` / `oems` covers it if needed.
- **A second pacing engine.** Loomi's is better than Oz Reports'. The budget
  module produces a target and stops.

---

## 8. Open questions

**Settled:**

- **Per-channel markup.** `resolveMarkup` walks `ClientAgreement.defaultMarkup` →
  `Account.markup` → agency default, and any line can carry a hand-entered
  `markup` override (a radio buy whose margin differs from the account's digital
  rate). Because the factor is snapshotted per line, a `BudgetChannelMarkup`
  table can be added later without touching history.
- **Pacer goal fields when managed.** Read-only with a **per-month unmanage**
  escape hatch, and **managed is per-account opt-in** via a `managedByBudget`
  flag — never inferred from line presence. Full reasoning in §4 "Who owns the
  number". Phase 3 is unblocked.
- **Pool enforcement.** Warn, don't block. `getAccountSummary` returns
  `overAllocated` and the intake form shows how far over a request puts the
  account, but nothing refuses the submit. One place a hard error *does* apply:
  you cannot allocate more than a **source line** holds — that's arithmetic,
  not policy.
- **Multi-account lines.** One line per account, sharing a `batchId`.
- **Who can edit.** `MANAGEMENT_ROLES`, same as the rest of Projects, noted at
  the top of `api/budget/lines/route.ts`. Narrowing to a budget-admin role is a
  one-line change there.

**Still open:**

- **Cross-account line visibility.** A line billed to A but spending from B is
  scoped on `accountKey` for reads, so a user who can see only B won't see it in
  B's list even though it paces there. Fine while everyone filing budget can see
  all accounts; needs revisiting if scoping tightens.
- **`ads` intake channels.** The old free-text `channels` multiselect offered
  TikTok and KSL, which have no budget channel. They're dropped from the budget
  block (a Type's channels come from `KIND_BUDGET_CHANNELS`); if those become
  real spend channels they need registry entries.

---

## 9. The agreement layer (Phase B)

### Why the year-keyed plan had to go

`BudgetPlan` was one row per account per calendar year: a declared total, a
monthly retainer, an optional markup. It came straight from Oz Reports, where
budgeting *is* a calendar year, and it was wrong in a way that only shows up
once real contracts are in the system:

- **Almost nobody signs a January–December agreement.** A term starting in April
  belongs to two calendar years. Under a year-keyed plan it either got filed
  under one year and understated the other, or got split into two plans nobody
  kept in sync. Neither reconciles against anything.
- **One unnamed retainer number.** `monthlyRetainer` had no channel, so
  generating lines from it needed the user to pick a channel *at generation
  time* — a decision that belongs to the agreement, not to a button. Clients
  with two recurring fees (a managed-service fee and a separate management fee,
  which is common) couldn't be modelled at all.
- **No renewal.** A plan replaced last year's plan. There was no way to hold a
  signed renewal alongside the term it renews, which is exactly when someone
  wants to look at both.

Every commercial platform that does this — the agency-management tools this is
being measured against — models the *contract*, not the fiscal year, and derives
periods from it. That's the change.

### The model

| | |
|---|---|
| `ClientAgreement` | `startDate` / `endDate` as real dates, a total `committedAmount` for the whole term, `status`, an optional `defaultMarkup`, `archivedAt` |
| `AgreementFee` | Zero or more recurring monthly charges, each on a **specific channel** |
| `BudgetLine.agreementId` | Which agreement a line draws against. Nullable — ad-hoc spend and every Oz Reports import have none |

A year's target is **derived**, never stored:
`commitmentForYear = committedAmount × monthsInYear / termMonths`.

**Pro-rated by months, not days.** Budget is planned, spent and billed monthly,
so a term starting on 17 March is a March month. Counting 15/31 of it would
produce a year target that reconciles against nothing, because the ledger
underneath it only ever contains whole months. The arithmetic lives in
[`src/lib/budget/term.ts`](../src/lib/budget/term.ts), Prisma-free, and the
property that matters is pinned by test: **a term's yearly shares sum back to
the whole commitment.** If they didn't, a year of someone's money would vanish
at the calendar boundary.

`getAccountSummary`'s `declaredTotal` is now the sum of every active agreement's
share of the year, and stays `null` — not `0` — when no agreement carries a
committed figure. Null means "we haven't been told"; zero would read as "they
committed nothing" and put every account instantly over budget.

### Laying out the year

`generateAgreementFeeLines(agreementId, year)` creates one line per fee per
month **of the term that falls in that year** — nine lines for an April–March
term in its first year, three in its second. It skips
`(channel, period)` pairs that already exist, so it's safe to re-run; that's the
same idempotency rule the retainer generator had, now keyed on the agreement.

### Migration

Existing plans were carried across, not dropped: each became an agreement
spanning Jan 1 – Dec 31 of its year (which is exactly what the row meant), and a
`monthlyRetainer` became an `AgreementFee` on `managed_marketing_services` —
what that money almost always was.

This runs as a **deploy precursor**
([`scripts/migrate-budget-plans-to-agreements.ts`](../scripts/migrate-budget-plans-to-agreements.ts)),
before `db push`, for the same reason
`ensure-budgetline-external-id-unique` exists: `db push` runs without
`--accept-data-loss` and refuses to drop a table with rows in it, failing the
*entire* push so the new columns never land either. Verified by reproducing the
pre-Phase-B schema locally — `db push` alone errors with
"about to drop the `BudgetPlan` table, which is not empty (2 rows)"; with the
precursor it migrates both rows and pushes clean. Adding `--accept-data-loss`
to the deploy would have fixed it once and then silently dropped columns on
every future schema change.

### Drawdown

`BudgetLine.agreementId` is set automatically: a line placed in a month links to
the agreement covering that month, and creating an agreement adopts the unlinked
lines already sitting inside its term (budget is usually entered before the
paperwork, and a new agreement reading 0% drawn while the year is visibly full
of its money makes the number look broken).

**Ambiguity means no link.** When two terms overlap a month — a renewal signed
before the old one expires, which is how renewals normally happen — nothing is
guessed. Attaching to the wrong one silently overstates that agreement's
drawdown, and the drawdown is the whole point of the link. A wrongly linked line
looks correct; an unlinked one is visibly unlinked. Pool lines are never linked
either: money with no month hasn't been committed to anything yet.

Adoption never re-points a line that already has an agreement.

`listAgreements` returns `booked` per agreement — committed/live/settled lines
in the year viewed — which the hub shows as a percentage and a bar.

### Still to do

- Nothing outstanding on the agreement layer.

---

## 10. Flights (Phase C)

A media buy is one commercial fact — one insertion order, one total, one date
range — and the ledger is at month grain. So a buy running 20 March – 10 May was
three rows, with the split done in somebody's head, and every time the flight
moved or the total changed all three had to be found and corrected together.
Nobody does that reliably, and the failure is silent: the parts stop adding up
to the buy and nothing says so.

### Month grain stays the ledger's unit

The tempting model is one row with a date range and the months derived at read
time. It was rejected: every rollup, the pacer binding and settlement all assume
a line sits in exactly one month, and "half-settled" has no meaning. A flight is
therefore **N linked rows** — `flightId` groups them, `flightStart`/`flightEnd`
are copied onto each so a row can say what buy it belongs to without a join.
The flight is the *authoring* concept above the ledger, not a replacement for it.

### Split by days, not months

This is deliberately the opposite rule from an agreement's commitment (§9).

| | Weighted by | Because |
|---|---|---|
| Agreement commitment | whole **months** | it's *billed* monthly — a term starting on the 17th still owes a full March |
| Media flight | **days** | it *spends* daily — 12 days of March is 12 days of impressions |

Giving March a full share of a 20 Mar – 10 May buy would overstate its pacing
target by roughly a factor of two and understate April's. Shares are exact to
the cent via the same largest-remainder `splitToCents` settlement uses, because
a buy whose monthly lines total two cents under the insertion order is one
somebody has to chase.

A flight crossing the new year is ordinary and supported — each month's line
carries its own year, which `resolveYear` already enforces per row.

### Editing: settled months are never rewritten

`updateFlight` re-splits when the dates move or the total changes, with one
hard rule: **a settled month keeps its money.** It has a recorded actual and has
been reported on; re-splitting it because a later month moved would change
history to fix the future. Settled amounts come off the top and only the
remainder spreads over the months still open, so the buy still adds up while
what's closed stays closed. A new total below what settled months already hold
is refused rather than silently clamped.

A month that falls outside a shortened range is **canceled, not deleted** —
canceled money is excluded from every rollup but the trail survives.

### The preview is the same code

The add-line modal computes the month split locally with `splitFlight`, the
exact function the server writes with. No round trip, the months update as the
dates are typed, and what you see before saving is what gets written. That's
only possible because the math has no Prisma in it.

---

## 11. Categorizing what the import left untyped

Oz Reports had no concept of what KIND of money a line was, so 1,464 imported
lines / **$963,126** came across as `unclassified`. Until a line has a type its
margin is *unknown* rather than zero — which is the honest answer, and a useless
one. This is the machinery for resolving it.

### Two different problems

Breaking the backlog down by channel makes clear it isn't one job:

| Channel | Lines | Amount | Who decides |
|---|---|---|---|
| Other | 738 | $460,608 | **per line** — the name says nothing |
| YAG | 335 | $55,308 | per channel |
| Referral | 303 | $21,837 | per channel |
| Group Sale | 77 | $139,672 | per channel |
| Sponsorship | 6 | $171,000 | per channel |
| Store Event/Sale | 4 | $14,701 | per channel |
| Auxiliary | 1 | $100,000 | per channel |

**The per-channel ones need no new code.** "YAG is a fee" is true everywhere, so
the fix is a one-line edit to that channel's registry entry in
[`channels.ts`](../src/lib/budget/channels.ts) — and
[`backfill-budget-line-type.ts`](../scripts/backfill-budget-line-type.ts), which
already runs on every deploy, applies it across the whole book automatically.
That's a decision waiting on a human, not a feature waiting on a build.

**"Other" is the real work** — 738 lines whose only clue is their label.

### What was built

- **Per line** — the drawer now edits `lineType` and, for the types where cost
  isn't derivable (service, production, unclassified), the actual cost, with the
  resulting revenue and margin shown live. Both were added in Phase A with no
  way to set either, which is why the margin figures couldn't become real.
- **Per channel** — `categorizeChannel` types every still-untyped line on a
  channel at once, surfaced as a "Categorize $X" action next to the uncosted
  warning in the hub.

### It can only fill blanks

`categorizeChannel` touches lines still marked `unclassified` and nothing else.
A type someone set by hand in the drawer is a decision, and one click of a bulk
action should never be able to undo a morning of careful per-line work. That
also makes it idempotent and safe to re-run.

Every line it touches gets its own audit event. A type change moves the margin,
and "who decided this was a fee" is a question that gets asked.

---

## 12. Wording

The UI and the code deliberately use different words in two places. Both are
worth knowing before renaming anything.

| Code / API | UI says | Why |
|---|---|---|
| `ClientAgreement` | **Contract** | "Agreement" tested badly — it reads as something softer than a signed commitment. The model name stays: renaming it is churn across the schema, the service, three routes and 80 tests for zero user benefit. |
| `declaredTotal` | **Total budget** | It's the pot, and that's what people call it. |
| `totalCommitted` | **Planned** | Everything that counts toward the year: scheduled + pool. |
| status `planned` | **Draft** | The Planned *card* counts committed money, so a *status* called Planned that the Planned card excludes is a collision nobody stops tripping over. Only the label changed; the stored value is still `planned`. |

### Base and added

`BudgetLine.bucket` splits money into **base** (the client's standing budget)
and **added** (anything requested on top). It's the division the Ad Pacer
consumes — the two go into separate goal fields — and for a long time it was
computed inside the pacer sync and displayed nowhere, so the hub couldn't
explain a number the pacer was acting on. `getAccountSummary` now returns
`baseTotal` / `addedTotal` and the hub shows both under the progress bar.

Note this is a *different* decomposition from scheduled/pool, over the same
total: base + added = scheduled + pool = `totalCommitted`. They answer different
questions (what kind of budget is it, versus has it been placed yet), which is
why they're two rows rather than one bar.

---

## 12. Rate cards

Until this existed the agency had ONE markup and it was Digital's. Every radio
buy, swag order and print run costed out at a 23% margin because 0.77 was the
only number the system had.

Each **billing category** now carries its own rate:

| Category | Margin | Cost factor | Channels |
|---|---|---|---|
| Digital | 23% | 0.77 | Google, Meta, YouTube, CTV/OTT |
| Mass Media | 15% | 0.85 | KSL, TV, Billboard, Radio, Shipping |
| PR | 20% | 0.80 | Dashboard Post, Brandview Article, Scripts, PR |
| Swag | 30% | 0.70 | Swag, Sunglasses, Shirts, Candy, Toys, Coozie |
| Print, Xtreme & Event | 20% | 0.80 | Print/Mailer, Flyers, Posters, Postage |
| Production | 20% | 0.80 | Videos, Content Management, Editing, Production |
| Development | 20% | 0.80 | Email, Text/SMS, Landing Page |

Rates are **configurable** in Settings → Markup, stored one `AppSetting` row per
category. The values above are only the seed — a rate that lives in code can't
be corrected without a deploy, and this is a number the finance side owns.

### Billing category is NOT display category

`BudgetChannel.billing` is a separate axis from `category`, and they diverge on
purpose. KSL shows under **Digital** in the hub because that's where a rep looks
for it, and bills at the **Mass Media** rate. Email and SMS show under Digital
and bill as Development. Collapsing the two axes would force one of those to be
wrong.

### Resolution order

    1. the line's explicit markup       — a one-off
    2. the budget's override            — negotiated for this deal
    3. the account's override           — negotiated with this client
    4. the channel's RATE CARD          — the agency's standard price
    5. the agency default               — everything else

The rate card sits *below* the account override deliberately: an override is a
rate somebody negotiated with a named client and should beat the standard price
list. The trade-off worth knowing is that an account override applies to
**everything** — set one because a client gets a better digital rate and their
swag silently moves to that rate too. No account carries one today (0 of 36), so
the rate cards are what actually price the book.

A channel with **no** rate card falls through to the account/agency default,
which is exactly what every channel did before rate cards existed — so an
unassigned channel never changes behaviour by being unassigned. The Settings tab
lists them rather than hiding them, because that fallback is the one-size-fits-
all pricing this feature exists to replace.

### Cost derivation changed with it

`effectiveCost` used to apply the markup **only to media**, and that was right
when the single rate was Digital's — applying 0.77 to a swag order would have
invented a number. Now every category carries a real rate, so:

    stored cost   → what a vendor invoiced. Always wins.
    fee           → 0. Agency revenue, no external cost.
    unclassified  → null. Nobody has said what this money IS, so its rate
                    is meaningless even though one is stamped on the line.
    otherwise     → amount × markup, the rate card for that kind of work.

Service and production lines therefore cost out from their category rate instead
of sitting uncosted forever, and an invoice still overrides the estimate the
moment one exists.

### Naming

The UI says **Budget** where the model says `ClientAgreement`, and **Budgets**
where it says agreements. The model name is unchanged: renaming it would touch
the schema, service, four routes and ~90 tests for no user benefit. If the two
ever need to agree, this paragraph is the record of why they don't.

---

## 13. Adding budget, and the two views

### One button, one question

There were two buttons — "Add a line" by the grid and "Add Budget" in the
header — and choosing between them meant knowing that one made a single row and
the other made a repeating charge. That's an implementation detail. The question
a person actually has is *does this happen once, or every month?*, so it's one
button and that question, in
[`budget-add-chooser.tsx`](../src/app/app/projects/_components/budget-add-chooser.tsx).

Existing budgets are listed in the chooser too. Editing one otherwise needs a
second entry point, which is the two-button problem again somewhere else.

### The budget form

Name, how long it runs, and its line items. That's all of it.

**Months, not dates.** A budget runs for whole months, so it's a From/Through
month pair (One month collapses it to a single select). Asking for a start and
end *day* invited precision nothing downstream uses, and produced 03/23–03/28
budgets nobody meant. The stored term is still real dates — first of the start
month to the last day of the end month — so §9's pro-rating is untouched.

**No total-commitment field.** The budget's value is DERIVED: monthly items ×
term months. It used to be typed in a field right next to the items, which
meant the same number existed twice and could disagree with itself. Editing a
budget with no items falls back to whatever was stored, so an old one can't be
silently zeroed.

**No markup override field.** A per-budget rate is a rare exception and the rate
cards (§12) cover the normal case. The column still exists and is passed through
untouched on save, so a budget that has one doesn't lose it.

### Items and their pieces

A budget's recurring charges are **items** (a channel) with optional **pieces**
under them. Splitting Videos into "Commercial" and "Kick-off" divides that
item's budget between two named lines.

The stored shape is still FLAT — one `AgreementFee` row per line the layout will
create — and the grouping exists only in the form. The first version shipped
that flat shape *as the UI*, with a name column on each row: functionally the
same thing, and nobody found it, because a list of rows doesn't read as
splitting an item. The hierarchy is the affordance.

Splitting a whole item for the first time names the existing row after its
channel, so neither piece is left anonymous.

**The item's total is held separately from its pieces, and it is the
authoritative number.** If the total were just the sum of the pieces, then
splitting a $3,000 Google buy and typing "Search 500" would silently make it a
$3,500 buy — the committed number would move because somebody else got granular.
Instead the total stays put, pieces divide it, and the gap is shown: *"$1,500 of
$3,000 split · $1,500 stays as Google."* Over-splitting warns rather than blocks,
matching §8.3.

On save the nesting flattens back to one fee row per line the layout will
create: the named pieces, plus the unattributed remainder as an unnamed row. So
the item's total survives the round trip instead of shrinking to whatever
happened to be named.

### Year and month

The same money, two shapes:

- **Year** — channels × twelve columns of totals. Answers *how is this client's
  money spread out.*
- **Month** — every line in one month, grouped by kind, with its name, base/added
  and status on the row. Answers *what exactly are we running in March* — which
  the year grid can't, because a cell is a sum and each line behind it is a
  separate click.

The month view derives entirely from the lines the hub already loaded for the
year; a view that refetched would be a second source of truth for the same
numbers. Its month strip shows each month's total, so you can see where the
money is before picking one.

---

## Appendix: Monday.com

Recommendation: **don't integrate.**

- The Ads Pacer is already a rebuilt Monday board —
  `MetaAdsPlannerTool.tsx:114` ("rich Monday-mapped editor"),
  `use-drag-reorder.ts`, `StatusSelect.tsx` ("Monday-style status dropdown"),
  and `ui.ts:128` (intake "distilled from the legacy 95-question Monday
  intake"). Nobody built a sync then, and it worked.
- Budget-on-tasks requires Loomi to **own** the task record — real
  `BudgetLine.taskId` FK, pool ceilings enforced on write, status transitions
  driving settlement. Mirrored Monday items are either read-only shadows
  (can't hold an editable budget) or full bidirectional sync — identity
  mapping, column mapping, conflict resolution, webhook reliability, deletion
  semantics — built with a known 6–12 month expiry.
- The overlap is small. Only budget-bearing work needs to be in Loomi: ads,
  print, radio, TV, video, PR. Which is exactly what `TYPE_FIELDS` covers.

**Instead, split by boundary:** if it spends media dollars, it's filed in
Loomi; everything else stays on Monday until the full migration. One rule a
rep can hold in their head, versus a mirror that drifts silently.

If Monday-side visibility is needed during the overlap, do the disposable
version: nightly one-way push creating/updating a Monday item from a Loomi
task, with a `loomiTaskId` column for idempotency and **no read-back**. Roughly
a day of work, throwaway by design, and Monday never enters the write path for
anything Loomi depends on.
