---
title: Text campaigns
summary: Sending SMS and MMS, and the consent and timing rules that are not optional.
sector: studio
category: Campaigns
audience: everyone
order: 60
covers:
  - src/app/messaging/blasts/sms/**
  - src/lib/sms/**
  - src/app/api/webhooks/twilio/**
---

Text campaigns follow the same three steps as email — message, recipients,
schedule — with a much shorter leash, because texting the wrong person is a
legal problem rather than an annoyance.

# Consent comes first

You may only text people who agreed to be texted. Not "gave you their phone
number" — agreed to be texted. Loomi tracks that separately from email
subscription for exactly this reason, and a contact who has not consented is not
in the recipient count.

STOP replies are processed automatically and immediately. Nobody has to see them
for them to take effect.

# Quiet hours are enforced

A text scheduled outside 8am–9pm **in the recipient's own timezone** is held
until the window opens. The timezone is worked out from the area code.

Where an area code spans more than one timezone, the message waits until it is
inside the window in every possible zone. That is stricter than necessary for
some recipients and correct for all of them.

:::warning
This is not a setting. There is no override, and asking for one is asking to
break the law on the account's behalf.
:::

# Writing the message

- **Say who you are in the first few words.** A text from an unknown number is
  deleted, and an unidentified one gets reported.
- **Include opt-out wording.** Required, and it is what keeps the number
  deliverable.
- **One link, at most.** Multiple links in a marketing text is a carrier
  filtering trigger.
- **Watch the length.** Long messages split into several, and you are billed for
  each part.

# MMS

Attaching an image makes it an MMS: more expensive, more visible, and slower to
deliver in bulk. Worth it for something genuinely visual, not for a logo.

# Replies

Replies come back into Loomi. Somebody needs to be watching them — a campaign
that invites a reply and gets no answer is worse than one that doesn't ask.
