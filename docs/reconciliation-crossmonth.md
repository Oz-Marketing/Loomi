# Loomi Reconciliation — Cross-Month Spend Handling
### Column spec, counted-spend formula, conservation rule, and settlement/pending state

**Purpose.** Make the reconciliation sheet show the *raw* Meta actual as an untouchable anchor, then account for cross-month flights through visible adjustment columns so the counted number is auditable end to end: a reader can trace **raw → adjustment → counted** without anything moving behind the curtain. This resolves the mismatch where the rollover report counts a flight's origin-month spend that a later month's invoice will also carry.

---

## 1. Design principle (non-negotiable)

1. **Raw Meta spend is immutable.** Pull it from Meta and never overwrite it. It is the anchor every other number is checked against.
2. **Every adjustment is its own visible line**, not a silent edit to the raw number.
3. **Counted spend is derived**, never entered.
4. **Adjustments post in atomic pairs** — a dollar leaving one month and the same dollar arriving in another are one event, posted together, never independently. This is what guarantees no orphaned or double-counted dollars.

---

## 2. Column schema

Order preserves Loomi's existing rollover columns (`Budget`, `Payable (Expected)`, `Adjusted Payable`, `Variance / Carryforward`) and inserts the cross-month machinery between raw actual and variance.

| # | Column | Type | Source / Formula | Editable? |
|---|--------|------|------------------|-----------|
| 1 | `Month` | label | — | no |
| 2 | `Budget` | currency | client monthly budget | input |
| 3 | `Payable (Expected)` | currency | budget × (1 − margin) | derived |
| 4 | `Adjusted Payable` | currency | `Payable + prior month's Variance/Carryforward` | derived |
| 5 | `Raw Meta Spend` | currency | Meta API, Amount Spent, dated to day of delivery — **immutable** | no (system) |
| 6 | `Cross-Month Out (−)` | currency | Σ of settled origin-month slices leaving this month | derived (from flight ledger) |
| 7 | `Cross-Month In (+)` | currency | Σ of settled slices arriving this month from earlier months | derived (from flight ledger) |
| 8 | `Counted Spend` | currency | `Raw Meta Spend − Cross-Month Out + Cross-Month In` | no |
| 9 | `Variance / Carryforward` | currency | `Adjusted Payable − Counted Spend` | no |
| 10 | `Pending Forward` | currency + flag | Σ of *unsettled* cross-month slices sitting in this month's raw that will leave at settlement (informational only — does **not** affect Counted yet) | no |

**Counted formula (the one that matters):**

```
Counted Spend = Raw Meta Spend − Cross-Month Out + Cross-Month In
```

Raw stays sacred. Out removes origin-month dollars of a flight billed in a later month. In receives those dollars in the billed month. July's Raw already holds the July-delivered portion, so once In posts the origin slice, the full flight is counted exactly once, in the billed month.

**Sign convention (match existing rollover):** `Variance = Adjusted Payable − Counted`, so **negative = overspent**, positive = underspent, and the value rolls forward into next month's `Adjusted Payable`. (Note this is the *opposite* sign of the H1 audit spreadsheet, which uses `Actual − Planned` where positive = over. Same magnitude, flipped sign — worth a tooltip so nobody trips on it.)

---

## 3. The flight ledger (what feeds columns 6, 7, 10)

`Cross-Month Out`, `In`, and `Pending Forward` are **not** hand-entered per month — they are sums rolled up from a per-flight ledger. Each cross-month flight has one ledger record:

| Field | Meaning |
|-------|---------|
| `flight_id` | unique flight/ad identifier |
| `flight_name` | human label |
| `run_start`, `run_end` | flight dates |
| `billed_month` | the month the full flight invoices in |
| `flight_total` | full flight spend (all months) |
| `origin_slices[]` | per pre-bill month: `{ month, dated_spend }` — the Meta-dated spend that falls in each month before `billed_month` |
| `status` | `pending` \| `settled` |

Keying: **drive this off the `cross-month` flag**, not the `lifetime` flag. Per Loomi's architecture the `cross-month` flag controls settlement deferral and `lifetime` controls pacing suppression — they are independent, and this logic is settlement-side.

