---
title: Google ad pacing
summary: The same three views for Google, and the four ways Google genuinely differs.
sector: projects
category: Pacing
audience: staff
order: 60
covers:
  - src/app/app/tools/google/**
  - src/lib/ad-pacer/google-pacer-calc.ts
  - src/lib/ad-pacer/google-allocator.ts
  - src/lib/ad-pacer/google-metrics.ts
  - src/lib/integrations/google-ads-pacer.ts
  - docs/google-pacing-card.md
---

Google shares the engine with Meta — the same planner, pacer, and
reconciliation, the same pools, carryover ledger, and markup, the same two
statuses. [Meta ad pacing](/docs/meta-pacing) covers all of that and applies
here.

What follows is only what is different, and each difference changes how you read
a number.

# 1. The daily budget is an average, not a cap

This is the big one.

A Google daily budget does not cap the day. Google spends more on high-traffic
days and less on quiet ones, and bills against a **monthly ceiling**:

```
monthly ceiling = daily rate × 30.4
```

So the number that constrains the campaign is the ceiling, not the daily figure.
The card shows the ceiling and a recommended daily **rate** — the monthly
allocation divided by 30.4 — where Meta's card frames it as remaining budget.

Three consequences:

- **The on-track band is wide.** It has to absorb a single day at up to twice
  the daily rate, which is normal delivery rather than an overspend.
- **Alerts fire on the monthly projection**, never on one hot day.
- **The projection is capped at the ceiling**, because Google will not bill past
  it. A projection above the ceiling would be arithmetic, not a forecast.

A mid-month budget change is reprorated against the change history, so the
ceiling reflects what was actually in effect rather than whatever the budget
happens to be today.

# 2. Two delivery problems with opposite remedies

Google reports why a campaign is or is not serving, and the pacer surfaces two
signals separately because confusing them is expensive:

| Signal | Means | Do |
| --- | --- | --- |
| **Budget-limited** | Spending its full cap with demand left over | Raise the budget |
| **Ads disapproved** | An ad cannot serve on policy | Fix the ads |

:::warning
Never raise a budget on a disapproved campaign. The ads cannot serve, so the
extra money does nothing except make next month's plan wrong — and it hides the
policy problem behind a spend number that still looks like it is trying.
:::

# 3. Budget type and sharing

Two badges on a line, both read from the platform:

- **Daily / Total.** Total is a fixed-period flight, and it settles like a
  lifetime budget — at the end of the run rather than continuously.
- **Shared.** The budget is attached to more than one campaign, so the pacing
  unit is the budget, not the campaign. Pacing a shared budget one campaign at a
  time gives an answer that is confidently wrong.

Daily campaigns bill continuously, so nothing defers to month end. Only a
fixed-period total flight uses the month-end exclusion.

# 4. Spend is served cost

The spend figure is **served** cost — what Google reports as delivered. It is
labeled as such on the card.

Billed truth is account-level only and arrives through invoicing on its own
cycle. A small gap between the two is expected and is not a reconciliation
error.

# Channel groups

Campaigns roll up by type: Search, Display, Video, Shopping, Performance Max,
Demand Gen, Other.

Performance Max and Demand Gen are each their **own** group and are never split
into Search and Video. They spend across surfaces the API will not cleanly
attribute, and inventing a split would be a guess presented as data.

# Keeping the two platforms apart

Notes, copy-from-previous, periods, and the admin overview are all scoped by
platform. Google and Meta never cross-contaminate lines, notes, or counts, even
for the same account and month.

The Google integration is pinned to a specific Google Ads API version. A version
bump is a deliberate change, not something that happens underneath you.
