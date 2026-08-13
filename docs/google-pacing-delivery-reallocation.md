# Loomi Google Pacing — Delivery Surface and Reallocation
### Expandable delivery row, campaign metrics, projections, Compare, Move, Reserved, and the apply model

**Scope.** Extends the shipped Google pacing card ([docs/google-pacing-card.md](google-pacing-card.md)). This document adds the expandable per-campaign delivery surface, the campaign metric set, the two projections, Compare, the two-entry Move tool, the Reserved status, the Lock clarification, the Google platform status badge, and the apply model. It replaces the standalone delivery-health modal.

Where a section modifies something already built, it says so and names the file.

---

## 0. Changes from the submitted draft

The draft was reviewed against the shipped code. Eleven items changed; everything else is the draft's design, kept.

| # | Draft said | Corrected to | Why |
|---|---|---|---|
| 1 | Metric tiles ride "the existing aggregate campaign-level MTD call, no new call" | They ride `fetchCampaignSpend` — the account-wide MTD query the **sync** already runs — and are persisted per campaign (§4) | There is no aggregate metrics call today. Metrics come from `fetchCampaignWindowMetrics`, a *single-campaign* live read fired on modal open. With multi-open expanders that is one Google call per open row |
| 2 | The CAPPED/HEADROOM tag "fires off underspending vs target" | The tag fires off Google's own `BUDGET_CONSTRAINED` primary-status reason (§8) | `GooglePacingCard.tsx` renders it from `line.budgetLimited` ← `googleBudgetConstrained`. The fix is to qualify that signal and rewrite the tooltip, not to replace a pace heuristic that isn't there |
| 3 | Re-pulling the last few days is "optional hardening, not required for v1" | Removed — already shipped (§3) | The sync re-pulls a rolling 10 days every run (`DAILY_SPEND_INCREMENTAL_DAYS`), so Google's ~48h revisions are already absorbed |
| 4 | `recent_daily_avg` is "windowed and flight-clamped", skipping "an obvious launch ramp" | Pinned: last 7 finalized flight days, ≥3 with non-zero spend, leading zero-spend days dropped (§5) | Not implementable as written |
| 5 | Move log is a new persistent log | Move logs to `MetaAdsPacerAuditEntry` as a new action (§9) | That table already carries account/period/platform/ad/from/to/summary/groupId/author and already records `budget_push`. A parallel table splits the trail |
| 6 | Per-campaign min/max daily guardrails | Cut. Replaced with a non-blocking outsized-catch-up warning (§9) | Clamping the recommended daily breaks the property that the account daily total equals remaining budget ÷ remaining days, which is the number the footer reconciles against |
| 7 | Platform status badge is new work | Mostly a port of `normalizeAdStatus`/`adStatusTone`; the one real gap is persisting `primary_status_reasons` (§13) | `platform-status.ts` already normalizes both platforms to one vocabulary with a tone helper; `googlePrimaryStatus` is already synced |
| 8 | "Movable = target − spent MTD" | Same, floored at zero (§6, §9) | `remainingBudget` is already `max(0, target − spent)`. An overspent campaign is $0 movable, not negative |
| 9 | Move "conserves the account total by construction" | True for campaign sources; the existing **Unallocated** source is the one documented exception (§9) | That source deliberately consumes leftover and raises the allocated total |
| 10 | Footer compares recommended total to live total | Both totals dedupe on `googleBudgetResourceName` (§14) | Google holds one budget for several campaigns, so a per-campaign live sum double-counts shared budgets and "in sync" would never be reachable. The recommended total drops on shared-budget accounts; that is the correct number |
| 11 | AC 17 asserts ~86% / ~$320 vs 74% / $397.48 | Restated as a property, with the AFCU figures as the worked example (AC 17) | One account on one day is not a testable criterion |

Also newly specified, because the draft did not cover them: Reserved's interaction with Balance, alerts and month-end variance (§12); expander behaviour in a past or frozen month (§1); the Compare surface and selection affordance (§10); and the shared-budget guard on the single-push API (§14).

### The spend window (found during build, fixed)

Invariant 2 was not actually true of the shipped code. Google's month-to-date spend was pulled from the 1st through **today**, while `resolveClock` counted days through **yesterday** — so `(target − spent) ÷ remaining days` carried a partial day in the numerator and not the denominator. The recommended daily slid downward through the afternoon as spend accrued against a day count that had not moved, which is the drift whole-day anchoring exists to remove, and the pace badge read every campaign slightly further ahead than it was. It also made §3 meaningless: a "live total = finalized + today" line is the same number as MTD if MTD already includes today.

`periodWindow` now ends at the data edge for every Google spend read (sync, discover, import), with an `empty` flag for a window holding no finalized day — the 1st of the month, or a month that has not started — so no caller sends Google a backwards date range. Meta's window deliberately still runs through today: its pacer is fractional-day and rolling-7-day, so spend-to-this-instant is the consistent choice there.

---

## Global conventions (unchanged, restated because everything here depends on them)

- **Data edge = last full day.** All pacing math anchors to finalized spend through yesterday. Today's partial spend never enters any verdict, projection, recommended daily, or account total.
- **Whole days only.** Day counts are whole calendar days counted from the data edge, inclusive per the base spec. No fractional/live-clock days.
- **Flight clamp.** Any per-campaign window is clamped to the campaign's flight: start is the later of the campaign start and the 1st, end is the data edge. Windows never cross into a prior month. (`resolveFlight`/`clampToMonth`.)
- **Spend is a fact, targets are the lever.** Spent MTD comes from the platform and is never edited or moved by Loomi. Reallocation moves *target* (allocation), never spend.
- **Currency.** Everything compared or validated is in actual-spend dollars, per the base spec.

