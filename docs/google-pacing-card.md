# Google pacing card

The Google Ads **Pacing** tab: a top-down account allocator plus flight-aware
pacing. Replaces the per-campaign island-budget pacer, where every campaign was
paced against its own hand-set budget — there was no single account total driving
the dailies, so moving spend meant editing every campaign by hand and nothing
showed whether the account as a whole was allocated correctly.

Meta's pacing card is unchanged apart from the shared label/filter layer (§6).

**Addendum:** `google-pacing-card-budget-report.md` covers the budget report on
the delivery panel, the editable daily budget with its live projection, the
reworked account header, and the allocation precision fix. Where the two
disagree on wording or layout, the addendum is the later decision.

## The shape of it

```
payable ──► per-campaign share ──► monthly target ──► recommended daily ──► Google
```

- `src/lib/ad-pacer/google-allocator.ts` — all the arithmetic. Pure, no React/DB/API.
- `src/lib/ad-pacer/labels.ts` — labels + event budgets, shared with Meta.
- `src/app/app/tools/google/_components/GooglePacingCard.tsx` — the card.
- `src/app/app/tools/google/_components/GoogleDeliveryExpander.tsx` — §5 row panel.
- `src/app/app/tools/_shared/LabelChips.tsx` — label chips + filter bar (both platforms).
- `src/app/api/google-ads-pacer/[accountKey]/push-budgets` — the batched write.
- `src/app/api/google-ads-pacer/[accountKey]/campaign-health` — the panel's series.

## 1. Payable

`payable = (googleBaseBudgetGoal + googleAddedBudgetGoal) × markup`

The client's gross budget for the month times the account's markup — i.e. the
spend that actually reaches Google. It is the denominator every allocation is
measured against, and it comes from the numbers already typed on the Planner tab;
there is no second, card-local budget field.

**The reconciliation carryover is deliberately excluded**, even though the
Planner's budget panels fold it into their derived target. Prior-month over/under
is applied by hand into the budget number when the desk wants it paced, so adding
it here as well would double-count it — and a denominator that moves on its own is
one nobody can reconcile against a spreadsheet. When a month does carry one, the
card says so on the payable tooltip instead of absorbing it.

## 2. One unit for the whole card

Either **percent of payable** or **dollar amounts**, never mixed per line.
Switching converts every line in place and moves no target — a switch is a change
of notation, not of plan.

Percent is *always* percent of payable, never of "payable minus the locked lines".
There is no pool concept; reintroducing one is what produced the toggle-drift and
pool-shrink bugs in the earlier drafts.

`allocation` (dollars) is written on every save in both modes, because
reconciliation, the budget panels and the over/under all read dollars and must not
learn about modes. `allocationPercent` is stored *additionally* in percent mode, so
the dollar target can be re-derived when the payable changes — impossible from a
stored dollar alone.

## 3. Whole-day anchoring

`recommendedDaily = (target − spent) ÷ remaining whole flight days`

Both terms are measured to the same point in time: the **data edge**, the last
whole day with complete Google data (the latest date in the synced spend series,
capped at yesterday because today is always partial). Elapsed time shows up in
`spent`, never in the day count.

Both terms, literally: the sync's own month window (`periodWindow`) ends at the
data edge too, so `pacerActual` is finalized spend. It used to run through today
while the day count stopped at yesterday, which put a partial day in the
numerator and not the denominator — the recommendation then slid down through
the afternoon with nothing behind the move, and every pace badge read slightly
ahead. Today's spend still arrives, via the daily-spend series, and is shown
only as the separate "today so far" figure. Meta's window keeps running through
today on purpose: its rolling 7-day model makes spend-to-this-instant the
consistent choice there.

Pairing a fractional day count with a lagging numerator makes the recommendation
creep up through the day and drop when new data lands — a visible sawtooth with no
real cause. It also matches Google's own mechanics: Google paces budget changes
over remaining *calendar* days and treats the daily as a monthly average.

**Meta keeps fractional days.** Its budget model is a rolling 7-day average, not a
monthly one, so the whole-day helpers are Google-only by design.

When the sync is behind, the edge follows the series (not yesterday) and the card
says "Sync behind" — spend and days then stop at the same instant.

## 4. Flight windows

Auto-derived, clamped to the month in view:

```
start = max(override ?? googleStartDate ?? liveDate ?? flightStart, month start)
end   = min(override ?? googleEndDate   ?? flightEnd,               month end)
```

A campaign that started in a prior month is simply the full current month; its raw
lifetime start is an *input* to the clamp, never the flight itself. This lives in
`clampToMonth`/`scheduleEndpoints` (pacer-calc), so the card, eligibility and
reconciliation cannot diverge — before this, Google rows read only the Meta and
planner date fields, so a synced `googleStartDate` never reached the pacing window
and a mid-month launch paced from the 1st.

`googleFlightStartOverride` / `googleFlightEndOverride` exist for the funding
window the API can't express (the campaign existed on the 1st but wasn't funded
until mid-month). Editable in the delivery panel, kept separate from the planner's
`flightStart`/`flightEnd` so a pacing override never rewrites the plan.

## 5. Delivery row panel

