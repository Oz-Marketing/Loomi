---
title: The Studio dashboard
summary: What the home screen is showing you, and what it deliberately isn't.
sector: studio
category: Getting around
audience: everyone
order: 5
covers:
  - src/app/dashboard/**
  - src/components/studio-home.tsx
  - src/app/api/dashboard/**
---

The dashboard is the first screen in Studio. It is an orientation surface — what
is happening in this account right now — rather than an analytics surface.

# What is on it

- Recent and scheduled campaigns
- Audience size and how it is moving
- Recent activity across the account
- Quick routes into the things you start most often

# What is not on it

Performance analysis. Open rates over time, cost per lead, channel comparison —
those live in [Reporting](/docs/reporting-overview), which is built for reading
numbers and can be shared with a client.

The split is deliberate. A screen that tries to be both a launcher and an
analytics tool does neither well.

# It follows the account picker

Everything here is scoped to the account selected at the top of the sidebar. In
a group with roll-up on, the totals include the accounts underneath — see
[Accounts, groups, and scope](/docs/accounts-and-scope).
