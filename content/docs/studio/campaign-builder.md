---
title: The campaign builder
summary: Describing a campaign in plain language and getting drafts across every channel back.
sector: studio
category: Campaigns
audience: everyone
order: 45
covers:
  - src/app/campaign-builder/**
  - src/app/api/campaigns/**
  - src/lib/ai/campaign-plan.ts
---

The campaign builder takes a description of what you want to achieve and comes
back with a coordinated set of drafts — email, text, and where it fits, a
landing page and a form.

It works in three steps, and you are in control at each one.

# 1. Plan

Describe the campaign the way you would to a colleague:

> Service reminder for customers who haven't been in for six months or more.
> Push the spring maintenance special, and make it easy to book.

You get back a plan: a suggested audience, what each message should do, and
often a question or two where the description was genuinely ambiguous. Answer
them — the questions are asked because the answer changes the output, not to
seem thorough.

Edit the plan freely. Everything downstream is built from it, so a correction
here is cheaper than a correction later.

# 2. Generate

The assets are written and appear as you go. Every one of them lands as a
**draft**.

:::note
The builder never sends anything. Not on generate, not on approve, not ever. The
output is a set of drafts sitting in the same places you'd have built them by
hand.
:::

# 3. Review

Open each asset in its own editor and treat it as a first draft from a competent
colleague who has never met this client: the structure is usually right, the
specifics need your judgment.

What to check every time:

- **The audience.** The suggested segment is a suggestion.
- **Any number, date, or price.** These are the things worth checking twice.
- **Offer terms and legal wording.** If the campaign involves an offer,
  disclaimers are governed by rules the builder is not the authority on.
- **Voice.** It writes competently and generically. The account's voice is yours
  to add.

# When to use it, and when not

It is at its best on a familiar campaign shape you have run before, where the
work is assembling rather than inventing.

It is worth less on a campaign whose whole point is a specific creative idea — by
the time you have described the idea precisely enough, you have written it.
