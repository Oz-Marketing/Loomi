---
title: Industries and field blueprints
summary: Why a new account already knows what a lease end date is.
sector: agency
category: Configure
audience: staff
order: 50
covers:
  - src/app/api/industries/**
  - src/app/api/contact-custom-fields/**
  - src/components/settings/**
---

# Industries

Every account has an industry. It is not a label — it drives behavior:

- Which **field blueprint** the account's contacts start with
- Which templates and playbooks are offered
- Where industry-specific reporting applies

Set it when the account is created. Changing it later does not retroactively
reshape contacts that already exist.

# Field blueprints

A blueprint is a starting set of custom fields for an industry. A new
dealership account arrives knowing about vehicles, purchase dates, and service
visits, rather than starting blank and being invented differently at every
rooftop.

An account can add its own fields on top. The blueprint is a head start, not a
ceiling.

# Editing a blueprint

Blueprints are edited in **Agency Settings → Field Blueprints**, and they affect
every account in that industry.

Two rules that save pain:

- **Adding a field is safe.** It appears; nothing breaks.
- **Removing one is not.** Anything filling it or filtering on it stops working.
  Check before you remove, and prefer stopping its use to deleting it.

:::tip
Consistent field names across accounts are what make cross-account segments and
reports possible. The blueprint is where that consistency is enforced — a field
invented separately at eleven rooftops will have eleven names.
:::
