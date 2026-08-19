---
title: Reporting overview
summary: What the reporting surface is for, how to read it, and how the date range works.
sector: reporting
category: Getting around
audience: everyone
order: 10
covers:
  - src/app/reporting/**
  - src/app/reporting/_components/**
---

Reporting is the client-facing side of Loomi. It answers what happened, what it
cost, and whether it worked — for one account, over a period you choose.

Everything here is read-only. Nothing on this surface changes a campaign, a
budget, or a contact.

# Finding your way around

The sidebar groups reports by what they are about:

| Group | Reports |
| --- | --- |
| **Top level** | Dashboard, Contacts, Marketing Lists |
| **Digital Ads** | Per-platform ad performance |
| **Websites** | Site and landing page activity |
| **Local Presence** | Business Profile, Reputation, Call Tracking |
| **Out of home** | Billboards, Direct Mail |
| **Sales & Service** | Acquisition Cost, Lead Performance, Sales Trend, Service Trend, Service Retention, Customer Heatmap |
| **Budget** | Planned against actual |

You will not see every report. Which ones appear depends on what the account
has running and what has been enabled for it — see
[Who sees which report](/docs/report-access).

# The date range

Every report reads a date range from the top of the page, and it persists as you
move between reports. Two habits:

- **Check it before you read a number.** A figure that looks wrong is usually a
  date range from the last thing you were looking at.
- **Compare like with like.** Month against month, not this month-to-date
  against all of last month. A comparison against a partial period is the most
  common way to read a decline that isn't there.

# Groups

For a group account, the roll-up toggle in the header adds the accounts
underneath into the totals. Off, you are reading the group's own figures.

# When a report looks empty

Usually one of three things, in this order:

1. **The date range** covers a period with no activity.
2. **The account** in the picker is not the one you meant.
3. **The data source isn't connected** for this account — a Business Profile
   report needs a connected profile, an ads report needs a linked ad account.

An empty report is not the same as a zero. If a report says nothing is
connected, that is a setup answer, not a performance answer.