Rollup:
- `Cross-Month Out[month]` = Σ `dated_spend` of **settled** flights whose `origin_slices` fall in `month`
- `Cross-Month In[month]` = Σ (Σ `origin_slices.dated_spend`) of **settled** flights whose `billed_month` = `month`
- `Pending Forward[month]` = Σ `dated_spend` of **pending** flights whose `origin_slices` fall in `month`

---

## 4. Settlement & pending state (prevents the transient orphan)

The failure mode to design against: pull a slice out of the origin month before the billed month is ready to receive it, and the dollars vanish from every month for the duration.

The fix is **atomic paired posting at settlement**:

- **While pending** (flight has run partially or fully but has not settled): Out and In are **both zero**. The origin-month slice stays inside that month's `Raw` and therefore inside its `Counted`. Nothing has moved. The `Pending Forward` column surfaces the slice as informational — "this $X will forward to `billed_month` at settlement" — so the origin month doesn't look mysteriously heavy without explanation, and no month ever looks light for dollars that haven't arrived.
- **At settlement** (trigger below): the Out (origin months) and In (billed month) post **simultaneously as one transaction**. Because they are one event, Σ Out always equals Σ In — conservation can never break at the moment of posting.

**Settlement trigger:** flight `run_end` has passed **and** `billed_month` has been reached (invoice period the flight lands in). At that point `status → settled`, `Pending Forward` clears on the origin month, and Out/In post. This matches Loomi's rule that variance on cross-month flights settles only at actual flight end.

State transition:

```
pending  ──(run_end passed AND billed_month reached)──▶  settled
   │                                                        │
   │ Out=In=0, slice shown in Pending Forward               │ Out & In post atomically
   │ slice still counted in its origin month                │ slice now counted only in billed_month
```

---

## 5. Conservation invariant (the trust check)

Across every month in the reconciliation window:

```
Σ Cross-Month Out  ==  Σ Cross-Month In        (over settled flights)
```

Every dollar pulled out of one month must land in exactly one other. If the two totals ever disagree, a slice is orphaned or double-counted — Loomi should **flag the reconciliation, not silently pass it**. This check *is* the answer to "can I trust the counted number": it proves conservation.

**Window-boundary handling.** A flight whose origin month is outside the reconciliation window but whose `billed_month` is inside it (e.g., ran Dec 2025, bills Jan 2026) produces an In with no matching Out in-window. Route that origin slice through the existing **starting carry-in** bucket (the "January starting carry-in (from 2025)" line) so the invariant balances: `Σ In == Σ Out + carry-in − carry-out`. Symmetrically, a flight originating in-window but billing after the window contributes a carry-out.

---

## 6. Drill-down payload (behind the Out / In / Pending cells)

These cells must never be bare numbers. Clicking one expands to the contributing flight lines so a reader sees *why* it counts this way:

Per flight line: `flight_name` · `run_start–run_end` · `billed_month` · `flight_total` · this month's `dated_spend` · `status` (pending/settled) · direction (Out from here / In to here).

Example expansion of Jun 2026 `Cross-Month Out`:
> **BMW R 1300 GS — Adv+ carousel** · Jun 26 – Jul 3 · bills **Jul 2026** · flight total $X · **−$76.60** leaving June · *settled*

---

## 7. Edge cases

- **Three-plus-month flight.** Multiple origin slices, one billed month. Out posts on each origin month; In on the billed month equals the sum of all slices. Invariant still holds (Σ slice Outs = In).
- **Multiple cross-month flights in one month.** Out/In/Pending are sums; drill-down lists each flight separately.
- **Flight billed in its own final run month with no later spill.** Not cross-month — `cross-month` flag is false, no ledger record, Out/In = 0.
- **Cross-month but not lifetime (or vice versa).** Independent flags. This logic keys only on `cross-month`; `lifetime` is irrelevant here.
- **Refund / spend correction after settlement.** Adjust `flight_total` and re-post the pair; conservation re-checks. Never edit `Raw` — corrections ride the adjustment columns.

---

## 8. Worked example — Young Powersports Euro, June 2026

Flight: cross-month, ran Jun 26 – Jul 3, bills entirely in July. June-dated spend = **$76.60**.

**Before settlement (mid-flight or pre-invoice):**

