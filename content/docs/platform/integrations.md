---
title: What Loomi connects to
summary: The outside services Loomi uses, what each one does, and what breaks when one is not configured.
sector: platform
category: Start here
audience: staff
order: 60
covers:
  - src/lib/integrations/**
  - src/app/api/webhooks/**
  - src/lib/email/send.ts
  - src/lib/sms/**
---

Loomi owns its own data. These services do the parts that have to happen
somewhere else — putting mail on the wire, reading spend back from an ad
platform, fetching a vehicle photo.

# Sending

| Service | Does | Without it |
| --- | --- | --- |
| **SendGrid** | Delivers email; reports opens, clicks, bounces, and unsubscribes back | Email blasts refuse to schedule |
| **Twilio** | Delivers SMS and MMS; carries replies and STOP back | Text blasts refuse to schedule |

Email blasts are gated by a hard preflight check: the account needs a sending
key, a From address, a verified domain, and a postal address before a blast will
go out. That gate is deliberate — a blast that sends without them is a
deliverability problem you cannot take back.

Text messages hold until 8am–9pm in the recipient's own timezone, worked out
from their area code. That is a legal requirement, not a preference, and it
cannot be overridden.

# Reading

| Service | Does |
| --- | --- |
| **Meta Ads** | Campaign structure, delivery status, and daily spend for the pacer |
| **Google Ads** | The same, plus budget change history so mid-month changes reprorate correctly |
| **Google Business Profile** | Local presence data — views, calls, directions, reviews |
| **MarketCheck** | Inventory and market data behind offer eligibility |
| **EVOX** | Stock vehicle photography, cropped to the ad |

# Elsewhere

- **monday.com** — the help desk board. Bug reports and feature requests filed
  from the help modal land there. If the connection is not configured, they fall
  back to email rather than disappearing.
- **CRM destinations** — form submissions can forward to a dealer CRM, either as
  an ADF email or over an API.

# When something is not configured

Every one of these is optional per environment. The pattern throughout is the
same: a missing credential disables the feature and says so, rather than failing
silently or half-working. If a surface tells you an integration is not
connected, that is the accurate answer — the credential is genuinely not set for
that account.

Integration credentials are a granted capability, not something a role confers.
See [Roles and access](/docs/roles-and-access).
