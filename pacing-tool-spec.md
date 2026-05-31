# Pacing Tool — Accuracy Upgrade Spec

---

## How to use this document (read first)

This is a spec for changes to an **existing** Meta ads pacing/planning tool — not a greenfield build. It describes intended behavior for several pages that already exist: the **Pacer**, the **Planner**, the **Over/Under Spend** page, and the **admin overview** (all-accounts billing view).

**Before writing any code:**
1. Explore the current codebase and map each change below to the existing files, components, and data model.
2. Tell me how the changes line up with what's already there — confirm you understand how the pacer, planner, Over/Under, and admin overview pages work today and where the relevant logic lives.
3. **Flag anything in this spec that conflicts with how the code actually works now.** This doc reflects design intent from a planning discussion; the real code is the source of truth where they differ.
4. Do **not** implement everything at once. Implement **one change at a time**, in the order suggested by the dependency notes at the end, and let me verify each before moving on.

**Resolve these open team decisions before the changes that depend on them** (each is also flagged inline):
- Exact carryover threshold (~$10).
- Default carryover bucket (Base vs Added).
- Whether applying carryover means actually spending the difference next month (affects the spend target) vs only a billing adjustment.
- Single-month vs cumulative carryover (recommended: single-month).
- Confirm the combined Base+Added total is the primary billing figure on the admin overview.

**Suggested starting point:** Change 1 (fractional days-remaining math) or Change 6's variance fix — both are small, self-contained, and don't touch the Meta API, so they're a good way to see how these changes land in the codebase before tackling the billing-sensitive carryover logic (Changes 7–8).

---

## Overview of changes

| # | Change |
|---|---|
| 1 | Fractional, time-aware "days remaining" (not just calendar date) |
| 2 | All date math in the ad account's timezone |
| 3 | Wire in the Meta API to pull actual spend automatically |
| 4 | Pull flight schedule from Meta; clamp dates AND spend to the pacing month |
| 5 | Month selector + live-vs-frozen month model + per-month storage |
| 6 | Over/Under page: margin-correct variance, elapsed-days as status only, carryover |
| 7 | Carryover into the planning page without ever touching the client budget |
| 8 | Admin overview / all-accounts billing view |
| 9 | Alerting system + account-level pacing indicator |
| 10 | Automatic audit log + bulk-action guardrail |
| 11 | Meta status sync (live / off / completed) |
| 12 | Budget calculator: Split type, mid-flight invariants, precision bug fix |

Changes 1–2 (pacing math) and Change 3 (API spend) are independent. Changes 4–5 build on the API. Changes 6–8 are the billing-sensitive cluster and do **not** require the API — they can be built and reviewed as a unit. Full dependency notes are at the end.

---

## Team decisions checklist (resolve before building the dependent changes)

These are the open choices flagged throughout the spec, gathered in one place. None are assumed in the spec — each needs a team answer. Grouped by the change that needs it.

