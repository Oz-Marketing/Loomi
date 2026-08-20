---
title: Markup and rate cards
summary: Where margin is set, and why it is set in exactly one place.
sector: agency
category: Configure
audience: staff
order: 60
covers:
  - src/app/api/default-markup/**
  - src/app/api/billing-markups/**
  - src/components/settings/rate-cards-tab.tsx
---

# One place, on purpose

Markup resolves in exactly one order:

1. **The account's own markup**, if it has one
2. **The agency default**, if it doesn't

There is no third place, and no per-campaign override. Margin computed in
several places is margin that disagrees with itself, and reconciling that after
the fact is expensive in a way that nothing else in this system is.

# Setting it

- **Agency default** — Agency Settings → Markup. Applies to every account
  without its own.
- **Account override** — on the account. Use it when the agreement genuinely
  differs.

An override is a commitment to remember it exists. Prefer the default where the
agreement allows.

# Rate cards

Rate cards hold standard pricing for the services the agency sells. They feed
agreements and budgets, so a rate changed here changes what new work is priced
at — not what existing agreements already say.

# Who can see and change this

Both are gated, separately:

- **Seeing cost and spend** is a granted capability
- **Changing markup** is a second, narrower one

Someone can legitimately manage budgets all day and never see margin. That is
the design, not a gap.
