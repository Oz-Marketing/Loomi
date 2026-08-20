---
title: Project budgets
summary: The ledger where every media dollar lives — agreements, allocation, and how it reaches the pacer.
sector: projects
category: Money
audience: staff
order: 40
covers:
  - src/app/app/projects/budget/**
  - src/lib/budget/**
  - src/lib/services/budget.ts
  - docs/budget-module.md
---

The Budget hub is a client's media budget for a year, and the place it gets
distributed from. It is the answer to "what did we agree to, and where has it
gone".

# The four pieces

| | What it holds |
| --- | --- |
| **Agreement** | What the client signed: a term with real dates, a total commitment, and optionally its own markup |
| **Fee** | A recurring monthly charge inside a term, on a named channel |
| **Budget line** | The ledger. Every media dollar is one row. |
| **Line event** | The audit — who moved what, when, and why |

A year's target is **derived from the agreement's term**, not typed in per year.
An agreement that runs March to February produces the right target for both
calendar years without anyone reconciling them by hand.

# Budget lines

Every dollar is a line, and a line has two allocation axes:

- **Period** — which month it belongs to
- **Channel** — Meta, Google Search, YouTube, OTT, Email/SMS, radio, TV,
  billboard, print, video, PR

A line with neither is **in the pool**: money that is committed but not yet
placed. That is a real and useful state — it is what "we have $40k for Q3 and
haven't decided the split" looks like.

Lines carry a **status**: planned, committed, live, settled, or canceled. Only
committed, live, and settled count against the pool. A planned line is thinking
out loud.

## Billed to, spent from

Two account keys per line, and they are usually the same. Where they differ, one
account is billed and another spends — which is how a group can fund a rooftop's
campaign without the reporting lying about either.

## Markup is frozen on the line

The markup that turns client dollars into spend dollars is resolved once, when
the line is created, and stored on it.

This is deliberate and it matters: changing an account's markup must not rewrite
last quarter's targets. History stops moving the moment it is recorded.

# How budget reaches the pacer

One direction only. **Budget owns intent; the pacer owns execution.**

Committed and live lines on a pacer-backed channel are summed by account, month
and platform, and written into that month's pacer target. The pacer never writes
back. Actuals flow the other way for display only.

The moment that becomes two-way there are two sources of truth and no way to
tell which is right.

Channels without a pacer — radio, print, billboards — settle manually. They are
tracked here; they just have no live spend to compare against.

:::warning
**Budget-driven pacing is opt-in and off by default.** Each account has to be
switched over per platform, and until it is, the pacer's target is still the
hand-typed number.

So a fully built budget for an account that has not been switched on changes
nothing downstream. If a pacer target disagrees with the budget, check this
before treating it as a bug — the likely answer is that the account is not
managed by budget yet.
:::

# Bulk entry

A submission that fans out — twelve stores by six months — is stamped with one
batch identifier, so it can be edited and released as a unit rather than
seventy-two rows at a time.

# The event log

Every change to a line writes a typed event: created, moved, released,
canceled, with the author and the amounts. It replaces notes appended to a text
field, and it is queryable, so "where did this month's extra $6,000 come from"
is a question with an answer.

# Related

- [The budget report](/docs/budget-report) — the client-facing view of the same
  money
- [Markup and rate cards](/docs/markup-and-rate-cards) — where the markup that
  gets frozen onto a line is set