| Month | Raw | Out | In | Counted | Pending Forward |
|-------|-----|-----|----|---------|-----------------|
| Jun 2026 | 1,573.24 | 0 | 0 | 1,573.24 | 76.60 → Jul (pending) |
| Jul 2026 | *(Jul raw so far)* | 0 | 0 | *(Jul raw)* | — |

June still counts the $76.60; nothing orphaned; the Pending Forward flag explains it.

**After settlement:**

| Month | Raw | Out | In | Counted |
|-------|-----|-----|----|---------|
| Jun 2026 | 1,573.24 | −76.60 | 0 | **1,496.64** |
| Jul 2026 | *(Jul raw, incl. Jul 1–3)* | 0 | +76.60 | raw + 76.60 |

Six-month counted actual becomes **9,869.14** (was 9,945.74 raw). Cumulative variance vs. $9,856 payable = **−$13.14** in rollover sign (overspent by $13.14) — matching the corrected H1 audit spreadsheet (+$13.14 there). Σ Out (76.60) = Σ In (76.60): invariant holds.

---

## 8a. Full worked test case — Young Powersports Euro, Jan–Jul 2026

A complete, real dataset for validating the build. If Loomi reproduces every number below, the model is working.

### Raw inputs (immutable — from Meta, by day)

| Month | Budget | Raw Meta Spend |
|-------|--------|----------------|
| Jan | 2,156.00 | 2,103.97 |
| Feb | 1,540.00 | 1,582.08 |
| Mar | 1,540.00 | 1,613.17 |
| Apr | 1,540.00 | 1,619.43 |
| May | 1,540.00 | 1,453.85 |
| Jun | 1,540.00 | 1,573.24 |
| Jul | 1,540.00 | 1,471.64 |
| **Total** | **11,396.00** | **11,417.38** |

Naive (no cross-month handling): 11,417.38 − 11,396.00 = **+21.38 over**. This is the wrong answer — it counts origin dollars in the calendar month Meta dated them, not the month they bill.

### Flight ledger (all cross-month flights, both bike night ads per event)

Each event has two ads: a main "Bike Night Event" ($80 lifetime budget) and a "Bike Night Facebook Event" ($35.50 lifetime budget).

| Flight | Run dates | Billed month | Origin spend | Billed-month spend | Full run |
|--------|-----------|-------------|--------------|--------------------|----------|
| F1 main | Mar 27–Apr 3 | Apr | Mar 53.58 | Apr 26.31 | 79.89 |
| F1 fb | Mar 27–Apr 3 | Apr | Mar 22.75 | Apr 12.74 | 35.49 |
| F2 main | Apr 24–May 1 | May | Apr 74.24 | May 5.66 | 79.90 |
| F2 fb | Apr 24–May 1 | May | Apr 32.71 | May 2.73 | 35.44 |
| F3 main | May 29–Jun 5 | Jun | May 30.23 | Jun 49.59 | 79.82 |
| F3 fb | May 29–Jun 5 | Jun | May 13.10 | Jun 22.37 | 35.47 |
| F4 main | Jun 26–Jul 3 | Jul | Jun 53.63 | Jul 26.34 | 79.97 |
| F4 fb | Jun 26–Jul 3 | Jul | Jun 22.97 | Jul 12.45 | 35.42 |
| F5 main | Jul 31–Aug 7 | **Aug** | Jul 5.85 | *(Aug, pending)* | *(pending)* |
| F5 fb | Jul 31–Aug 7 | **Aug** | Jul 2.73 | *(Aug, pending)* | *(pending)* |

Per-month origin totals: Mar 76.33 (F1) · Apr 106.95 (F2) · May 43.33 (F3) · Jun 76.60 (F4) · Jul 8.58 (F5).

### Counted spend after cross-month handling

| Month | Raw | Out (−) | In (+) | Counted | vs Budget |
|-------|-----|---------|--------|---------|-----------|
| Jan | 2,103.97 | — | — | 2,103.97 | −52.03 |
| Feb | 1,582.08 | — | — | 1,582.08 | +42.08 |
| Mar | 1,613.17 | 76.33 | — | 1,536.84 | −3.16 |
| Apr | 1,619.43 | 106.95 | 76.33 | 1,588.81 | +48.81 |
| May | 1,453.85 | 43.33 | 106.95 | 1,517.47 | −22.53 |
| Jun | 1,573.24 | 76.60 | 43.33 | 1,539.97 | −0.03 |
| Jul | 1,471.64 | 8.58 | 76.60 | 1,539.66 | −0.34 |
| **Net** | | **311.79** | **303.21** | **11,408.80** | **+12.80 over** |

