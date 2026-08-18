# Google pacing card — budget report and layout addendum

Builds on `docs/google-pacing-card.md`. This addendum captures the layout and
behavior changes worked out in the budget-report session: a Google-native budget
report on the delivery panel, an editable daily budget with a live projection, a
reworked account header, and a set of smaller display and correctness fixes.

Nothing here changes the allocator's arithmetic. The recommended daily is still
each line's own `(target − spent) / daysRemaining`, and the account total is still
their sum. These are display, interaction, and one precision fix.

## Terminology: drop "cap" on the daily readout

"Cap" is retired from the daily delivery readout. On the delivery graph and in the
delivery verdict, the line the bars are measured against is the **daily budget**,
never "cap." The word collided with the monthly spending limit, which is a genuine
hard ceiling and a different number. The monthly limit keeps its own name, the
**billing ceiling** (daily budget × 30.4), so the two never read as the same
thing. This replaces the current `VERDICTS` copy in `GoogleDeliveryExpander.tsx`
("Spending to cap", "Delivering to cap", "% of cap") with daily-budget wording
(§4.4).

## Files touched

- `GooglePacingCard.tsx` — account header, the row, footer total, allocation cell, lock, `PlatformStatusPill`, `LiveDailyTotal`, the edit-daily control.
- `GoogleDeliveryExpander.tsx` — budget report charts, money line, Quick campaign insights, delivery verdict copy.
- `google-allocator.ts` — the percent-precision fix (`inputOf`, and the mode-convert path).
- `google-ads-pacer.ts` — `googlePrimaryStatus` / `googlePrimaryStatusReasons` surfaced to the status line; `change_event` backfill for the budget-change log.
- `PacerRow.tsx` (shared) — the existing edit box, `pushLabel`, and live projection pattern to mirror for Google.
- Schema, already present: `MetaAdsPacerDailySpend` (`spend`, `dailyBudget` per platform/campaign/day), `MetaAdsPacerBudgetLog` (the audit log).
- `google-chart.tsx` — the Google Charts wrapper exists but is unused; the daily-bar pattern in the delivery expander is the lighter path to extend.

---

## 1. Account header rework

The old header mixed two questions into five equal boxes: budget health and
pacing. Split them. Budget health lives in the allocation module (§1.2); pacing
becomes a lighter verdict-forward strip (§1.1). Client budget and actual spend
move down into the allocation module where they anchor the over/under math, so
they are not repeated up top.

### 1.1 Pacing strip

Borderless, no cards. Leads with the account pace verdict (Underspending /
On pace / Overspending) as the prominent element, mirroring how the allocation
module leads with its badge. Beside it, a row of label-plus-number stats with thin
dividers, no borders:

- Spent MTD (through the data edge date)
- Expected MTD (even pace)
- Left to spend (actual spend − spent)
- Daily needed (`/day`, across the count of daily-controllable, non-reserved campaigns)
- Days left (`of N`, counted from the data edge, whole days)

The verdict color follows the existing pace tone. Daily needed carries the accent
color since it is the one number the desk acts on.

### 1.2 Allocation module (Meta-style)

Mirrors the Meta budget bar. A titled module ("Account allocation") with a health
badge, a borderless quartet, the percent bar, and the campaign legend.

**Health badge**, three states, driven by allocated vs actual spend (payable):

- **Fully allocated** (green) when allocated equals actual spend. (This is the
  state formerly shown as "Zeroed"; use "Fully allocated".)
- **Over** (red) with the dollar overage when allocated exceeds actual spend.
- **Unallocated** (amber) with the remaining dollars when allocated falls short.

**Quartet**, borderless label-plus-number, no boxes:

- Client budget (gross)
- Actual spend (payable; sub-note "× NN% markup")
- Allocated (sub-note "across N campaigns")
- The health number: `$0.00` fully allocated, the overage, or the unallocated remainder, colored to match the badge.

**Percent bar** with the allocated-over-payable percent on the right (100% when
fully allocated, 108.5% when over, and so on, same as Meta). Reserved is called
out separately ("$X reserved") and rendered as a visually distinct striped segment,
since a reserve holds allocation but sits out of pacing.

