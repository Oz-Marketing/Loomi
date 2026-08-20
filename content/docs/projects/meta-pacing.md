---
title: Meta ad pacing
summary: Planning Meta budgets, watching delivery against plan, and settling the month.
sector: projects
category: Pacing
audience: staff
order: 50
covers:
  - src/app/app/tools/meta/**
  - src/app/app/tools/_shared/**
  - src/lib/ad-pacer/pacer-calc.ts
  - src/lib/ad-pacer/pacing-engine.ts
  - src/lib/ad-pacer/period.ts
  - src/app/api/meta-ads-pacer/**
---

Three views over the same ads, answering three different questions.

| View | Question |
| --- | --- |
| **Planner** | What are we going to run, for how much, and who owns it? |
| **Pacer** | Is it delivering what we planned? |
| **Reconciliation** | Did the month land, and what carries forward? |

# Planner

One row per ad, for one account, for one month. Each row carries its intended
allocation, its flight dates, and the people attached to it — owner, designer,
rep.

Attaching people is not administrative tidiness. Alerts route to the people on
the ad, so an ad with nobody on it alerts nobody.

**Add Plan** builds a month three ways: from scratch, copied from the previous
month, or imported from the platform. Copy-from-previous is the usual one — most
months are last month with adjustments, and starting from a blank grid invites
omissions.

# Pacer

Live spend against plan. Per ad it shows what has been spent, what is projected,
and a recommended daily budget; per account it shows the overall pace.

## Two statuses, and they never touch

This is the single most confusing thing about the tool until it clicks.

| | **Task Status** | **Ad Status** |
| --- | --- | --- |
| Who sets it | Your team | The platform |
| Editable | Yes | No |
| Means | Where the work is | Whether the ad is actually delivering |

**Task Status** is the planning lifecycle — In Draft, Pending Design, Ready,
Live, Stuck, Completed Run, Off, and the rest. The pacer's automations key off
it: the run-complete banner, the auto-complete sweep, which ads count as active.

**Ad Status** is read-only truth from Meta, normalized to one vocabulary shared
with Google: Active, Paused, Limited, Disapproved, Removed, Not linked, Unknown.

**Ad Status never drives Task Status.** An ad the platform has paused does not
become Off in your plan, because "Meta paused it" and "we decided to stop it"
are different facts and you need both.

`Not linked` is worth watching for. It means the row has no platform object
attached, so there is no spend to read — the plan is fiction until it is
linked.

## The recommendation box

The pacer will tell you what daily budget to set, but only when setting it would
actually work. When the ad is on track it says to leave it alone. When a number
would mislead — delivery is broken, or there are too few days left to catch up —
it escalates to the honest alternative instead of handing over a figure that
cannot land.

Two questions in order, and the first gates the second: *is this campaign
spending the budget it already has?* and only then *will it land on target?* A
recommendation to raise a budget on a campaign that is not spending its current
one is worse than useless.

Meta's daily budget is an average over a rolling seven days, and a single day
may overdeliver. That is why health is measured on the window rather than on
today — one hot day is not a problem.

# Reconciliation

At month end, planned against actual, settled against the **client** budget
rather than the raw spend.

Over- or under-delivery does not disappear at month end. It becomes
**carryover**: a ledger entry per bucket, recording the month it came from, the
month it was applied into, and the amount. A month that looks over budget is
often spending last month's carryover, correctly.

Carryover is applied deliberately, not automatically — it is opt-in per month,
because "last month underspent" and "we intend to make it up in June" are
different decisions.

A run that spans a month boundary settles **once, on its final month**, rather
than being cut in half. Two partial settlements that each look wrong is a worse
record than one that is right.

## Frozen months

Once a month has fully settled, the pacer captures the exact plan — per-ad
spend, flight dates, target, budget goals, markup, timezone — and freezes it.

A closed month stays a faithful record of what was true then, even if an ad is
edited or deleted later.

# The audit trail

Every edit writes a row: which ad, which field, from what to what, by whom.
Changes made in one save are tied together, so a bulk apply reads as one action
rather than forty.

Meta and Google keep separate trails. They share the engine, not the log.
