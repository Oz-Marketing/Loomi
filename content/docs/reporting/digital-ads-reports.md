---
title: Digital ads reporting
summary: Reading paid media performance, and what the spend figure does and doesn't include.
sector: reporting
category: Channels
audience: everyone
order: 20
covers:
  - src/app/reporting/ads/**
  - src/lib/reporting/ads/**
  - src/app/api/reporting/**
---

The Digital Ads reports show what paid media did over the period: spend,
impressions, clicks, click-through rate, and where the platform supports it,
conversions.

# Spend is served, not billed

The spend figure is what the platform reports as delivered over the period.

That is the right number for "how is this campaign performing", and it is not
the same as the invoice. Billing runs on its own cycle, with its own
adjustments, and it settles at the account level rather than per campaign. A
small difference between this report and an invoice is expected.

For the money view — planned against actual, with variance carried across months
— read [The budget report](/docs/budget-report).

# Reading it

Start with the trend, not the total. A single month's cost per click means very
little; the same figure across four months means quite a lot.

| If you see | Consider |
| --- | --- |
| Spend flat, results falling | Creative fatigue — the audience has seen it |
| Impressions falling, spend flat | The auction got more expensive |
| Spend well under plan | Delivery is constrained, not saving money |
| A sharp single-day spike | Check it is real before explaining it |

# Under-delivery is not a saving

An ad that spends less than planned did not save money — it bought less
attention than was budgeted for. The pacing tools exist to catch that during
the month, when something can still be done about it.

# Why this differs from the ad platform's own dashboard

Two legitimate reasons:

- **Attribution windows.** Platforms count a conversion within their own window;
  Loomi counts what it can verify.
- **Timezones.** A platform reporting in its own timezone will disagree with a
  calendar month at the edges.

Neither is an error. If the gap is large rather than marginal, that is worth
raising.