---

## 1. Expandable delivery row (replaces the modal)

`GoogleDeliveryHealthModal.tsx` is retired. Its contents move into a row expander opened from the pace chevron, matching the Meta pacer's expand pattern.

- **Multi-open.** Any number of rows may be expanded at once. Expanding one never collapses another. The state already exists (`expandedIds` in `GooglePacingCard.tsx`) and is a `Set`, so the multi-open behaviour is the plumbing that is already there; only the chevron's handler changes from "open modal" to "toggle expander".
- **Trigger.** The existing pace chevron on the collapsed row. No separate modal launch.
- **Full-width panel** beneath the row, not a tooltip. Roughly the height of the Meta expanded card, likely slightly shorter (no Linked/sync controls needed here).

### Panel contents, top to bottom

1. All-days delivery graph (§2)
2. Today-so-far strip (§3)
3. Live-total reference line (§3)
4. Metric tiles (§4)
5. Projections (§5)
6. Remaining budget (§6)
7. Delivery verdict line (§7)
8. Flight-date editor (the existing `FlightEditor` moves here unchanged)
9. Refresh from Google (§4)

### Past and frozen months

The card is period-scoped, so an expander can be opened on a month that has already closed. In that case:

- The **data edge is the month end**, not yesterday. The graph runs flight start → month end.
- **No today-so-far strip and no live-total line.** There is no "today" inside a closed month, and a strip showing the current day's spend under a June header is a lie. Suppress both; the as-of stamp reads the month end.
- **Projections are suppressed** — there are no remaining days to project into. Show the final figures instead.
- **Apply and Move are unavailable** in a frozen month. The push route already returns `409 month_frozen` (`push-budget/route.ts`); the UI must not offer the control rather than letting the user discover the 409.

---

## 2. All-days delivery graph

Replaces the 7/14/30-day rolling window. One bar per finalized day, from flight start through the data edge.

- **Window:** flight start (clamped per the global conventions) through the data edge. No day-range selector. This is what makes the read consistent regardless of the day it is viewed on, and it removes the prior-month contamination the rolling 30-day view had.
- **Cap line:** dashed line at the campaign's **current** daily budget (`pacerDailyBudget`).
- **Bar colouring:** existing near-cap vs below-cap treatment, evaluated against that same current cap. This is also the delivery-to-cap signal the §8 retag falls back to.
- **Do not colour against the stored per-day `dailyBudget`.** `MetaAdsPacerDailySpend.dailyBudget` is the budget *as of sync time*, re-stamped only for the rolling 10-day window, so older rows carry a stale figure. Comparing each bar to its own stored stamp would silently mix two different caps in one chart. One cap, the current one, matching the dashed line.
- **Average label:** average daily spend across the shown days.
- Adding a finalized day nudges the average. That is correct data updating. The goal is one honest number per day, **not** a number frozen across days.

**Do not** include today's partial day as a bar in this series, and **do not** let it affect the average or any verdict.

**Data source:** the already-synced `MetaAdsPacerDailySpend` rows (90-day first backfill, 10-day rolling re-pull, 120-day retention). Opening an expander costs no Google call for the chart.

---

## 3. Today-so-far strip and live-total reference

Two read-only context figures. Neither feeds any calculation.

- **Today-so-far:** today's partial spend, pulled at sync time, in a visually distinct treatment (ghosted/hatched, clearly separated from the finalized bars). Labelled as in-progress — "Aug 12 so far: $30.90". Not compared to the cap line. Not projected or extrapolated.
- **Live-total reference:** finalized-through-yesterday spend **plus** today-so-far, as a quiet secondary line explicitly labelled approximate and as a platform cross-check — "live total ~$569.94 · cross-check against Google Ads". Use "~", never "=", because today-so-far keeps accruing after sync. Do not assert that it *matches* the platform; it is a figure to check against, and claiming the match is exactly the thing the reader is there to verify.

**Purpose:** someone cross-checking against the live Google Ads account sees numbers that tie out, while every calculation upstream stays on finalized days. This is the piece that makes the whole-days approach trustworthy next to the live platform.

**"As of" stamp:** every spend figure on the card and expander carries a visible data-edge stamp ("through Aug 11"), so Loomi's finalized number never reads as stale against the live platform number.

**Google's late revisions are already handled.** Google may revise the most recent 1–2 days (invalid-click/spend adjustments) for up to ~48 hours. The sync re-pulls a rolling 10-day window on every run and upserts, so revised days correct themselves. No extra work here.

---

## 4. Campaign metric tiles

Six metrics in the expander, same tile pattern the modal used.

| Metric | Source | Availability |
|---|---|---|
| Conversion Rate | `metrics.conversions_from_interactions_rate` | All types |
| Cost / Conv | derived: MTD spend ÷ `metrics.conversions` | All types |
| Avg CPC | derived: MTD spend ÷ `metrics.clicks` | All types |
| CTR | derived: `metrics.clicks` ÷ `metrics.impressions` | All types (already shown) |
| Search Lost IS (budget) | `metrics.search_budget_lost_impression_share` | **Search / Shopping only** |
| Search Lost IS (rank) | `metrics.search_rank_lost_impression_share` | **Search / Shopping only** |

Cost/Conv, Avg CPC and CTR are **recomputed from their inputs rather than trusted from the API**, continuing the existing convention: Google's own `cost_per_conversion` is blank at zero conversions, and a blank rendered beside a real spend figure reads as "free".

### Where the data comes from (this is the correction)