**Legend**: one chip per campaign, color swatch, name, dollars, and percent of
payable. Reserved campaigns show "reserved" in place of a pace reading.

---

## 2. The collapsed pacing row

### 2.1 Name line: channel type right, status underneath

Retire the right-of-name status dot (`PlatformStatusPill`'s dot branch). It reads
as a second color dot next to the allocation color swatch and confuses the two.

- The channel type (`line.channelType`: Search, PMax, Display, and so on, already
  synced) moves up to sit directly to the right of the campaign name.
- Platform status moves to a text line underneath the name: **Enabled** or
  **Paused** first (from `googlePrimaryStatus`), then the reason if any (for
  example "Limited by budget", "Eligible") from `googlePrimaryStatusReasons`.
- The **mismatch** case stays a real badge, not quiet text: when Loomi is pacing a
  campaign as active but Google reports it not serving, that is an error to catch,
  not a status to note. Keep the existing mismatch badge treatment.

### 2.2 Pace badge

The Pace column keeps the pace-vs-target verdict but reworded and re-styled:

- Labels: **On Track**, **Over Pacing**, **Under Pacing** (from "On track",
  "Overspending", "Underspending").
- Rendered as a filled pill badge (tinted background plus colored text), not plain
  colored text. Colors follow the current pace tones (on = success, over = warn,
  under = the violet/pro tone reserved for underspend; red stays for can't-serve).
- Keep the small line beneath: pace percent and the signed amount vs expected.

The pace badge stops being the control that opens the delivery panel. It is
display-only now, because the whole row becomes the click target (§2.3).

### 2.3 Row expander: whole-row click plus chevron

The panel currently opens only from the pace text. Make the whole collapsed row the
click target, with a row-level chevron as the affordance. Clicking the chevron or
anywhere in the row opens and closes the delivery panel. The row's interactive
controls (the allocation input, the lock, the reserved toggle, the edit-daily
pencil) must `stopPropagation` so operating them does not also toggle the row.

### 2.4 Edit daily budget

Replace the "apply recommended" lightning control with an editable daily budget,
mirroring the Meta pacer. The box mechanics (the number field, the `/day` suffix,
Cancel/Done, `pushLabel`) already exist in the shared `PacerRow`; bring that
interaction onto the Google card with `pushLabel="Push to Google"`.

Layout in the daily area:

- **Current daily** number with the **edit pencil** beside it. The pencil is
  icon-only with an "Edit daily budget" tooltip on hover. It sits by the current
  daily because the box edits that value.
- **Recommended** daily stays to the right with the **arrow** on its right side.

The box:

- Opens populated with the **current** daily (not the recommended), so it is clear
  which number is being changed.
- Keeps the `/day` suffix.
- **Cancel** discards the entry without writing.
- The moment the typed value differs from current, a **Push to Google** button
  appears. Push writes the value and flips to a pushed confirmation; **Done** closes
  the box.
- Any custom value still routes through the existing guarded push, so shared-budget
  and total-budget campaigns stay skipped.

The arrow: in the resting view it shows the recommended relative to the current
(the gap to the recommendation). While editing it re-references live to the number
being typed, so it always describes the prospective daily against the
recommendation. It flips direction as the typed value crosses the recommendation.

### 2.5 Live projection while editing

As the daily is typed, project live. Google is not Meta here: a linear
daily-times-days projection would overstate a campaign that is not filling its
budget and would re-introduce the overpacing fantasy the card already removed.

Compute the live monthly projection as:

```
min( recentPaceProjection, spent + typedDaily × remainingDays )
```

where `recentPaceProjection = spent + recentAvgDaily × remainingDays`, and
`recentAvgDaily` is the finalized delivery average already used by the delivery
verdict (no extra API call; it reads the synced series).

- Raising the daily above what the campaign is delivering: the projection holds
  (recent pace is still the binding constraint), while the billing ceiling below
  it rises to show the new headroom.
- Lowering the daily below current delivery: the projection drops, because the
  budget is now what caps it.

Show the live readout **inside the edit box** so it is visible whether or not the
row is expanded, and mirror it into the expanded money line (§4.2) when the row is
open. The billing ceiling figure updates live alongside it.

---

## 3. Allocation cell and lock

### 3.1 Dual-unit allocation cell

Collapse the allocation input and the Target Spend column into one cell. In dollar
mode those two showed the same dollars twice; in percent mode they showed percent
and its resolved dollars. One cell resolves both:

- The active unit is the large, editable value; the other unit rides underneath in
  muted text ("14.5% of budget" under `$1,694.00`, or the dollars under the
  percent).
- The unit toggle (`$` / `%`) picks which unit is editable. Both units are always
  visible regardless of mode.
- The standalone Target Spend column is removed from display (the dollar target
  remains the canonical value the pace math uses).

### 3.2 Lock disables the input

The lock is half-wired. `balance` and the move tool already treat a locked line as
untouchable, so redistribution will not move it. The gap is the manual input: the
allocation cell is disabled by `readOnly` only. Add `line.locked` to that disable
condition and give the cell a locked affordance (lock glyph, no edit underline).
Lock then means the target does not move for anyone, by hand or by rebalance, until
unlocked.

---

## 4. The expanded delivery panel

The panel gains a Google-native budget report, keeps its delivery reasoning, and
gets two clean stat lines bracketing the charts: a money line on top, a reference
line at the bottom.

### 4.1 Budget report charts

Two stacked charts, cumulative on top and daily bars below, modeled on Google's own
budget report. All the data is already in `MetaAdsPacerDailySpend` (per
platform/campaign/day, 120-day retention).

**Cumulative chart** (four series):

- **Target pace** (primary reference), the even-spend line from zero to the monthly
  target. Hover tooltip explains it is what the card grades against.
- **Billing ceiling** (secondary), stepped, from the per-day `dailyBudget` history
  times 30.4 with the mid-month recompute. It steps at each budget change. Hover
  tooltip explains it is the most Google can bill.
- **Cost to date** (solid), cumulative finalized `spend` to the data edge. Today is
  not folded in; it shows as a separate hatched marker at the edge.
- **Loomi projection** (dotted, with a light band), from the data edge to month
  end, held under the billing ceiling.
- Both reference lines carry hover tooltips (target vs ceiling) so the two are never
  confused.

**Daily bars**:

- Blue bar = that day's actual `spend`.
- Gray bar behind = that day's daily spending limit (2 × that day's `dailyBudget`).
  Because `dailyBudget` is frozen per day, the gray bars step at each budget change
  on their own.
- Today is the hatched strip, never a solid bar. Future days show the gray limit
  outline only.
- Caveat, already a known gap: ad-schedule campaigns concentrate the limit into
  active days, so for those the gray-bar logic must follow the schedule rather than
  assume all days. Fine to ship badged, not modeled, as today.

**Placement**: compact version on the row, full two-chart view behind a "budget
report" expand, so the card stays scannable.

**Rendering**: extend the hand-rolled bar approach already in
`GoogleDeliveryExpander` rather than pulling in the unused Google Charts wrapper.

### 4.2 Money line (reordered)

The money numbers sit as one stat line above the chart, in this order:

**Monthly target · Cost to date · Remaining · Monthly projection · Billing ceiling**

The two "where it stands now" numbers (cost to date, remaining) sit together before
the two forward-looking ones. Monthly projection is the single recent-pace number
(§4.3), with the delivery ceiling comparison in its tooltip. This line replaces the
old "Where the month lands" block, which showed the projection and remaining a
second time; fold it up so the projection appears once.

### 4.3 Quick campaign insights (one line)

The six "Month to date" performance metrics become one labeled reference line at the
bottom of the panel, titled **Quick campaign insights** (keep a "through [date]"
sub-label so the month-to-date scope survives the rename):

Conv rate · Cost / conv · Avg CPC · CTR · Lost IS (budget) · Lost IS (rank)

Informational only, one neutral weight, no verdict coloring. The two Lost IS metrics
keep their hover hints (budget vs rank constraint). This stays its own line, not
merged into the money numbers, because these are soft reference figures whose
quality varies by account and should not sit at equal weight with the firm dollars.

### 4.4 Delivery read (daily-budget language)

The plain "how it is spending its daily budget" read stays in the expanded panel,
not on the collapsed row. Reword the `VERDICTS` states off "cap" and onto daily
budget, keyed to the last 7 finalized days:

- spending its **full** daily budget
- spending **below** its daily budget
- spending **above** its daily budget

Neutral, descriptive, no prescription. The "% of cap" readout becomes "% of daily
budget." The prescriptive part (whether to spend more) is carried by the
recommended-daily number, not by this read.

### 4.5 Budget-change record

A permanent per-campaign budget-change log, feeding the "set on [date]" line and the
on-chart change markers.

- The native `MetaAdsPacerBudgetLog` (account, period, snapshot, author, note,
  timestamp) is the durable record and the same surface as the move log.
- Google's `change_event` is a backfill only, for edits made directly in Google
  outside Loomi. It is capped at the last 30 days, so it cannot be the source of
  record; the UI's two-year history is not available via the API.
- The chart markers can also be derived directly from `dailyBudget` transitions in
  the daily series (the "budget-change divider" the schema already anticipates).

---

## 5. Footer total

The recommended-total cell is carrying three things and reads cramped: the plan
total, a restatement of the live total, and the integrity badge.

- Drop the **"live $340.00"** restatement. The current-daily column already totals
  that exact number in the cell immediately to its left; printing it twice is the
  clutter.
- Keep the plan total clean, with a single small stacked delta beneath it ("$56
  under live") for the gap.
- Move the **integrity badge** to the allocation total, where it belongs, and word
  it for what it checks: **Fully allocated** / **Under-allocated**. Its current job
  is verifying the allocation sums to the denominator, which is a property of the
  allocation column, not the recommended column. Its "therefore this matches Google
  Ads Manager after applying" claim becomes the badge's tooltip.
- When the plan is **under**-allocated, the recommended total is understated; in that
  state (only) it can dim or carry a quiet "plan incomplete" note. When fully
  allocated, a clean number needs no green badge.

The gap between live and plan is a readout, not an error. A partial apply is the
normal end state: apply the working raises and cuts, leave demand-limited
underspenders alone, and move their budget. The footer reports the gap without
nagging to close it.

---

## 6. Precision fix: the cent drift

Allocations set to fixed numbers drift by a few cents on refresh, and amounts set on
the Planner arrive on the Pacer a few cents off. Same root cause, two symptoms.

**Cause.** The allocator can hold an allocation as dollars or as a percent, and when
it only has one it derives the other. The derive-percent-from-dollars step rounds the
percent to two decimals (`inputOf`'s fallback: `round2((dollars / payable) * 100)`),
and then the dollar target is rebuilt from that rounded percent
(`targetOf` in percent mode). That round trip is lossy. A line at `$1,694.00` might
be 14.4874% but gets stored as 14.49%, and 14.49% of payable rebuilds a few cents off
`$1,694.00`. Pure dollar mode reads the stored dollars straight and is stable; percent
mode, and any row whose percent had to be inferred, goes through the lossy rebuild. The
Planner writes a clean dollar amount with a null percent, so the moment the Pacer needs
a percent for that row it infers one at two decimals and the dollars come back light.

**Fix.** Stop letting a two-decimal percent regenerate dollars. Keep the dollar amount
authoritative, and when a percent is genuinely needed (so a payable change can re-derive
dollars), carry it at full precision rather than rounding to two places, so
`percent / 100 × payable` lands back on the exact cents. Display the percent rounded,
store it exact. This closes both the refresh wander and the Planner handoff.

**Confirm.** After the fix, check that a fixed dollar allocation does not drift on refresh
in pure dollar mode with an unchanged account budget. If it still does, there is a second
contributor, most likely the payable being recomputed with slightly different precision
between loads, or rows being re-saved on mount; chase that next. The percent round trip is
a real and sufficient cause for what is described here and is the first thing to fix.