Opened from a row's pace chevron, inline, and **multi-open** — any number of rows
at once. It exists because the pace badge cannot tell the two underspending cases
apart: "behind but delivering its full daily" needs a higher cap, "spending half
its cap" cannot absorb more budget at all and the money should go elsewhere.
Verdict is `avgDailyDelivered ÷ cap`.

It replaced a modal. Choosing who gives budget and who gets it is a comparison,
and a modal can only show one campaign while covering the table you are comparing
it against.

**Every finalized day of the flight, not a rolling window.** The old 7/14/30
selector answered a different question each day you opened it, and its 30-day
setting counted back past the 1st, so a chart opened early in a month was mostly
last month's campaign. The window is now flight start → data edge: same question
every day, no prior-month contamination.

**Today is never a bar.** It is a partial day, so it would read as a collapse in
delivery and would drag the average the verdict is computed from. It appears once,
as a hatched "today so far" strip, plus a `~live total` line (finalized + today)
that exists purely so the finalized figures tie out against what someone sees in
the live Google Ads account.

It also carries the one piece of reasoning the recommendation deliberately no
longer holds: whether the remaining budget can *physically* still bill, given
Google's ~2×-daily single-day ceiling.

Reference metrics (conversions, cost/conv, CTR) are labeled reference and point
back to the platform — conversion tracking quality varies far too much across
these accounts to render an automated good/bad verdict on the card.

**Opening a row costs no Google call.** The chart reads the already-synced
`MetaAdsPacerDailySpend` rows (120-day retention) and the metrics read columns the
account sync wrote. That is load-bearing, not incidental: the metrics used to be a
live single-campaign read fired on each open, which multi-open would have turned
into one API call per open row. Nothing here may reintroduce a per-open live read.

## 6. Labels and event budgets

Free-text labels per campaign, plus a filter bar. **Shared with Meta** — tagging a
line and viewing it as a slice is the same job on both platforms, and two
implementations would drift into two label vocabularies. (The allocator itself is
Google-only; Meta gets tags + filtering.)

Labels are **independent of `budgetSource`** (base/added). They answer different
questions — "which pool pays for this" vs "which push is this part of" — and any
rule deriving one from the other would move money between pools as a side effect
of tagging.

When a filter is active, **every** summary number rescopes to the subset: the
totals row, the meter, the header stats, the pace, and the Move panel's lists. A
filtered view that keeps account-wide totals is worse than no filter, because the
numbers look authoritative while describing a different set of campaigns.

An **event budget** is the intended budget for a label. It is a *check*, never a
denominator: unfiltered, allocation is always measured against payable. Unallocated
is not offered as a Move source inside a label view — the leftover belongs to the
account, and spending it there would quietly pull account budget into an event.

## 7. Locking, Balance, Move

- **Lock** = a fixed carve-out. It changes no numbers; it only removes the line
  from Balance and from Move (as both source and destination). It does *not*
  exempt the line from a budget push — the rate it needs is still the rate it needs.
- **Balance** makes the plan total the denominator using only unlocked lines,
  keeping proportions (default) or splitting evenly.
- **Move** conserves the total: destinations gain, a campaign source loses the
  same sum. An "Unallocated" source consumes the leftover instead. Capped at what
  the source has; previewed before commit; undoable.

## 8. Pushing budgets

One batched `campaignBudgets:mutate` per account, not one request per campaign.
The plan is recomputed **server-side** from the stored allocations rather than
trusting numbers posted by the client, so a stale tab can't write last hour's
dailies onto live campaigns.

Held back, each for its own reason:

| Skipped | Why |
| --- | --- |
| Unlinked rows | No budget resource to mutate |
| Total-budget (`CUSTOM_PERIOD`) | Google paces those to their own end date; there is no daily to set |
| **Shared budgets** | Several campaigns point at one budget, so per-campaign daily control doesn't exist. Flagged, never silently pushed — writing one campaign's number onto a shared budget changes campaigns nobody touched |
| Drift under threshold | 5% or $1, whichever is larger. Frequent daily-budget edits disrupt smart bidding's learning (tCPA/tROAS, Performance Max) |

`partialFailure` is deliberately off: the operations are one intended plan, so a
half-applied plan is worse than a rejected one.

## What this replaced

The four-state recommendation engine (`on_track` / `adjust` / `delivery_limited` /
`shortfall`) no longer drives the Google number. The recommendation surface is now
stateless arithmetic on target, spent and remaining days; the delivery reasoning it
used to fold in moved to the delivery panel, which is where it can be read against
the actual delivery picture. `buildGoogleRecommendation` and
`buildGooglePacingCard` remain in `pacing-engine.ts` / `google-pacer-calc.ts` and
are still unit-tested, but nothing in the Google UI calls them.

## Known gaps

- **Cross-month resolution for Google lines** has no UI. It used to be reachable
  only through the expanded `PacerRow`, which the Pacing tab no longer renders.
  The spec puts cross-month outside this card ("handled elsewhere"), but for
  Google, "elsewhere" does not exist yet — it belongs on the Reconciliation tab.
- **Ad-schedule campaigns** are badged, not modeled. Since Google's June 2026
  change they pace the full monthly cap into their active days, so calendar-day
  math reads them slightly low.