**Margin & targets**
- [ ] Confirm the per-account **margin field** already in the system is the one to use for `spend_target` (it reportedly drives other functions — reuse, don't hardcode). *(Ch. 6)*
- [ ] Confirm whether margin is the same for all clients or varies by contract (if it varies, it's already per-account — just verify). *(Ch. 6)*

**Carryover / over-under**
- [ ] Exact carryover **threshold** (~$10 over/under) that triggers a flag. *(Ch. 6, 7)*
- [ ] Default **bucket** a carryover applies to — Base vs Added (suggested: Base, route to Added for special-campaign overages). *(Ch. 7)*
- [ ] Does applying carryover mean actually **spending** the difference next month (adjusts the spend target — as specced), or only a **billing** adjustment (routes elsewhere)? *(Ch. 7)*
- [ ] **Single-month vs cumulative** carryover (recommended: single-month, applied once on approval, no auto-chaining). *(Ch. 6, 7)*

**Admin overview / billing**
- [ ] Confirm the **combined Base+Added total** is the primary billing figure, with Base/Added shown as components. *(Ch. 8)*

**Alerts**
- [ ] Specific **alert thresholds** (e.g. ">15% under with <30% of flight left") and which conditions are **on by default**. *(Ch. 9)*
- [ ] Alert **delivery channel** — in-app, email, or both. *(Ch. 9)*

**Audit log**
- [ ] Exactly which **events** the audit log captures, and the **retention period**. *(Ch. 10)*

**Meta status sync**
- [ ] Which status transitions **auto-apply vs require confirmation** (recommended: only flight-end-passed → Completed auto-applies; all else confirmed). *(Ch. 11)*
- [ ] How to treat Meta **"paused" mid-flight** (likely a temporary-pause alert, not an automatic "Off" switch). *(Ch. 11)*

**Budget calculator**
- [ ] For **Split ads** in "distribute evenly," confirm the pools stay separate (Base spreads to Base portions, Added to Added portions). *(Ch. 12)*
- [ ] Confirm the **precision/rounding rule** (recommended: store full precision, round only for display, never sum rounded values). *(Ch. 12)*

**Source-of-truth confirmations (verify in the existing system/code)**
- [ ] Confirm `target_total` / Client Budget Goal is already **scoped to the flight/month** (not a raw monthly figure needing pro-ration). *(Ch. 4-related, planning)*
- [ ] Confirm the planning page hands the pacer a number **specific to the month being paced**. *(planning)*
- [ ] Confirm current **Meta API access tier** (Development vs Standard) — check `ads_api_access_tier` in a response header or App Dashboard → App Review → Permissions & Features. *(API)*
- [ ] Kick off **business verification** in Meta Business Manager early if not done (slowest step in any future tier upgrade). *(API)*

---

## Background: what the tool calculates today

For a given flight, the tool computes a recommended daily budget as:

```
remaining_budget   = target_total - actual_spend
recommended_daily  = remaining_budget / days_remaining
```

The bug is in `days_remaining`. It's currently a **whole-number calendar count** — at 6:30 PM on May 29 with a flight ending May 31, it counts the 29th, 30th, and 31st as **3 full days**. But most of the 29th is already gone and its spend is largely locked in, so treating it as a full controllable day makes the tool **over-correct** (it recommends cutting the budget harder than necessary).

---

## Change 1: Fractional, time-aware days remaining

Replace the integer day count with the **precise fraction of time left in the flight**, measured to the current moment.

### Formula

```
now         = current timestamp, in the AD ACCOUNT's timezone
flight_end  = midnight at the START of the day AFTER the last flight day,
              in the AD ACCOUNT's timezone
              (e.g. flight ends May 31 -> flight_end = June 1, 00:00:00)

days_remaining = (flight_end - now) / 24 hours      // a float, e.g. 2.23
```

### Worked example (using the current real numbers)

- Now: May 29, 6:30 PM (account TZ)
- Flight end boundary: June 1, 00:00:00
- Time left: ~5.5 hrs (rest of the 29th) + 24 (30th) + 24 (31st) = 53.5 hrs = **2.23 days**

```
remaining_budget  = 200.87 - 171.34 = 29.53
recommended_daily = 29.53 / 2.23      = ~13.25   // tool currently says 9.84
```

So the corrected recommendation is **~$13.25/day**, not $9.84. Same fix flows into the projection: at the current $14.77/day rate the real projected overspend is only **~$3.40**, not the $14.78 the tool currently shows — because today is nearly over and can't spend a full day's worth.

### Why fractional beats "just drop today"

A naive "ignore today, divide by 2" would give $29.53 / 2 = $14.77/day. The fractional version ($13.25) is more accurate because it correctly credits the *small* amount today will still spend in its remaining hours, rather than zeroing today out entirely. Fractional is more accurate than both the current logic and the simple drop-today rule.

---

## Change 2: Timezone handling (do this as part of Change 1)

All date math must run in the **ad account's timezone**, not the viewer's or the server's.

- Meta resets the daily budget at **midnight in the account's configured timezone**. That midnight is the boundary that defines "how much of today is left."
- Hardcode/configure the account TZ and compute `now` and `flight_end` in it.
- If the viewer is in a different timezone (e.g. account on Eastern, user in Mountain), the fraction is off by the offset unless this is handled. With the API (Change 2), this gets easier — let Meta define "the day" for you (see below).

---

## Change 3: Meta API spend integration

Replace the manual `actual_spend` entry with a live API pull.

### What this removes
The previously discussed "as of" timestamp override is no longer needed. A hand-entered number goes stale (entered in the morning, viewed at night); an API pull makes the spend figure and "now" the same moment. **Timestamp the figure with the moment of the API call and drop the manual override.**

### Implementation notes for the fetch

- **Request spend in the account's timezone**, and let Meta define the date range. Meta's Insights API will return "today" bounded by the account TZ — which conveniently matches the budget-reset boundary from Change 2, so you don't have to compute the day boundary yourself.
- **Structure the fetch so it can run repeatedly**, not just once. Even if it's called on-demand for now, building it as a repeatable call unlocks the optional enhancement below.
- Store the timestamp of each pull alongside the spend value.

### Important caveat: Meta spend is provisional

Reported spend **lags and gets revised.** Current-day figures (and sometimes the prior day or two) can change as Meta finalizes billing and strips invalid clicks. So:

- The current-day spend the API returns is **good enough to act on but not final.** Treat it as provisional in any display/logging.
- For the **morning reconciliation**, pull the *prior* day's spend **mid-morning**, not at 12:01 AM, so the number has had time to settle. Reconcile against that more-final figure.

---

## Change 4: Pull the flight schedule from Meta, but scope everything to the pacing month

### The problem this solves
The planning tab holds *target* flight dates, but ads sometimes launch late — so the planned start can be wrong, and pacing against days that never carried spend throws off the recommendation. Pulling the actual schedule from Meta fixes this: the start date becomes the date the ad *actually* started running.

### The landmine it introduces
Campaigns are sometimes extended across multiple months. If the tool pulls Meta's full schedule and paces against it directly, a May–June campaign would be paced over its whole span — but the budget is allocated **per month**. So the schedule must never be paced directly. It has to be **clamped to the month being paced.**

### The rule: pace the intersection of (Meta schedule) and (pacing month)

```
pacing_month   = the month being paced (default: current month, in account TZ)
month_start    = first day of pacing_month, 00:00:00 (account TZ)
month_end      = last day of pacing_month (used for the day-after-midnight boundary)

meta_start     = actual start pulled from Meta
meta_end       = actual end pulled from Meta

effective_start = max(meta_start, month_start)
effective_end   = min(meta_end,   month_end)
```

`effective_end` feeds the days-remaining math from Change 1. This handles every case:
- **Multi-month campaign (May–June), paced in May:** `effective_end` = May 31 — clamped to the month even though Meta says it runs into June.
- **Late launch (planned May 1, actually started May 15):** `effective_start` = May 15 (the real start), not the stale planned date.
- **Campaign ending mid-month:** clamped to its real Meta end date.

Meta supplies the truth; the month boundaries keep it scoped.

### CRITICAL: scope the spend pull the same way

This is the easy-to-miss half. The same monthly scoping must apply to the **spend** pull, not just the dates. A multi-month campaign's API spend, unscoped, returns the campaign's *total* spend across all months — which would be measured against a single month's budget and produce a wildly wrong recommendation.

**Rule: always pull spend for the pacing month's date range only** (`month_start` → `now`, in account TZ), never the campaign lifetime. This protects the math regardless of how many months the campaign spans.

So: schedule from Meta drives the *end date* (clamped to month end) and confirms the ad is live; spend is simply *this month's spend*. The two stay independent.

### Budget target is already per-month — no pro-rating needed at the source
Confirmed: the planning structure uses monthly windows, with a specific spend target input **per individual ad, per month** (and an allocation view to prevent over-allocating). So `target_total` is already correctly scoped to the pacing month for each ad. No pro-rating of the budget is required — the number arriving at the pacer is the right total for that month.

### Late-launch behavior — DECISION CONFIRMED
When an ad launches late, the monthly budget is unchanged but fewer days remain to spend it. Two options exist:
- **(A) Recommend a higher daily rate** to still hit the monthly number. ✅ **This is what we want.**
- (B) Pro-rate the budget down because days were lost. *(Not used.)*

So the math should do nothing special here — clamping `effective_start` to the real (later) Meta start naturally shrinks days-remaining, which naturally raises the recommended daily rate to hit the same target. This is the intended behavior; just confirm the dev doesn't add pro-rating logic that would cancel it out.

### One thing for the dev to confirm
The pacer needs an explicit notion of **which month it's pacing** — default to the current month (account TZ), but allow viewing a specific month for multi-month campaigns. Each month's target comes from that month's planning window. (The month selector itself is specified in Change 5.)

---

## Change 5: Month selector + live-vs-frozen month model

We want a selector to view prior months, not just the current one. This requires deciding how prior-month spend is sourced, because it interacts with Meta's late-settling spend.

### Key principle: the API does not poll on its own
The Meta API only returns spend when the tool requests a specific date range. So "is it still checking previous months?" is entirely a tool design choice — it checks a month only if we tell it to. The decision is whether viewing a past month should **re-query Meta live** or **show a stored snapshot.**

### The live-vs-frozen model (recommended)
Treat a month as **live until it has fully settled, then freeze it:**

- **Current month** → always re-query Meta live. It's still changing and still being paced.
- **Just-ended month, within a grace period** → still re-query live. Meta's monthly spend keeps settling for a short window after month-end (a few days is generally safe for finalization). During this grace period the number can still move.
- **Fully closed month (past the grace period)** → **freeze it.** Store the final figure and display the stored value. No further API calls.

This gives both accuracy (open months stay correct as Meta finalizes) and stability + speed (closed months are stable, read-only, and don't burn API calls re-fetching finished work).

### Storage: spend is keyed per month, not left in a live input field
Once the API feeds spend, **do not rely on input fields retaining last month's typed value.** Spend should be stored as data keyed to a month (`month -> spend`), not a live input that happens to still show an old number. The selector then loads the record for whichever month is picked:
- closed month → stored frozen value
- current/grace-period month → live API pull

### Freeze the whole context, not just spend
When a month is frozen, snapshot the **flight dates and the target budget** that were paced against — not only the spend. Otherwise, if someone later edits the planning tab, an old month's pacing view would recalculate against numbers that weren't what was actually managed. **A closed month must be a faithful, end-to-end snapshot of what actually happened.**

### Dev decisions to confirm
- Length of the grace period before a month freezes (suggest a few days post month-end; confirm what's safe for the account's billing finalization).
- Where frozen snapshots are stored (per month, per ad), including spend + flight dates + target at freeze time.

---

## Honesty caveat to keep in the model (don't over-trust precision)

Meta doesn't spend evenly across the day, and a portion of today's spend is already committed by the time you adjust the budget. So lowering the daily budget at 6:30 PM won't fully take effect today. The fractional model is a **solid approximation, not a guarantee.** The daily morning reconciliation against actual spend is what closes the gap — keep that step.

---

## Optional future enhancement (API unlocks this)

Once spend is automated and the fetch is repeatable, the tool can move from "recommend on demand" to "monitor and alert":

- Re-pull spend at intervals through the day.
- Compare actual pacing against the plan.
- Flag when spend is drifting off target (e.g. overpacing despite a budget cut).

Not needed now, but worth structuring the API fetch so this is a small addition later rather than a rebuild.

---

## Future: performance reporting (informs the API design now)

A planned later feature is reporting on ad **performance** (impressions, clicks, CTR, CPC, reach, conversions, ROAS, etc.), not just spend. Key facts so it shapes the API work now:

- **Same endpoint, more fields.** All of this comes from the **same Ads Insights endpoint** used to pull spend — spend is just one Insights metric. Adding performance reporting is requesting additional fields from a call you're already making, NOT a new integration or a higher access tier.
- **Structure the spend fetch to be extensible.** Build the Insights call so extra metric fields can be added later without a rebuild (same call, more columns).
- **Heavier queries are the likely tier-upgrade trigger.** Reporting tends to request more metrics, finer breakdowns (by day/by ad), and longer date ranges. Meta meters processing time per call, not just call count, so these richer queries weigh more against the rate limit. This — more than the number of accounts — is the thing most likely to eventually justify upgrading from Development to Standard access. (Light hourly spend pulls won't; heavy reporting might.)

---

## Change 6: Over/Under Spend page — margin-correct variance + carryover

This page exists to reconcile a month after the fact: did each ad spend its target, and is there an over/underspend to carry into next month's budget? Two corrections and one workflow.

### CRITICAL: variance is measured against the margin-adjusted spend target, NOT the client budget

The agency runs a margin on digital spend (set **per account** in the system already — use that existing field, do not hardcode). The client budget is the **marked-up** number; the amount that should actually hit Meta is the **unmarked** target:

```
spend_target = client_budget * (1 - margin)     // e.g. margin 0.23 -> client_budget * 0.77
variance     = actual_spend - spend_target       // compare spend to TARGET, never to client_budget
```

- The client budget stays on the page only as the **input that derives** `spend_target` — it is context, not the comparison basis.
- **Both the month view and the year view must use this same `spend_target` basis.** Today the month view does this correctly (e.g. $384.81 vs $385 target = ~$0). The **year view is wrong** — it compares actual spend to the full client budget ($384.81 vs $500 = −$115.19), which reports the agency margin as if it were underspend. Fix the year view to compare against `spend_target` so both pages agree.

> Correction to an earlier note: the ~$115 difference is **not** an allocation gap to decompose — it is simply the margin ($500 − $385). Once variance is computed against the target, it disappears. There is only one real variance here: actual vs target. (Disregard any prior "allocation gap vs spend gap" decomposition.)

### Elapsed days: drop it from the variance math, keep it as a STATUS indicator

Settlement is a comparison of two whole-run totals (total spent vs total target). It must **not** be prorated by elapsed days — proration would invent a fake variance on an ad that has actually finished (e.g. an ad that ended May 23 and spent its full $385 should read ~$0, not be measured against a "29 of 31 days" fraction).

So remove elapsed-days from the Over/Under variance calculation. **Keep flight dates only as a status flag** so users know whether a variance is final:

```
status =
  "still spending"   if today <  flight_end      // variance is provisional — do NOT carry over yet
  "complete"         if today >= flight_end       // variance is final — ready for carryover decision
```

Also surface the meaningful edge case: an ad that is **complete but under target** (e.g. ended at $350 vs $385) is a genuine underspend that can't be fixed by waiting — flag it as a real carryover candidate.

(Note: elapsed-days/proration still belongs on the **Pacer** page, which answers "am I on track *right now*." It just doesn't belong in settlement.)

### Carryover workflow (the reason the page exists)

When a month is **closed** and its variance exceeds a threshold, the over/underspend should be added to / subtracted from the next month's budget.

- **Threshold is configurable** (team said ~$10 over/under — confirm exact figure). Auto-flag any closed month whose `abs(variance)` exceeds it.
- **Only closed months trigger carryover.** Tie to the freeze model (Change 5): in-progress months show "in progress"/projection, not a final variance, so a not-yet-done month never looks like an underspend.
- **Make the carryover a visible line, not a silent edit.** The planning tab's "Base + Added" structure is the natural home — carryover becomes part of Added (or its own line beside it), so next month's budget reads as "base + last month's ±$X carried over" with a traceable audit trail.

### Year view = roll-up of closed months

The year table is just the sum across closed months of `actual_spend` and `spend_target`, with `variance = actual_spend − spend_target` per row and in total. "On track for the year" = those two columns staying close. Use the **same authoritative spend number** the month view settles on (tracked total, or the pasted/API account total once present) so the two pages never disagree for the same month.

### To confirm with the team (not assumed here)
- Exact carryover threshold (~$10).
- That the per-account margin field is the one to read for `spend_target` (you noted it already drives other functions — reuse it).

---

## Change 7: Carryover into the planning page (without ever touching the client budget)

This connects the Over/Under result back into next month's planning so an over/underspend past the threshold can be folded into spending — while preserving the client's real budget as an untouched billing record.

### How the planning page actually works (corrected model — important)
The three summary boxes are **live outputs**, not stored budget fields. They recalculate as actual spend is typed into the ad lines:

- **Client Budget Goal (Gross)** — the ONLY typed input. This is the client's real budget and the billing record. Entering it derives the actual-spend target via the per-account margin (e.g. $1,000 × 0.77 = $770).
- **Total Allocated (actual spend)** — running sum of actual spend entered across ad lines (e.g. $300).
- **Gross Allocation (client budget)** — that allocated spend marked back UP to gross (e.g. $300 ÷ 0.77 = $389.61), to check against the client gross budget.
- **Remaining Budget** — appears once a budget goal is set: `target − allocated_so_far` (e.g. $770 − $300 = $470). Tells you what's left to place.

So the only thing to preserve/freeze is the **Client Budget Goal field**. The boxes are derived and live.

### The carryover principle: adjust the derived target, never the typed field
Carryover is factored into the **target the Remaining Budget counts down from** — a derived value — NOT written back into the Client Budget Goal field.

```
Client Budget Goal (gross)   = 1000        ← typed, frozen, billing record. NEVER modified by carryover.
Margin                       = per-account (e.g. 0.23)
Carryover applied            = 0 by default ← separate stored value, opt-in

Actual spend target = (Client Budget Goal × (1 − margin)) + Carryover applied
Remaining Budget    = Actual spend target − allocated_so_far
```

With carryover 0 → target = $770, identical to today. Apply +$15 → target = $785, Client Budget Goal still reads $1,000, Remaining Budget surfaces the extra $15 to allocate. Fill ad lines until Remaining = $0 → adjusted spend fully and correctly allocated, billing record untouched.

### The opt-in control
On the planning page, show last month's result and let the user decide:

```
Last month over/under: −$15.00 (under)   [exceeds $10 threshold]   [ Apply to this month ]  [ Leave as-is ]
```

- Defaults to **not applied** (carryover = 0); nothing changes unless approved. Matches "confirm if you want it, or leave it."
- Carryover stored as its own labeled value so the target always reads traceably as "$770 base target + $15 carried from May," not a silently moved number. (This is precisely what the deprecated tool lacked.)

### REQUIRED: choose which bucket (Base or Added) the carryover applies to
The client budget has two parts (Base and Added), each with its own set of live boxes. When a carryover is applied, the user **must select which bucket it lands in:**

- Carryover to **Base** → Base's target rises by the carryover, Base's Remaining surfaces the amount to allocate; Added untouched.
- Carryover to **Added** → same behavior within the Added bucket; Base untouched.
- Default suggestion: **Base**, with an explicit option to route to **Added** when the over/under originated from a special campaign that lives in Added. Confirm the default with the team.

The derivation is identical per bucket: `(bucket_client_budget × (1 − margin)) + bucket_carryover`.

### Display note: Gross Allocation can legitimately exceed the client budget
If the full carryover-adjusted target is allocated, Gross Allocation marks back up ABOVE the client budget goal (e.g. allocating $785 → $785 ÷ 0.77 = $1,019.48 vs a $1,000 goal). This is correct (you intentionally spent the $15 carryover), but it can look like an over-budget error. **Label the target as "client budget + $15 carryover"** so the ~$1,019 gross reads as intended, not as a mistake — this matters because the Gross Allocation box exists for billing checks.

### Over/Under runs on combined Base + Added
The Over/Under variance (Change 6) uses the **combined** target so total spend is captured:

```
total_true_target = (Base_client_budget + Added_client_budget) × (1 − margin)
variance          = total_actual_spend − total_true_target
```

(Matches the planner's existing combined figure, e.g. $1,250 × 0.77 = $962.50.) Keep a per-bucket breakdown available for tracing where a variance came from, but default the headline number to combined.

### Each month's variance is measured from ITS OWN original budget
When computing last month's over/under for display/carryover, measure last month's actual spend against last month's **own true target** (its budget × margin) — NOT against any adjusted target it may have had. This keeps every month independently auditable and prevents the cascading confusion of the deprecated tool. Default: variance is single-month, traced to that month's original budget; carryover applied once on approval, not auto-chained. Confirm with team whether multi-month chaining is ever wanted (recommend no).

### To confirm with the team (not assumed here)
- Default bucket for carryover (suggest Base, route to Added for special-campaign overages).
- Whether applying carryover means actually spending the difference next month (affects the spend target, as specced) vs only a billing adjustment (would route elsewhere). Specced as spend, since the tool is about pacing spend — confirm.
- Single-month vs cumulative carryover (recommend single-month).

### Lessons from the deprecated rollover tool (what to avoid)
- It pulled **account-total spend from the API directly**, separate from the pacer. The new tool builds spend from **per-ad** values in the pacer — keep ONE spend source; do not add a second API path.
- It graded variance against a **moving "adjusted payable"** target, so on-target months read as misses. NEVER grade actual spend against the adjusted target — always against the firm true target.
- It folded the adjustment into one number with **no visible original**, breaking traceability and billing reference. Keep client budget, margin, and carryover as separate inspectable values.

---

## Change 8: Admin overview page (all-accounts billing view)

This is a **separate page from the planner** — an admin overview listing all accounts for a selected month, used as the at-a-glance billing check.

### Headline figures = frozen Client Budget Goal, with a combined total as the primary number
The billing team works off the **combined** number, then verifies the Base and Added components sum to it. So each account's bar shows all three:

```
Account total (billing figure)   = Base + Added       ← PRIMARY number billing references
  Base                           = sum of per-ad Base Client Budget Goals (gross)
  Added                          = sum of per-ad Added Client Budget Goals (gross)
```

- All three are the **frozen Client Budget Goal (gross)** from Change 7 — the typed billing record — summed from that account's per-ad client budgets for the selected month.
- **Never** display a carryover-adjusted or pacing-adjusted figure here. This page is the billing source of truth; it shows true client budget only.
- The combined total is simply Base + Added, displayed so the reconciliation is visible at a glance: billing reads the total, and you can confirm the two components add up to it and are each set correctly.

### Reconciliation expectation
An account's overview figures must equal the **planner's** Client Budget Goal for the same account and month (combined and per-bucket). If the two pages disagree, the freeze isn't being read consistently — worth a built-in check that they match.

### Ad-status aggregation on the bar — KEEP UNCHANGED
The overview bar also aggregates the **statuses of the ads** within each account (e.g. "1 Waiting on Rep," "4 Working on it," "1 Budget Adjustment") so you can see at a glance what still needs doing per account. Clarifications:

- These statuses come from the **ad lines in the planner** and roll up here. This aggregation is existing, useful behavior — **leave it exactly as-is.** None of the changes in this spec should alter it.
- The **"Budget Adjustment"** status is an **ad-level PACING flag** (this ad's daily/lifetime budget needs tweaking to stay on pace). It is **NOT** a client-budget change and has nothing to do with carryover or the billing figures above. Keep it visually distinct from the budget numbers so the two are never conflated.

### To confirm with the team (not assumed here)
- That the combined total is the primary billing figure (Base/Added shown as components) — as described.

---

## Change 9: Alerting system (reduce reliance on remembering to check)

The theme: surface problems automatically instead of relying on someone to go look. **Condition-based alerts are the workhorses; the time-based reminder is a backstop.**

### Alert types (in rough order of value)
- **Significant underspend, low time left** — ad past ~X% of its flight tracking well under target (hard to recover if caught late). *Most valuable.*
- **Overspend / overpacing** — projected spend exceeds target by more than X% (tool already computes projected spend; flag when it overshoots).
- **Ad went dark** — was live, now zero/near-zero recent spend (paused, rejected, or out of budget and unnoticed).
- **End-of-flight approaching** — ad ending in 1–2 days; nudge for final reconciliation.
- **Month-end settlement summary** — when a month closes, list ads over/under the carryover threshold (ties to Change 6/7).
- **Weekly check-in (time-based)** — e.g. Monday reminder. Least powerful alone; see below.

### Design principles (so alerts don't become noise)
- **Configurable thresholds**, not hair-triggers (e.g. ">15% under with <30% of flight left"). Exact numbers = team decision, not assumed here.
- **Per-ad mute**, so known-acceptable cases stop pinging.
- **Fold conditions into the weekly digest:** rather than a bare "go check," the weekly reminder should carry the substance — "Monday pacing check: 2 ads need attention, 12 on track." Reminder + flags arrive together.

### Account-level pacing indicator (top-right summary)
Add an account-wide on-track/over/under status next to the **ACTUAL (PACER)** total in the header (where Total Spend vs Actual is shown). This catches account-level drift that no single per-ad alert would (several ads each slightly off in the same direction summing to a meaningful gap).

- **Compare actual against TIME-ADJUSTED expected spend, not the full target.** Reuse Change 1's fractional pacing. (Raw actual-vs-full-target reads "under" for most of every month and won't be trusted — same caveat as the very first pacing discussion.)
- **Aggregate per-ad, because ads have different flight dates.** Account "expected so far" = sum of each ad's individual expected-to-date: a finished ad contributes its full target; a mid-flight ad contributes its prorated portion. Do NOT compute one account-wide date fraction — a finished ad would wrongly drag the account toward "under."
- Mirror the existing per-ad "ON TRACK" badge styling so the account status reads consistently with the rows.

---

## Change 10: Audit log + bulk-action guardrail

### Automatic audit log (replace "remember to log" with "logged by default")
The current **Log Budget** button depends on a human remembering to snapshot — which means the records you most need (a hasty change right before something broke) are the ones most likely missing. Given this tool touches client billing, logging should be **automatic.**

- **Record every change as it happens**, no button press: daily budget changes, applying a recommended budget, actual-spend updates, carryover applied, budget adjustments, etc.
- Each entry captures **who, what changed, from value → to value, and when** (timestamp).
- This gives a complete history by default and is the foundation for "look back to see what happened before it broke."

### Repurpose the manual "Log Budget" button (don't remove it)
Keep it as an **optional named snapshot / "mark this moment"** — a deliberate human checkpoint (e.g. "end-of-week review, everything set") layered on top of the automatic record. So you keep the button's value (an intentional bookmark) without depending on it for completeness.

### "Set all dailies to Rec." — KEEP, with a guardrail
The bulk-apply button is a real time-saver (14 ads is a lot to do one by one) — keep it. But it's a powerful bulk action, so:

- **Every bulk apply must be fully logged** — one click changing 14 budgets writes 14 entries (or one grouped entry with all 14), so a bulk change is as traceable as individual edits.
- **Show a preview before applying**, flagging the risky ones: "This will change 14 ads; 3 are >20% jumps." This ties to the **learning-phase** concern from the start of the project — a >~20% single change can reset Meta's learning, and a blind "set all" could trip several at once. Confirm-before-fire keeps the convenience while protecting against accidental resets.

### To confirm with the team (not assumed here)
- Specific alert thresholds and which conditions are on by default.
- Exactly which events the audit log captures, and retention period.
- Delivery channel for alerts (in-app, email, etc.).

---

## Change 11: Meta status sync (live / off / completed)

The API returns each ad's status, so the planner's ad status can be kept in sync with Meta — but with deliberate human-in-the-loop control, because the planner status **drives pacing logic and touches billing**, so it must not be flipped by an ambiguous external signal.

### The API provides status
Each ad/ad set/campaign exposes an `effective_status` field (active, paused, etc.) on the same calls already used for spend. No extra access or separate integration.

### Mapping problem: Meta's status ≠ the planner's two end-states
The planner distinguishes two different end-states that Meta does NOT represent directly:
- **"Completed Run"** — ad reached its scheduled end and finished naturally (green banner, "ran through May 23").
- **"Off"** — ad was turned off, possibly early (amber banner, "was scheduled through May 23").

Meta only tells you active/paused/ended — it does not distinguish "finished naturally" from "someone shut it off." That distinction must be **inferred by combining Meta's status with the flight dates:**

```
Meta paused/ended  AND  today >= flight_end   → Completed Run (ended as scheduled)
Meta paused/off    AND  today <  flight_end   → Off / stopped early (someone turned it off)
```

So the planner's states are derivable, but only from Meta status **plus** the date — never from Meta status alone.

### Auto-switch ONLY the unambiguous natural-completion case
- **Auto-apply:** today is past the ad's flight end date → auto-mark **Completed Run**. Low risk; the scheduled time is simply up, no ambiguity.
- **Prompt, do NOT auto-apply:** everything else. If Meta shows paused/off while still inside the flight window, surface a confirm: *"Meta shows 'Bikes & Brews' is off, but it's scheduled through May 23. Mark it Off in the planner?"* with a one-click apply.

### Why not full auto-switch (the failure modes)
The planner status is a human-controlled source of truth with downstream pacing and billing consequences. Meta can show "paused" for reasons that do NOT mean the run is over — hit daily budget for the day, temporary billing hold, payment hiccup. Auto-flipping the planner on those would stop pacing logic and make a still-running ad look done. And the "stopped early" case is precisely when a human should notice (intentional vs mistake). So: detect automatically, but let the human confirm anything that isn't "scheduled time is up."

### Lives within the alerting system (Change 9)
"Meta status ≠ planner status" is a condition-based alert, closely related to the "ad went dark" alert. The tool continuously compares Meta's status to the planner's, auto-resolves only the natural-completion case, and surfaces the rest as specific, actionable prompts — naming the ad, stating both statuses, offering the one-click fix (not a vague "go check your statuses").

### To confirm with the team (not assumed here)
- Which status transitions auto-apply vs require confirmation (recommended: only flight-end-passed → Completed auto-applies; all else confirmed).
- How to treat Meta "paused" mid-flight (likely a temporary-pause alert, not an "Off" switch).

---

## Change 12: Budget calculator (Split type, mid-flight invariants, precision bug)

The calculator distributes budget across selected ads (distribute evenly / set amount / set %, with a "spread remainder"), per pool (Base or Added), and has a Mid-flight Reallocation mode. Three items.

### 12a. BUG: "Entered" total doesn't match the sum of the row values (likely cause — confirm in code)
In the Initial Setup screenshot, Total Budget is $770, but Entered shows $548.87 / Unallocated $221.13, while the visible per-row values already exceed the Entered figure — and one row shows an input box of **$51.03** but a confirmed value of **$51.01**.

**Hypothesis (verify, don't assume):** the "Entered" total is being summed from a *different source* than the row values displayed — either (a) committed/applied values vs edited-but-uncommitted input values, or (b) per-row **rounding** (storing 51.013, displaying 51.01, then summing the rounded numbers). Either produces a phantom remainder even when everything is allocated.

**Fix direction:** sum the **exact same stored values at full precision** that the rows display; round only for display, never sum the rounded numbers. Make "Entered" = the live sum of the same committed row values shown. This precision discipline applies everywhere the calculator totals (including 12b/12c).

> Frame for the dev: "The Entered total ≠ the sum of the visible row values. Find where those two are computed from different sources (uncommitted values and/or per-row rounding) and reconcile them at full precision."

### 12b. NEW: support the "Split" ad type (draws from BOTH pools)
A Split ad pulls from Base **and** Added: you set the Base portion, the remainder is Added — combining the budget while still showing where it comes from. The calculator currently assumes **one pool per calculation** (Base OR Added); Split breaks that assumption.

```
Split ad: base_portion  → counts against the BASE pool total
          added_portion → counts against the ADDED pool total
          base_portion + added_portion = the ad's full spend
```

**Required model change: track two running totals (Base remaining, Added remaining) within a single calculation.** A Split ad consumes from each pool per its breakdown. "Distribute evenly / spread remainder" must keep the pools separate — spread the Base pool across Base portions and the Added pool across Added portions — so a dollar freed in Base isn't silently spread as Added (and vice versa). This is a shift from one-pool to **two-pool tracking**, not just a UI toggle; spec/build it deliberately.

### 12c. Mid-flight reallocation — concept is right; verify the invariants
The model is sound: a donor ad (Off / Completed) locks at its actual Pacer spend, and only its **unspent remainder** frees up to redistribute. The screenshot shows it working (e.g. a donor Locked at $51.01 with $0.02 available; another Locked at $54.60 with $0.00 available). Confirm these invariants:

- **Freed amount = donor's original allocation − donor's locked actual spend.** Free exactly that, NOT the donor's full original allocation (which would over-distribute).
- **Lock on the settled/final spend.** Once the Meta API (Change 3) feeds actual spend, the donor should lock on the *finalized* number, not a possibly-stale or provisional figure (ties to the provisional-spend caveat). A donor that's Off/Completed has settled spend.
- **Redistribution sums to the freed total to the cent** (same precision discipline as 12a).
- **Donor auto-lock is triggered by status** — which is governed by Change 11 (Meta status sync). When Meta marks an ad Off/Completed and the planner status updates, that is what should trigger the donor-lock here. Build both to read the **same** status signal rather than each computing status independently.

### To confirm with the team (not assumed here)
- For Split ads in "distribute evenly," confirm pools stay separate (Base spreads to Base portions, Added to Added portions) — as specced.
- Confirmation of the exact precision/rounding rule (recommended: store full precision, round only for display).

---

## Summary for the dev

| Change | What | Touches |
|---|---|---|
| 1 | `days_remaining` → fractional time-to-flight-end | Future / time-left math |
| 2 | All date math in account timezone | Future / time-left math |
| 3 | Live Meta API spend pull; drop manual entry & "as of" override | Past / spend-so-far math |
| 4 | Pull schedule from Meta; clamp dates AND spend to the pacing month | Both halves / scoping |
| 5 | Month selector; live-vs-frozen month model; per-month storage | Prior-month viewing |
| 6 | Over/Under page: variance vs margin-adjusted target (both views); elapsed-days as status only; carryover | Settlement / reconciliation |
| 7 | Carryover into planning: adjust derived target, freeze Client Budget Goal; opt-in apply; choose Base/Added bucket | Planning / billing integrity |
| 8 | Admin overview: combined total (primary) + Base/Added components, all frozen Client Budget Goal; keep ad-status aggregation unchanged | All-accounts billing view |
| 9 | Alerting: condition-based alerts + weekly digest + account-level pacing indicator (time-adjusted, per-ad aggregated) | Proactive monitoring |
| 10 | Automatic audit log; repurpose manual snapshot; preview/guardrail on "Set all dailies" | Traceability / safety |
| 11 | Meta status sync: auto-complete only on flight-end-passed; prompt-to-confirm all else | Status / pacing control |
| 12 | Budget calculator: fix Entered-vs-remaining precision bug; add Split (two-pool) type; verify mid-flight invariants | Allocation / calculator |
| — | Late launch → higher daily rate (no pro-rating); falls out of clamping `effective_start` | Behavior decision |
| — | Freeze closed months end-to-end (spend + flight dates + target), not just spend | Data integrity |
| — | Carryover opt-in & visible, never silent; never touches Client Budget Goal field | Audit trail / billing |
| — | Gross Allocation may exceed client budget by the carryover — label it so it doesn't read as an error | Display clarity |
| — | "Budget Adjustment" is an ad-level PACING status, not a client-budget change — keep distinct | Avoid conflation |
| — | Each month's variance measured from its own original budget; no auto-chaining | Auditability |
| — | One spend source (the pacer); no second API path for rollover/Over-Under | Architecture |
| — | Alerts: configurable thresholds + per-ad mute so they don't become noise | Alert usability |
| — | Bulk "set all" must be logged and preview >20% jumps (learning-phase risk) | Traceability / safety |
| — | Meta "paused" ≠ run over; only flight-end-passed auto-completes, all else confirmed | Status / pacing control |
| — | Calculator: store full precision, round only for display; never sum rounded values | Calculator correctness |
| — | Split ads need two-pool tracking (Base + Added kept separate) | Calculator correctness |
| — | Treat current-day spend as provisional; reconcile prior day mid-morning | Data accuracy |
| — | (Future) performance reporting = same Insights endpoint, more fields; likely tier-upgrade trigger | Roadmap |
| — | (Later) repeatable fetch → intra-day drift alerts | New feature |

Changes 1–2 (pacing math) and Change 3 (API spend) are independent and can ship separately. Change 4 depends on the Meta API being connected (Change 3). Change 5 builds on Change 4. Change 6 (Over/Under) reuses the per-account margin field and the Change 5 freeze, but its core variance fix can be done without the API. Change 7 (carryover into planning) depends on Change 6's over/under figure and the planning page's derived-target model; no API needed. Change 8 (admin overview) depends only on the frozen Client Budget Goal and existing ad-status aggregation; no API. Change 9 (alerts) reuses Change 1's fractional pacing for the account indicator and benefits from Change 3's automated spend (so condition-based alerts can run on fresh data). Change 10 (audit log) is largely independent and underpins safety for the carryover (7) and bulk (set-all) actions. Change 11 (Meta status sync) depends on Change 3 (status comes from the API) and lives within Change 9's alerting system. Change 12 (calculator): the precision bug (12a) is independent and can be fixed now; the Split type (12b) is a self-contained model change; mid-flight invariants (12c) tie to Change 3 (settled spend) and Change 11 (status-triggered donor lock).