**Correct Jan–Jul over/under = +$12.80 over** (rollover sign: −$12.80). This is the carryover to bring into August — *not* $21.38, and not the $87.91 an un-corrected screen shows.

### What this case proves

- **Interior flights wash the net.** F1–F4 each move dollars between two months both inside Jan–Jul, so they change the per-month rows but not the net. The naive $21.38 and the correct $12.80 differ by exactly **$8.58** — the single edge-crossing flight (F5, bills August).
- **Only edge-crossers change carryover.** F5's $8.58 of July-dated spend is reclassified out of July into August (its billed month sits outside the window). On the sheet, that is the *one and only* reclassify entry for this window. F4's $76.60 is **not** reclassified — July is in-window, so F4 is interior.
- **Conservation across a bounded window.** Here Σ Out (311.79) − Σ In (303.21) = 8.58, the amount leaving the window for August. Extend the view to include August and its In of 8.58 balances it, so Σ Out = Σ In. A mismatch that is *not* equal to the known edge outflow means a leak.
- **The frozen-origin bug is visible here.** An un-corrected screen leaves Mar at raw 1,613.17 (reads +73.17 over) because Mar is backfilled and its 76.33 origin slice never gets pulled out. Correct handling pulls it, giving −3.16. If Loomi cannot post an Out against a backfilled month, this case will fail on the Mar row.

### Per-flight budget adherence (drill-down under each billed month)

Lifetime budgets cap total delivery, so a settled lifetime flight should never exceed its budget — if one does, flag it as a data-entry error, not real spend.

| Flight | Budget | Full run | Result |
|--------|--------|----------|--------|
| F1 main | 80.00 | 79.89 | 0.11 under |
| F1 fb | 35.50 | 35.49 | 0.01 under |
| F2 main | 80.00 | 79.90 | 0.10 under |
| F2 fb | 35.50 | 35.44 | 0.06 under |
| F3 main | 80.00 | 79.82 | 0.18 under |
| F3 fb | 35.50 | 35.47 | 0.03 under |
| F4 main | 80.00 | 79.97 | 0.03 under |
| F4 fb | 35.50 | 35.42 | 0.08 under |
| F5 main | 80.00 | 5.85 so far | pending |
| F5 fb | 35.50 | 2.73 so far | pending |

All settled flights land at or just under budget — consistent with lifetime caps. **Sanity flag to build:** a settled lifetime flight computing over its budget = flag for review (Meta should not allow lifetime overspend, so it signals a bad split entry).

### Note on funding

These event budgets are funded *inside* the $1,540 monthly, not additive. So the month `Budget`/`Payable` stays $1,540 and the per-flight settlement line is a **diagnostic**, not an addition to the month target. (If a client's events were ever funded on top of the monthly, the billed month's target would need the event budgets added — not the case here.)

---

## 9. Acceptance checks

A reconciliation is trustworthy when all hold:

1. `Raw Meta Spend` equals the Meta export to the cent for every month (no drift, no overwrite).
2. `Counted = Raw − Out + In` in every row.
3. `Σ Out == Σ In` (± carry-in/carry-out at the window boundary).
4. Every cross-month flight is counted in exactly one month = its `billed_month`, and only after settlement.
5. No month shows Out without a matching settled In somewhere, and vice versa.
6. Pending slices appear in `Pending Forward` and are excluded from Out/In until settlement.
7. **Regression:** the §8a dataset reproduces the counted-spend table exactly — net **+$12.80 over**, Mar row **−3.16** (not +73.17), and the naive-vs-correct gap equals the single edge slice **$8.58**.

---

## 10. Implementation notes (as built)

