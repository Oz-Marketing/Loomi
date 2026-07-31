# Budget module — Oz Reports → Loomi Projects

Plan for moving client budgeting out of Oz Reports and into Loomi, so the Ad
Pacer paces against a **real budget** instead of a hand-typed goal, and so a
budget can be distributed at the moment work is requested.

Status: **Phases 1–3 built** — the ledger, intake wiring, and the pacer
binding. The manual retype is gone for any month switched to budget-managed.
The budget hub UI (1b) and settlement (4) are not built. See §5.

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

Three models, in [`prisma/schema.prisma`](../prisma/schema.prisma) — the schema
is the source of truth and carries the full field-by-field commentary; this is
the shape and the reasoning.

| Model | Role |
|---|---|
| `BudgetPlan` | One row per account per year. The declared annual commitment + monthly retainer + optional markup override. Thin: it's what lines are checked *against*, not where the money lives. |
| `BudgetLine` | **The ledger.** Every media dollar is one row. |
| `BudgetLineEvent` | Typed, queryable audit. Replaces both `rep_notes` string concatenation and the separate `logBudgetMove` table. |

`BudgetLine`'s load-bearing columns:

- **`accountKey` + `spendAccountKey`** — billed to vs spent from
  (oz-reports' `account_id` / `spend_account_id`). Equal in the ordinary case.
  The pacer rollup keys off `spendAccountKey`; billing keys off `accountKey`.
- **`year`** — always set, *including on pool lines*. A pool line has no period,
  so nothing else anchors it to a `BudgetPlan`. When `period` is set the two
  must agree; `resolveYear` enforces it on every write.
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
| **1b — Hub UI** | Per-account annual view: declared total, retainer generator, pool, lines by channel × month | Not built — API is ready for it |
| **2 — Intake wiring** | Intake creates `BudgetLine`s; live remaining shown in the form; the six `Task.details` budget fields removed | **Built** |
| **3 — Pacer binding** | `syncPeriodBudgetFromLines` writes the goal pair; per-platform opt-in; UI locks + unmanage; save route guarded | **Built** |
| **3b — Distribute to ads** | "Distribute remaining" action allocating a month's target across pacer ad rows (the `adset_allocations` equivalent, both platforms) | Not built |
| **4 — Settlement** | Platform lines settle from synced spend on month freeze; non-platform by hand | Not built |

### What exists

| File | What |
|---|---|
| [`prisma/schema.prisma`](../prisma/schema.prisma) | `BudgetPlan`, `BudgetLine`, `BudgetLineEvent` + relations |
| [`src/lib/budget/channels.ts`](../src/lib/budget/channels.ts) | The channel registry + pacer-platform mapping |
| [`src/lib/budget/period.ts`](../src/lib/budget/period.ts) | Period helpers + `resolveYear` (the year/period invariant). Prisma-free so routes can validate without pulling in a DB client |
| [`src/lib/services/budget.ts`](../src/lib/services/budget.ts) | Create / allocate / return-to-pool / settle, rollups, `getPacerBudgetGoals`, retainer generation |
| `src/app/api/budget/*` | `summary`, `plan` (+`?generate=true`), `lines`, `lines/[id]`, `lines/[id]/allocate` |
| `api/meta-ads-pacer/[k]/budget-managed` | GET state / POST manage-unmanage, per platform |
| [`src/lib/projects/ui.ts`](../src/lib/projects/ui.ts) | `KIND_BUDGET_CHANNELS` — which channels each task Type can spend on |
| `createTicket` in [`services/projects.ts`](../src/lib/services/projects.ts) | Turns a ticket's requested budget into lines |

Tests: `budget/period.test.ts` + `budget/channels.test.ts` run always;
`services/budget.db.test.ts` (33 cases — ledger arithmetic plus the pacer
binding) self-skips unless `RUN_DB_TESTS=1`, matching `loomi-flows.db.test.ts`.

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
  if a stale tab or direct API call tries to write a managed goal — rather than
  accepting it and letting the next sync silently revert it.

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

## 6. Migration / dual-run

`dealer_map.loomi_account_key` already exists, so backfill is a join away.
Same shape as the contact sync — one-way push from the Oz Reports host, which
is where the mapping lives.

1. Backfill historical `account_budgets` → `BudgetLine` (`status='settled'`,
   `markupSnapshot` resolved from `margin_rules` **at the row's own date**, not
   today's). Read-only history.
2. Run parallel for one full year. Oz Reports stays system of record;
   reconcile monthly.
3. Cut over at a year boundary — carryover math is annual, so mid-year is
   needless pain.

---

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

- **Per-channel markup.** `resolveMarkup` walks `BudgetPlan.defaultMarkup` →
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