The draft's instinct was right — these belong on an existing account-wide call — but it named a call that doesn't exist. The right host is **`fetchCampaignSpend`**, the account-wide MTD query the sync already runs to populate `pacerActual`:

```sql
SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions,
       metrics.conversions, metrics.conversions_from_interactions_rate,
       metrics.search_budget_lost_impression_share,
       metrics.search_rank_lost_impression_share
FROM campaign
WHERE segments.date BETWEEN '<month start>' AND '<data edge>'
  AND campaign.status != 'REMOVED'
```

- Same call, same window, more columns. **No additional Google request**, and the metrics cover exactly the same MTD window as `pacerActual`, so a tile can never disagree with the spend figure above it.
- Results are **persisted per campaign** (§15). Opening ten expanders costs zero Google calls.
- **Impression share must be read unsegmented over the range.** Google returns range-level IS when the query is not segmented by date. Never sum or average daily IS values — IS is a ratio over eligible impressions, and summing days produces a number with no meaning.
- IS values are **fractions 0–1**, and Google reports anything above 90% as exactly `0.9`. Render `≥90%` rather than `90%` at that value.
- The fields return **null for campaign types that don't have them** (PMAX, Demand Gen) and when the account is below Google's reporting threshold. Null → "not available", never zero.
- `fetchCampaignWindowMetrics` and the `campaign-health` route's live metrics read are **deleted** with the modal.

### Refresh from Google

The tiles are as fresh as the last sync, so the expander carries a **Refresh from Google** button beside the as-of stamp. It runs the existing account sync (`sync-google`) — one job, all campaigns, spend and metrics together — then re-renders with the new stamp.

- Disabled with a spinner while a sync is in flight, and **shared across every open expander**: ten open rows cannot fire ten syncs.
- A short per-account cooldown after a successful run (60s), with the reason on the disabled state, so a rapid clicker can't burn the account's rate limit.

### Empty / unavailable states are required, not optional

- **Impression-share metrics** are Search/Shopping only. For PMAX and Demand Gen, show an explicit "not available for this campaign type" state, never a blank or a zero. (Display has separate `display_*` fields; only wire those if a Display IS read is wanted later. For now Display also shows "not available" for the Search IS fields.)
- **Conversion metrics on thin data:** Cost/Conv and Conv Rate show "—" when conversions are 0 or below a floor of 3, not a number computed off 1–2 conversions. This account is low-volume; a CPA off one conversion is noise presented as signal.
- Keep the existing "reference only, verify tracking in Google Ads" caveat on the conversion metrics.

**Conversion breakdown is explicitly out of scope.** The team reads full conversion detail in-platform.

### How the two impression-share metrics are used together (for the move decision)

- **Lost IS (budget) high** → the campaign wants more and will spend it. Good candidate to *receive* budget.
- **Lost IS (rank) high** → the constraint is bid or Quality Score, not budget. More budget will just sit. Do **not** feed.
- This pairing is what stops someone moving budget into a laggard that physically won't absorb it.
- **Limit to state in the tooltip:** rank-lost lumps bid and Quality Score together. It answers "will more budget help here, yes/no". It does **not** diagnose the fix, and must not read as a bid/QS diagnosis.

---

## 5. Projections (both shown)

Two figures in the expander, distinctly labelled. They will often disagree; the disagreement is signal, not a bug.

**1. Projected (recent pace)** — primary.

```
spent_MTD + (recent_daily_avg × days_remaining)
```

`recent_daily_avg` is pinned as follows, because "windowed, skip the launch ramp" is not implementable as prose:

- **Window:** the last **7 finalized days** inside the flight, flight-clamped so it can never reach into a prior month. Fewer than 7 finalized days available → use what exists.
- **Ramp handling:** drop **leading zero-spend days** from the flight start before averaging. That is the launch ramp in the only form the data can actually show — a campaign that was live on paper but delivered nothing for its first days. No cleverer heuristic; a rule nobody can predict is worse than a slightly blunt one.
- **Thin-history guard:** require **at least 3 finalized days with non-zero spend** in the window. Below that, render "—". A campaign with one noisy day has no recent pace, and projecting off it manufactures a number. Reserved campaigns and brand-new campaigns (e.g. AFCU) therefore show no run-rate projection.
- Denominator is the number of days actually averaged, not 7 — a campaign with 4 days of history must not read as half-pace because we asked for 7.

This is the honest "where it lands if it keeps behaving like it has". For a demand-limited campaign (e.g. Price Point) it correctly projects continued underspend.

**2. Projected (at current daily)** — ceiling.

```
spent_MTD + (current_daily_budget × days_remaining)
```

Answers "is the daily I've set even mechanically capable of hitting target". Reads as a ceiling, not a prediction. Label plainly as *at current daily*, never as "projected" alone. This is the existing `AllocatorLine.projectedSpend`, which is already null when no daily has synced — keep that null, because a projection off a zero rate reads as "will spend nothing" when the truth is "we don't know the rate".

**Reading the gap:** when recent-pace sits well below at-current-daily, the campaign has budget room it isn't using — the demand-limited flag, in projection form. When they nearly agree, the campaign is delivering to its daily.

**Google caveat in copy:** both are straight-line what-ifs. Google's daily is an average, not a cap (up to 2× on a given day, pacing to its own monthly limit), so neither predicts Google's actual day-to-day behaviour — especially on a budget-limited campaign grabbing the 2×. Label accordingly.