**Everything is derived.** The only stored intent is each flight's billed month —
`MetaAdsPacerAd.fullRunAppliedToMonth` ("count this run in month X"). Slice
amounts, `pending`/`settled` status, the Out/In/Pending rollups and the
conservation check are all recomputed on read by
`src/lib/ad-pacer/cross-month-ledger.ts`. There is no second copy of the truth to
drift out of sync, and no migration.

This also makes §1.4 (atomic paired posting) structural rather than
transactional: Out and In are computed from the same ledger entry in one pass, so
they cannot disagree through a partial write. `checkConservation` then verifies
the arithmetic end to end.

**Field mapping.**

| Spec | Loomi |
|------|-------|
| `flight_id` | `groupFlightRuns` key — the linked Meta ad-set id, else the `linkedPrevAdId` chain root |
| `billed_month` | `fullRunAppliedToMonth` (set via `POST …/resolve-cross-month`, action `apply_full_run`, `month`) |
| `origin_slices[].dated_spend` | each pre-bill month row's `pacerActual` |
| `flight_total` | Σ the run's month slices (Meta's own `pacerRunSpend` is cross-checked, not trusted over the slices) |
| `status` | derived: `run_end` passed AND `billed_month` reached |
| lifetime cap (§8a adherence) | `metaLifetimeBudget` |

**Keyed on cross-month, not lifetime** (§3, §7). The ledger reads
`fullRunAppliedToMonth` and never `budgetType`, so a daily straddler is handled
identically to a lifetime one.

**No lifetime hold-out.** A running lifetime ad is not excluded from its month's
over/under. It spends close to its set budget whether or not the run has closed,
so its spend counts the whole time it is live, like a daily line (which is also
only part-delivered mid-month — elapsed-time pacing, not exclusion, accounts for
that). The genuine case that motivated the old hold-out — a budget deliberately
spread across two months that Meta under-delivers in the first — is handled by
the split-run settlement and by this ledger, both keyed on an explicit user mark
rather than on "is it still running". That matters here: an exclusion keyed on
run state silently dropped real spend out of a month's variance, and a run whose
status never flipped dropped it forever.

**Precedence against the split mechanism.** A run marked "split across months"
settles by the *other* mechanism (once on its final month, against
`metaLifetimeBudget`), so split members are excluded from this ledger. Two
settlement mechanisms must never both move the same flight's dollars.

**Regression.** `src/lib/ad-pacer/cross-month-ledger.test.ts` encodes §8a: the
counted table to the cent, net +$12.80, the Mar row at −3.16, and the
naive-vs-correct gap of exactly $8.58 (acceptance check 7).

### Carryover interaction

The two systems are orthogonal by construction: `Out`/`In` move dollars on the
SPEND side, an applied carryover moves dollars on the TARGET side
(`adjustedSpendTarget = spendTarget + appliedIn`, and `variance` nets `appliedIn`
out). Nothing in the ledger feeds `variance` today, so applying over/under
behaves exactly as it did before this change.

One property worth knowing: a month's `unapplied` is `carryover − appliedOut`,
where `carryover` is recomputed live and `appliedOut` is the fixed dollar amount
of the ledger entry. So if a month's spend changes AFTER its over/under was
applied — a cross-month flight settles, or one gets marked — the difference
resurfaces as unapplied on that month rather than being silently lost. Nothing
double-counts; you just reconcile that month twice. The `Pending Forward` column
and the "not final yet" caution on Apply exist so this is a choice rather than a
surprise.

### Not yet done

`Variance / Carryforward` still measures against the pre-existing base
(Σ `effectiveActual`, less the §3 lifetime hold-out and split-run exclusions),
NOT against `Counted Spend`. For a settled flight with consistent Meta data the
two are equal, so the columns above are a faithful decomposition of the number
already in use. They diverge in exactly two cases, both of which the columns now
make visible:

1. a **pending** flight — §4 says its slice stays counted in its origin month,
   where the old code moved it immediately; and
2. Meta's `pacerRunSpend` disagreeing with the summed month slices (the old code
   trusted `pacerRunSpend`, and silently counted nothing at all when it was
   unsynced).

Switching the variance basis to `countedSpend` touches three interacting
settlement mechanisms (the §3 lifetime hold-out, split-run settlement, and this
ledger), so it wants its own change with the two numbers visible side by side
first — hence `rawSpend`/`countedSpend` and `actual` all being on screen.
