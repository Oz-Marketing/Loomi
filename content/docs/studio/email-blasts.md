---
title: Email campaigns
summary: Building, scheduling, and sending an email — and the checks that stand between you and a bad send.
sector: studio
category: Campaigns
audience: everyone
order: 50
covers:
  - src/app/messaging/blasts/**
  - src/app/api/blasts/**
  - src/lib/email/**
  - src/app/api/webhooks/sendgrid/**
---

A campaign is built in three steps, and Loomi keeps them as three screens so you
can't accidentally skip one: **template → recipients → schedule**.

# 1. Template

Pick an existing email or build one. The editor is covered in
[The email editor](/docs/email-editor).

Two things are added for you and cannot be removed:

- An unsubscribe link, because sending without one is illegal.
- One-click unsubscribe headers, which is what keeps a campaign out of spam
  folders when someone uses their mail app's own unsubscribe button.

# 2. Recipients

A list, a segment, or both. The screen shows how many people will actually
receive it after suppressions are applied — and that number is the real one.

Loomi removes, automatically:

- Anyone unsubscribed
- Anyone whose address has hard-bounced
- Anyone who marked a previous send as spam

You cannot send to those people, and that is the point. A suppression list is
the thing protecting every other campaign from this account.

# 3. Schedule

Send now, or pick a time. Scheduled sends can be edited or canceled right up
until they start.

# What happens during a send

Sends go out per recipient. One bad address fails on its own rather than
stopping the batch, so a campaign never half-sends because of a single typo.

Opens, clicks, bounces, and unsubscribes come back continuously and land on the
contact record. That is what makes "clicked in the last 30 days" a segment you
can actually build.

# Before you press send

:::warning
This is the one action in Loomi you cannot take back.
:::

- **Send yourself a test.** Read it on a phone.
- **Check the recipient count**, and check it is the audience you meant.
- **Click every link.** A campaign linking to last month's landing page is the
  most common recoverable mistake, and only recoverable before it sends.
- **Check the From name and reply-to.** Replies go to a real person only if
  someone set that up.

Sending is a granted capability — if the Send button isn't available to you,
that is deliberate, and someone with the grant can send on your behalf.
