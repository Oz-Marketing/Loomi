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
landing page, a form, and a flow (an ongoing sequence a contact moves through,
built as draft steps you finish in the flow builder).

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

# Building a campaign by hand

**Create campaign → Manually** skips the plan. It runs in two steps: name the
campaign and tick the pieces it needs from the grid — email, text, landing page,
form, flow, ad, and more than one of any of them — then fill in only what you
ticked. Emails and texts take their content right there; a landing page, form,
flow or ad is created blank under the account and finished in its own builder,
which is the better editor for it. Everything lands as a draft.

# Campaigns from manufacturer offers

For accounts in a vehicle industry, most campaigns are not described — they
are built from the manufacturer's current offers. Those arrive as **Automated**
campaigns: one per account per month, named for the month the offers are for
("October 2026 offers — Young Honda Ogden"), holding one ad design per
permitted template for each offer, and the companion offer email when the
account has email on.

They are built two ways, into the same campaign:

- **On a schedule**, once a day, for accounts with automation on.
- **By hand**, from the Campaigns page — **Create campaign → From OEM
  offers**. Pick the
  account, pick the vehicles and offer types, review what will be built and
  where it lands, and go. The run takes a few minutes; the campaign shows
  **Building…** meanwhile and you can follow it from the wizard or from
  Ad Automation settings → Run history.

A campaign built by hand today and the scheduled run tomorrow land in the same
place — the month's campaign is refreshed, not duplicated. When the month ends
the campaign moves to Archived on its own.

**Picking a design.** Each offer shows one design and, where more than one was
built, a **Select a design** button. Picking one archives the others; **Change
design** and undo stay available. Picking a design does not change the email.

:::note
An account's own users see Automated campaigns and nothing else on this page.
They can pick designs; sending and publishing stay with the account team.
:::

