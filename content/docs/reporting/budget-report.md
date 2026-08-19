---
title: The budget report
summary: Planned against actual, what a variance means, and how it carries into next month.
sector: reporting
category: Money
audience: everyone
order: 60
covers:
  - src/app/reporting/budget/**
  - src/lib/budget/**
  - docs/reconciliation-crossmonth.md
  - docs/budget-module.md
---

The budget report answers a different question from the ads report. Ads
reporting asks how the media performed; this asks whether the money went where
it was agreed to go.

# The two numbers

- **Planned** — what was agreed for this period
- **Actual** — what was spent

The gap between them is the **variance**, and its sign matters:

| Variance | Means |
| --- | --- |
| **Under** | Less was spent than agreed. Money is owed forward, not saved. |
| **Over** | More was spent than agreed. Needs to be accounted for. |

# Variance carries forward as carryover

An under-spend in one month does not vanish at month end. It carries into the
next period as **carryover**, so the year reconciles even when individual months
don't.

This is why a month can look over budget and be entirely correct: it is spending
last month's carryover.

:::note
A campaign that runs across a month boundary settles once, on its final month,
rather than being split. That keeps a single run from appearing as two partial
ones that each look wrong.
:::

# What is in the figure

The report shows the client-facing budget — the number in the agreement.
Internal cost and margin are separate, and visible only to people granted that
specifically. If you can see one but not the other, that is by design rather
than a gap.

# The commonest question

**"Why doesn't this match the platform?"** Three reasons, all legitimate:

1. The platform reports delivered spend; this reports against the agreement.
2. Timezone boundaries differ at the edges of a month.
3. Carried-forward balance from previous periods is included here and not there.

If the difference is more than marginal, that is worth raising rather than
explaining away.