**Do not** reintroduce a 30.4-based baseline anywhere. Projections and expected-spend use actual flight/calendar days. (30.4 is Google's billing-entry convention only; as a pacing denominator it causes month-length drift, and it was removed in the base spec. It survives in `googleProratedCeiling`, which is a *billing ceiling*, not a pacing denominator — do not borrow it.)

---

## 6. Remaining budget

Single figure: `max(0, target − spent_MTD)`. Shown in the expander alongside pacing health.

- This is `AllocatorLine.remainingBudget`, which already exists and is already floored at zero.
- It is the same quantity as **movable budget** in the Move tool (§9). Show one number; it serves both meanings. Do not compute a separate "available" figure from target alone anywhere.
- The zero floor is deliberate: an overspent campaign has nothing left to spend and nothing left to give.

---

## 7. Delivery verdict line

The plain-language delivery read the modal carried ("delivering to cap" vs "room to spend"), now in the expander. `deliveryVerdict()` moves over as-is except for its window, which becomes the §2 all-days window rather than 7/14/30.

- The verdict is a **delivery** read — is it filling its cap — evaluated on finalized days only.
- It must **not** issue a directional budget prescription ("increase"/"decrease") on its own. Direction is the target-pacing surface's job (pace badge + recommended daily), which knows whether the campaign is ahead or behind on the month. This resolves the contradiction where the delivery popup said "room to spend, feed it" on a campaign the target math correctly wanted trimmed.
- Concretely: strip the action clause from the `VERDICTS` copy in the modal and keep the observation.

---

## 8. Hybrid CAPPED / HEADROOM retag

**Corrected premise.** The tag does not fire off "underspending vs target". It renders from `line.budgetLimited` ← `googleBudgetConstrained` ← `campaign.primary_status_reasons` containing `BUDGET_CONSTRAINED`. So it already uses a Google signal — the problem is that `BUDGET_CONSTRAINED` is looser than it reads, and it is being announced with copy that claims far more than it knows. Confirmed on Price Point: ~$37–47/day actual against a $64 cap, still flagged.

The fix is to qualify the signal, and to fix the copy that is doing the real damage.

- **Search / Shopping campaigns:** require `BUDGET_CONSTRAINED` **and** a high `search_budget_lost_impression_share`. High budget-lost IS = genuinely budget-limited = tag applies. Low budget-lost IS = not budget-limited, tag comes off regardless of `BUDGET_CONSTRAINED` and regardless of pace-vs-target. Threshold: **≥10% budget-lost IS**, tunable in `constants.ts`, not scattered.
- **PMAX / Demand Gen (no budget-lost IS available):** fall back to the delivery-to-cap heuristic — recent finalized bars actually sitting near the cap line (§2 colouring). Tag only when genuinely delivering to cap.
- **Tooltip must bridge the two axes** so it never reads as a contradiction. At cap **and** behind on the month: "hitting its full daily but still behind for the month because the cap is low — raise it to catch up." Never assert "spends its full daily every day" for a campaign whose bars are mostly below the cap line. That sentence is the current tooltip and it is the thing that made Price Point unreadable.

---

## 9. Move tool (reallocation)

Redistributes **target** between campaigns within one account. Modifies `planMove`/`sourceAvailable` in `google-allocator.ts`.

### Two entry points, one engine

- **Main-table Move button:** opens with nothing preselected; the user picks source and destination(s). For when someone already knows the move they want.
- **Compare-view Move button (§10):** opens pre-loaded with the campaigns being compared. For look-then-move without re-picking.
- Identical rules, conservation, caps and recompute regardless of entry point. The entry path only changes what is pre-filled.

### Conservation model

- Moving budget changes **target** only. Spent MTD never changes.
- Destination `target += amount`; source `target -= amount`. Equal and opposite, so the sum of all targets is unchanged and the allocation total / payable check stays satisfied automatically.
- **The one exception, already in the engine:** the **Unallocated** source. It consumes leftover between the allocated total and the denominator, so it deliberately *raises* the allocated total rather than conserving it. That is its purpose and it is retained. It has no spent figure, so the §"hard cap" below does not apply to it — its cap is the leftover.
- Moves are computed in **dollars** and written back in the card's active unit; in percent mode the percent is re-derived from the new dollar target against the payable. A move must never change the unit or the payable.
- After any move, **recompute both sides' recommended daily** off their new targets and show the new values in the preview.

### Hard cap (the correctness fix)

- **Movable out of a campaign = `max(0, target − spent_MTD)`, never its full target.** You cannot give away money already spent, and an overspent campaign gives nothing.
- Today `sourceAvailable()` returns the campaign's full `target`. That is the bug. It becomes the same expression as `AllocatorLine.remainingBudget`, so §6 and the Move dialog cannot drift apart.
- The input field hard-caps at the movable amount; a larger number cannot be entered.
- Display both figures so the cap isn't arbitrary: "$1,155.31 movable · $539.04 already spent". Never show target alone as "available".

### Soft warnings (flag, do not block)

- **Source drawn below its own pace:** if the move drops the source's remaining below what it needs to hit its own target over its remaining days, warn — "leaves Brand only $X for 20 days, below its pace". A judgment call, so warn, don't block.
- **Destination large daily jump (front-loading risk):** if the move implies a large jump in the destination's recommended daily, flag it. A budget-limited destination will grab up to 2× on high-opportunity days, so a big jump lands harder and faster than the even-pace number implies.
- **Outsized catch-up:** if the resulting recommended daily is far above anything the destination has ever delivered in a day this month, say so. This replaces the draft's min/max guardrails (below).

The **only** hard block is the movable cap.

### Guardrails: min/max daily is cut

The draft proposed optional per-campaign min and max daily bounds. Cut from v1, deliberately: clamping a recommended daily breaks the property that the account daily total equals remaining budget ÷ remaining days, which is precisely the number §14's footer reconciles against. A clamped card would need a third "clamped" state everywhere to stay honest, to solve a problem the outsized-catch-up warning already surfaces. The exhaustion catch and the change-threshold gate already exist in the base spec and are untouched.

### Move log

Every move writes to **`MetaAdsPacerAuditEntry`** — the table that already carries `accountKey`, `planId`, `period`, `platform`, `adId`, `adName`, `action`, `field`, `fromValue`, `toValue`, `summary`, `groupId`, `authorUserId`, `createdAt`, and already records `budget_push`.

- One `groupId` per move, one entry per side (source and each destination), `action: 'move'`, `field: 'allocation'`, from/to holding the dollar targets.
- Undo stays a session convenience. **The audit trail is the durable record** — it matters with several people touching budgets and with reconciliation downstream. Never rely on undo as the record.

### Exclusions

- **Locked** campaigns (§11): not selectable as source or destination.
- **Reserved** campaigns (§12): not selectable as source or destination.
- Existing even-split / custom-amount methods, preview and undo are retained from the base spec.

---

## 10. Compare feature

Pull selected campaigns into one side-by-side view for the "who gives, who gets" decision.

- **Selection:** a checkbox in the row's leading cell, 2–4 campaigns. A "Compare (n)" button appears in the card toolbar next to Move once two are selected. The selection model is **shared with Move**, so the compared set is what the Compare-view Move button pre-loads. Decision taken: **wire Compare to Move now.**
- **Surface:** a modal over the card, not a route and not a table mode. It is a look-then-act step, and the user must be able to dismiss it back to exactly the table state they left, including which expanders were open.
- **Layout: metrics-first grid.** Campaigns as **columns**, metrics as **rows** — Search Lost IS (budget), Search Lost IS (rank), Cost/Conv, Conv Rate, Avg CPC, CTR, pace, current daily, recommended daily, remaining budget. The eye runs across one metric at a time. That is the whole point: comparison becomes a glance, not a memory game across expanded rows.
- **Keep the daily graph out of Compare** (or shrink it drastically). Compare is about numbers lining up; the graph belongs in the expander.
- Locked and Reserved campaigns may be *compared* — reading them is fine — but the Move button opens with them excluded as source and destination, with the reason shown rather than silently dropping them.
- Compare solves the "campaigns far apart in the list" case that multi-open expanders alone don't. Multi-open handles the adjacent/everyday case; Compare handles the deliberate face-off and flows straight into Move.

---

## 11. Lock (retained, separate from Reserved)

Kept as-is, a distinct and lighter control than Reserved. Decision taken: **keep Lock for now**; revisit if it proves unused.

- **Meaning:** "this campaign can spend, its numbers are real and count in pacing, but don't let its budget be reallocated." A live, committed-spend campaign guarded against an accidental move.
- Locked campaigns **stay in** all pacing math — pace %, expected MTD, recommended daily, account daily total. Lock only blocks reallocation (excluded as Move source and destination) and is skipped by Balance.
- **Lock does not exempt a line from the push.** The rate it needs is still the rate it needs. This is stated in the base spec and is easy to "fix" by mistake — don't.
- Changes no numbers when applied.
- **Distinct from Reserved:** Lock = live but don't-touch. Reserved = can't-spend-yet, out of pacing. Different badges, different meaning. Do not merge.

---

## 12. Reserved status (out of pacing, in allocation)

New per-campaign status for budget set aside for a campaign that cannot spend yet — e.g. AFCU: budget committed, campaign not yet built or linked. This materially fixes the account read: with AFCU's $1,539.78 wrongly in pacing the account shows 74% of expected and $397.48/day needed; excluding it, the honest read is ~86% and ~$320.49/day.

- **Manual flag** (`pacerReserved`). The person sets it explicitly. Do **not** auto-apply. Auto-detection off a missing linked daily will eventually misfire on a merely-paused live campaign, and the tool must never silently drop a campaign from pacing. A "—" current daily / no linked budget is a *suggestion* cue at most.
- **In allocation:** the target still counts toward the account allocation total and the payable check, so the reserve is visible, protected, and cannot be mistaken for free budget.
- **Out of pacing:** excluded from Expected MTD, account pace %, recommended daily, and the account daily total. No daily is pushed for it.
- **Excluded from Balance.** Balance computes `room = denominator − Σ locked` and rewrites every unlocked line to fill it; a reserved line would be scaled or flattened like any other, silently destroying the reserve. Reserved joins Locked in the carve-out: `room = denominator − Σ locked − Σ reserved`, reserved targets untouched. This makes Reserved lock-like *for Balance only* — the target stays hand-editable and un-reserving is always available.
- **Excluded from Move** as source and destination.
- **Pacing alerts suppressed.** The underspend / overpace / went-dark / flight-ending scanners skip reserved lines. A reserved campaign sits at 0% spend by design, so leaving the scanners on would generate exactly the false alarm Reserved exists to remove. This is the same skip path as `alertsMuted`, keyed off `pacerReserved` — do not set `alertsMuted` as a side effect, since the two must be independently reversible.
- **Books no month-end variance.** A reserved line holds a target it was never going to spend, so at settlement it would otherwise post a full-target underspend into the reconciliation and carry it forward as though the account had missed. Reserved lines are excluded from the month's variance/carryforward computation; the reserve is a commitment, not a miss. (If the campaign launches mid-month it stops being reserved from that point and books normally — see below.)
- **Row treatment:** a distinct "Reserved" badge instead of "Underspending 0%". A 0% pace read on a campaign that isn't supposed to spend is a false alarm; suppress it.
- **No apply control** (§14), and absent from the apply-all preview list entirely rather than listed as a skip.
- **On launch (mid-month):** when flipped out of Reserved, the campaign targets its **full** reserved amount compressed into the remaining days — no proration. This is the existing mid-month flight logic pointed at the launch date: `recommendedDaily = full target ÷ remaining flight days`. The team does not prorate.

---

## 13. Google platform status badge

Surface each campaign's real Google status so a mismatch with Loomi's assumed state is caught at a glance.

**Most of this exists.** `platform-status.ts` already normalizes both platforms into one vocabulary (`Active / Paused / Limited / Disapproved / Removed / Not linked / Unknown`) with a tone helper, reading `googleEffectiveStatus` refined by `googleAdsDisapproved` and `googleBudgetConstrained`. `googlePrimaryStatus` is already synced. This section is largely a port of that onto the pacing card.

- **Source:** `normalizeAdStatus(ad)` for the badge. The **one real gap** is `campaign.primary_status_reasons` — it is read at sync but reduced to two booleans, so the richer "why it isn't serving" (budget removed, pending, ended, policy) is not available for display. Persist the reasons array (§15) to power the expander detail.
- **Placement:** small status dot/pill on the **collapsed** row next to the campaign name, so status is legible across all rows without expanding. The fuller primary-status reason shows in the expander.
- **Mismatch warning (the valuable part):** when Loomi's editable `adStatus` and Google's actual status disagree, surface it loudly. Concretely: `adStatus` of "Live" against a platform status of `Paused`, `Removed` or `Not linked` gets warning treatment. That is the expensive silent failure — recommending and pushing a daily for something that is not running.
- **Doubles as launch detection for Reserved:** a Reserved campaign reading `ENABLED` in Google is the signal it launched and should be taken out of Reserved. Flag it; do not auto-clear the flag (§12's manual rule).

---

## 14. Apply model (push recommended daily to Google)

This is the one surface, alongside Move, where Loomi writes to Google and touches live spend. Google-side push mechanics (batched mutate, shared-budget skip, drift gate) are per the base spec's API-push section; this section governs the **UI and control model** around it.

### Individual apply is the default; apply-all is demoted

- **Primary control:** a per-campaign apply, on the row or in the expander next to the recommended daily. Pushing one campaign is a single deliberate action. The route already exists (`push-budget`, single) and already writes an audit entry.
- **Secondary control:** keep "apply all", but demote it — behind the same menu as the Balance modes, or a secondary button. It stays available for the genuine "everything looks right, push the batch" moment, but it is never the default thumb-target. One-click push of every drifted campaign is the riskier design for this team's look-then-act workflow.

### Confirmation before commit (both paths)

- Individual apply: confirm the concrete change — campaign, current daily → new daily, dollar delta — before committing.
- Apply-all: show a short list of every campaign that would change and by how much. No blind batch push.
- State the change, confirm, then act. This is what keeps a batch push from being a surprise.

### Drift gate: suppresses batch, not individual

- The drift threshold (`PUSH_DRIFT_FRACTION` 5% / `PUSH_DRIFT_MIN_DOLLARS` $1) governs **inclusion in apply-all**: below-threshold campaigns stay out of the batch, to avoid trivial edits nobody asked for.
- A **deliberate individual apply is honored even below threshold.** The person chose that campaign on purpose; do not silently skip it. The gate is a batch-noise filter, not a block on explicit single actions.

### Control states

- **Shared-budget campaign:** apply is **disabled with a visible reason** ("shared budget — set it in Google"), never a silent no-op. **The API must enforce this too:** `push-budget/route.ts` currently guards unlinked and non-Daily rows but not shared budgets, so a shared budget can be written through the single-push path today. Writing one campaign's number onto a shared budget changes campaigns nobody touched. Add the guard server-side; the disabled button is the courtesy, not the control.
- **Total-budget (`CUSTOM_PERIOD`) campaign:** no apply control — there is no daily to set. Already guarded server-side.
- **Reserved campaign:** no apply control at all, and absent from apply-all (§12).
- **Frozen month:** no apply control. The route already 409s.
- **Just-applied marker:** on a successful push, stamp `googleBudgetPushedAt` and show "applied <relative time>" on the row for **48 hours**. This is the cue that the campaign is inside Google's re-pacing/settling window, so nobody re-pushes it tomorrow reacting to numbers that have not caught up. Visible only; it does not block a second push.

### Account footer: recommended total vs live total

The footer shows the **recommended** account daily total (`view.totals.accountDaily`). Add, beside it, the **currently-live** account daily total: what is actually set in Google right now, from the synced `pacerDailyBudget`. The single-push route already writes the pushed value back to `pacerDailyBudget`, so an applied campaign moves the live total immediately without waiting for the next sync.

**Both totals dedupe on `googleBudgetResourceName`.** Google holds one budget for several campaigns, so a per-campaign live sum double-counts every shared budget and "in sync" would be unreachable. The recommended total therefore counts each distinct budget resource once as well.

- This **changes the recommended total on accounts with shared budgets** — it will drop. That is the correct number: it is what the account actually spends per day, and it is what Google Ads Manager shows.
- When everything is applied and nothing has drifted, the two match: "in sync".
- When they diverge, surface the gap as the signal it is — "plan $397/day · live $420/day · 2 cuts un-applied". Partial apply becomes a visible, actionable state instead of a silent discrepancy.
- The **recommended** total is a property of targets and spend, so it does **not** change when you apply or don't apply. Applying is a push, not a reallocation; it never alters a target. Only the **live** total moves as you apply.

### Apply-decision guidance (which recommendations are worth pushing)

Applying every recommendation is neither required nor correct. "Fully on pace at the account level" would require applying all, but on-pace is not the goal — spending the budget well by month end is, and the recommended daily assumes every campaign *can* spend what you set it to, which is often false. Apply the changes that actually move spend; skip the ones that can't. Three cases:

1. **Behind and budget-limited** (bars pinned to cap, Search Lost IS budget high — e.g. Used Cars): the raise works. **Apply.**
2. **Behind but demand-limited** (bars below cap, Search Lost IS budget near zero — e.g. Price Point): Loomi still computes a raise, because the math only sees target − spent ÷ days, but raising the daily does nothing when the campaign isn't filling the budget it already has. **Do not apply** the raise; this is a reallocation problem, not a daily-budget one. Move its unspendable budget to a campaign that can use it.
3. **Ahead / overpacing** (the recommendation is a cut — e.g. Brand $75 → $38.55): the cut takes effect and frees budget the budget-limited campaigns need. **Apply the cut.**

**Futile-raise hint (non-blocking):** when a campaign's recommendation is a raise but its Search Lost IS (budget) is near zero — or, for PMAX/Demand Gen where that metric is unavailable, its recent bars sit well below cap — the apply surface notes that the raise is unlikely to increase spend and flags the campaign as a **reallocation candidate** rather than an apply. This is a mechanical spendability hint (the campaign is not filling its cap), not a performance verdict, so it is consistent with invariant 9. It does not block applying; the human can still push it. Its job is to stop "Price Point is behind, recommended $63, apply it" from pushing a change that does nothing.

This is also why individual apply as default and the recommended-vs-live gap are features, not friction. A healthy end state often has *not* applied every campaign: you applied the working raises and the cuts, left the demand-limited underspenders alone, and moved their stranded budget. The live total sitting a little off the recommended total is the honest picture of an account where some campaigns cannot absorb what even-pace math wants to give them — and the gap points at what to solve with a move.

---

## 15. Schema and code touchpoints

**New columns on `MetaAdsPacerAd`** (all nullable / defaulted, Google-only):

| Field | Type | Purpose |
|---|---|---|
| `pacerReserved` | `Boolean @default(false)` | §12 Reserved flag |
| `googlePrimaryStatusReasons` | `String?` | JSON array — §13 expander detail; today only two booleans survive the sync |
| `googleBudgetPushedAt` | `DateTime?` | §14 just-applied / settling marker |
| `googleImpressions` | `Int?` | §4 tiles — CTR input |
| `googleClicks` | `Int?` | §4 tiles — CTR and Avg CPC input |
| `googleConversions` | `String?` | §4 tiles — Cost/Conv input (decimal string, matching the money convention) |
| `googleConvRate` | `String?` | §4 tiles — from the API; interactions aren't stored so it can't be derived |
| `googleSearchBudgetLostIs` | `String?` | §4 + §8 — fraction 0–1, null when unavailable |
| `googleSearchRankLostIs` | `String?` | §4 — fraction 0–1, null when unavailable |
| `googleMetricsAsOf` | `String?` | YYYY-MM-DD the metric window ends — the tiles' own as-of stamp |

All metric columns are **server-managed by the sync**, like `pacerActual`: the client PUT spreads them back and the route ignores them, so autosave cannot clobber a sync.

**Files:**

- `src/lib/ad-pacer/google-allocator.ts` — `sourceAvailable` cap fix, reserved exclusion in `balance`/`planMove`/totals, retag gate, recent-pace projection, dedupe of both daily totals.
- `src/lib/ad-pacer/constants.ts` — the budget-lost-IS threshold, the conversion floor, the settling window, the refresh cooldown.
- `src/lib/integrations/google-ads-pacer.ts` — metric columns on `fetchCampaignSpend`; delete `fetchCampaignWindowMetrics`.
- `src/app/app/tools/google/_components/GooglePacingCard.tsx` — expander, Compare, Move dialog, apply controls, footer.
- `GoogleDeliveryHealthModal.tsx` — deleted; `FlightEditor` and the verdict copy move into the expander.
- `src/app/api/google-ads-pacer/[accountKey]/campaign-health` — deleted (the series comes from the plan's own data; the metrics come from the sync).
- `src/app/api/google-ads-pacer/[accountKey]/push-budget` — shared-budget guard.
- Alert scanners — `pacerReserved` skip.
- Reconciliation / carryover — exclude reserved lines from month-end variance.

---

## Do not change (invariants)

1. No pool. Single-unit per-account allocation, per base spec.
2. Data edge = yesterday. Today's partial never enters any verdict, projection, recommended daily, or account total.
3. Whole days only; no fractional/live-clock day counts.
4. No 30.4 pacing denominator anywhere. Actual flight/calendar days only.
5. Spend is never moved or edited. Reallocation moves target only.
6. Movable = `max(0, target − spent MTD)`. Never move against full target.
7. Locked lines stay in pacing and stay in the push; only reallocation and Balance are blocked.
8. Reserved lines stay in allocation but are removed from all pacing math, from Balance, from alerts, and from month-end variance.
9. No automated performance verdict (good/bad) and no auto-allocation by ROAS/CPA. Surface reference metrics; the human decides the move.
10. Impression-share and conversion metrics show explicit unavailable/"—" states, never a misleading zero or a CPA off 1–2 conversions.
11. Applying never alters a target. The recommended account total is computed from targets and spend and does not change on apply; only the live total moves.
12. Individual apply is the default; apply-all is a demoted secondary. No push commits without a confirmation showing the concrete change. Applying is never automatic.
13. Both account daily totals count each distinct Google budget resource exactly once.

---

## Acceptance criteria

1. The delivery modal is gone; its content is in a row expander opened from the pace chevron, and multiple rows can be expanded simultaneously.
2. The delivery graph shows one bar per finalized day from flight start to the data edge, with no day-range selector and no prior-month days; bars and the cap line are both measured against the campaign's current daily.
3. Today's partial spend appears only in the today-so-far strip, is visually distinct, and affects no average, verdict, projection, or total.
4. A live-total reference figure (finalized + today, labelled approximate) is shown; every spend figure carries an "as of / through <date>" stamp.
5. Opening N expanders fires **zero** Google requests; the metric tiles render from synced columns, and "Refresh from Google" runs one account sync shared across every open expander, disabled during the run and for a cooldown after it.
6. Six metric tiles render; impression-share tiles show "not available" for PMAX and Demand Gen and for any null the API returns; Cost/Conv and Conv Rate show "—" below the conversion floor; a ≥90% impression-share value renders as "≥90%".
7. Two projections render, distinctly labelled recent-pace (primary) and at-current-daily (ceiling); recent-pace shows "—" with fewer than three non-zero finalized days, so a reserved or brand-new campaign shows no run-rate projection.
8. Remaining budget equals `max(0, target − spent MTD)` and equals the Move tool's movable figure for the same campaign.
9. The delivery verdict issues no directional budget prescription on its own.
10. The CAPPED/HEADROOM tag requires both `BUDGET_CONSTRAINED` and a high Search Lost IS (budget) for Search/Shopping, and delivery-to-cap bars for PMAX/Demand Gen; it never labels a below-cap campaign as spending its full daily.
11. Move changes only targets, equal and opposite; the account allocation total is unchanged after any campaign-to-campaign move; both sides' recommended daily recompute in the preview; an Unallocated source is the sole documented exception and is labelled as such.
12. Move input hard-caps at `max(0, target − spent MTD)` and displays both movable and already-spent; locked and reserved campaigns are not selectable as source or destination.
13. Move soft-warns (without blocking) on drawing a source below its own pace, on a large destination daily jump, and on an outsized catch-up daily; no min/max clamp exists anywhere.
14. Every move writes paired audit entries sharing one `groupId`, with the source and destination targets before and after.
15. Move is reachable from the main table and from Compare; the Compare selection pre-loads the Compare-view Move.
16. Compare renders 2–4 selected campaigns as columns with metrics as rows, opens over the table, and restores the table state (including open expanders) on dismiss.
17. Lock blocks reallocation and Balance only; it leaves the campaign in all pacing math, in the push, and its numbers unchanged.
18. Reserved is manual; it keeps the target in allocation, removes the campaign from Expected MTD / account pace / recommended daily / account daily total / Balance / Move / pacing alerts / month-end variance, shows a Reserved badge rather than 0% underspending, and on un-reserving paces the full target over the remaining days. **Property test:** reserving a line changes account expected-MTD and the account daily total by exactly that line's contribution and nothing else. *(Worked example: with AFCU's $1,539.78 reserved, the Young account reads ~86% of expected and ~$320.49/day instead of 74% and $397.48/day.)*
19. Each row shows Google platform status; an `adStatus` of Live against a Paused / Removed / Not-linked platform status is surfaced as a warning; a Reserved campaign reading ENABLED in Google is flagged as launched but is not auto-unreserved.
20. Per-campaign apply is the primary control and apply-all is demoted; both confirm the concrete change(s) before committing.
21. An individual apply commits even when the campaign's drift is below the batch threshold; the drift gate only excludes campaigns from apply-all.
22. Apply is disabled with a visible reason on shared-budget and total-budget campaigns, absent on Reserved campaigns and in frozen months, and the **API refuses a shared-budget push** independently of the UI; a successful apply sets a 48-hour just-applied marker.
23. The account footer shows a recommended daily total (unchanged by apply) and a currently-live daily total; both dedupe on budget resource; they read "in sync" when fully applied and surface the gap otherwise.
24. A behind campaign whose recommendation is a raise but whose Search Lost IS (budget) is near zero — or whose recent bars sit below cap, where IS is unavailable — is flagged as a reallocation candidate with a non-blocking futile-raise hint; the raise can still be applied.
25. In a closed month the expander shows no today strip, no live-total line and no projections; the data edge is the month end; Move and apply are unavailable.

---

## Build order

1. **Metric columns on the sync** (§4) — additive, ships alone, and everything downstream (tiles, retag, futile-raise hint, Compare) depends on it.
2. **Delivery row expander shell** (§1) — multi-open off the pace chevron; retire the modal, move its content across.
3. **All-days graph + today strip + live-total + as-of stamps + Refresh** (§2–3).
4. **Metric tiles with availability/empty states**, then **both projections + remaining budget** (§4–6).
5. **Hybrid retag + verdict de-prescription** (§7–8).
6. **Platform status badge + mismatch warning** (§13).
7. **Reserved status** (§12) — unblocks the honest account read; touches Balance, alerts and reconciliation, so it lands as one change, not three.
8. **Move tool: movable cap, conservation, warnings, audit log** (§9), retaining base-spec even/custom/preview/undo.
9. **Compare + shared selection, wired to Move** (§10 + §9 entry points).
10. **Apply model** (§14) — per-campaign apply with confirmation, demoted apply-all, control states and the settling marker, the deduped recommended-vs-live footer, the futile-raise hint. This is the write-to-Google surface and lands after the signals that inform it.

Lock (§11) already exists; only verify it stays in pacing and in the push, and is excluded from Move, Balance, and now Compare-driven Move.
