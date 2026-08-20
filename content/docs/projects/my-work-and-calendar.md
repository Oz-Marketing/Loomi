---
title: My Work and the calendar
summary: Finding what is on you today, and seeing what the week actually holds.
sector: projects
category: Delivery
audience: staff
order: 30
covers:
  - src/app/app/projects/my-work/**
  - src/app/app/projects/calendar/**
  - src/app/app/projects/_components/my-work-view.tsx
  - src/app/app/projects/_components/calendar-view.tsx
  - src/app/app/projects/_components/filter-bar.tsx
---

# My Work

Everything assigned to you, across every account and every initiative, in one
list. It ignores the account picker on purpose — your work does not stop at a
rooftop boundary.

It shows **open work only**. Done and canceled tasks drop out, because a list
you have to scroll past your own finished work to read is a list you stop
opening.

## How it is ordered

Urgency first, then status:

1. **Overdue**
2. **Due soon**
3. Everything else, grouped by status

A task appears exactly once. Something overdue sits under Overdue and does not
also appear under In progress, so the count at the top is the real number of
things on you.

If Overdue is never empty, the due dates are wrong rather than the work. A date
nobody believes is worse than no date, because it costs the section its meaning.

# Calendar

The same tasks laid out by date. This is the view that answers whether a week
is over-committed **before** it starts rather than on Thursday.

Unlike My Work, the calendar follows the account picker — in a group, it spans
the rooftops underneath; for admins in the all-accounts view, it spans
everything.

## Filters

Account, team, assignee, and priority. They are the same filters as the board,
and they carry across views, so narrowing to your team on the board and
switching to the calendar keeps the narrowing.

The most useful combination is one team plus one month: it shows whether a
team's load is spread or stacked, which is the thing worth knowing while you can
still move something.

:::tip
Filter to a single assignee before promising a date on their behalf. A calendar
is a much more honest answer to "can you fit this in" than a person's memory of
their own week.
:::
