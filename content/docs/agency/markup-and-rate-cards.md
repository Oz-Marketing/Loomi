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
  - src/app/api/rate-cards/**
  - src/lib/services/rate-cards.ts
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
at — not what existing agreements already say. A budget line freezes the rate
onto itself when it's created, so editing a card never rewrites committed money.

Add, rename, reorder and archive them in Agency Settings → Markup. Two rules
the screen enforces, both for the same reason — a category is referenced by key
from budget lines and channels:

- **A card's key never changes.** Renaming changes only the display name. The
  key is chosen once, from the name you first give it.
- **Cards archive, they don't delete.** An archived card resolves no rate, so
  its channels fall back to the account rate and then the agency default —
  exactly the behaviour that existed before rate cards. Restoring it brings the
  rate back.

Which rate card a channel bills at is set per channel in Agency Settings →
Channels, along with what kind of money it is and whether the Ad Pacer
reconciles it.

# Who can see and change this

Both are gated, separately:

- **Seeing cost and spend** is a granted capability
- **Changing markup** is a second, narrower one

Someone can legitimately manage budgets all day and never see margin. That is
the design, not a gap.
