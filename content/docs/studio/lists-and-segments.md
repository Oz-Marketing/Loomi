---
title: Lists and segments
summary: The difference between a list you put people on and a segment that finds them for you.
sector: studio
category: Audiences
audience: everyone
order: 20
covers:
  - src/app/contacts/lists/**
  - src/app/contacts/segments/**
  - src/app/api/segments/**
  - src/lib/segments/**
  - docs/segment-builder-audit.md
---

Both answer "who does this send to". They answer it differently, and picking the
wrong one is the most common cause of a campaign going to the wrong people.

| | **List** | **Segment** |
| --- | --- | --- |
| Membership | You put people on it | A rule decides |
| Changes over time | Only when you change it | Every time it's used |
| Good for | A fixed set — event invitees, a specific import | Anything defined by a condition |

If you can describe the audience in words — "customers who bought over two years
ago and haven't been in for service" — it should be a segment. If you can only
describe it by pointing at the people, it's a list.

# Building a segment

A segment is a set of conditions. Each condition tests one field: a tag, a date,
a number, a text value, a yes/no, a choice.

Conditions combine with **and** / **or**, and they nest. That nesting is what
lets you express the thing you actually meant:

```
Bought a vehicle more than 24 months ago
AND (
  no service visit in 12 months
  OR service visits = 0
)
```

Without the brackets, that reads as three separate requirements and matches
almost nobody. The builder shows the grouping visually — check it before you
save, because a segment that matches four people usually has a grouping problem
rather than a data problem.

# Check the count before you send

The builder shows how many contacts currently match. Two things are worth doing
every time:

1. **Look at the number.** If it is far from what you expected in either
   direction, the rule is wrong.
2. **Look at a few of the people.** A count can be right for the wrong reason.

# Segments are live

A segment re-evaluates whenever it is used. Send to it today and again next
month, and the second send goes to whoever matches next month — including people
who did not exist when you built it.

That is usually what you want, and occasionally exactly what you don't. For a
send that must reach precisely the people you saw, use a list.
