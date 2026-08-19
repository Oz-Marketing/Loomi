---
title: Contacts
summary: The customer record every campaign, form, and report is built on.
sector: studio
category: Audiences
audience: everyone
order: 10
covers:
  - src/app/contacts/**
  - src/app/api/contacts/**
  - src/lib/contacts/**
---

Every person you market to is a contact. Contacts are Loomi's own records — not
a copy of a list held somewhere else — which is why a form submission, an email
open, and a report can all point at the same row.

# What a contact holds

- **Identity** — name, email, phone, address
- **Tags** — free-form labels you apply
- **Custom fields** — whatever this account needs to track, defined per account.
  See [Custom fields](/docs/custom-fields).
- **Engagement** — whether they have opened, clicked, or replied recently, kept
  up to date automatically
- **Consent** — whether they are subscribed, and whether they have opted out of
  text

# Adding contacts

Four ways in, and all four land on the same record:

| How | When |
| --- | --- |
| **Import a file** | Bulk. See [Importing contacts](/docs/contact-import). |
| **A form submission** | Automatic, and the usual source going forward |
| **Add manually** | One-offs |
| **A sync** | For accounts wired to an outside source of customer records |

Loomi tidies as it goes: phone numbers are normalized to a single format, and
obviously disposable email addresses are filtered out. That is what keeps a
segment built on "has a mobile number" from being quietly wrong.

# Duplicates

Contacts are matched on email and phone. When two records are clearly the same
person, they can be merged — the surviving record keeps the fuller set of
fields and inherits the other's history, so merging never loses engagement.

# Finding people

The contacts table filters on anything a contact holds. When a filter is one
you will want again, save it — a saved filter becomes a
[segment](/docs/lists-and-segments), and segments are what campaigns and flows
actually send to.

:::warning
Exporting contact data is a granted capability, not something your role includes
by default. If the export button isn't there, that is why — see
[Roles and access](/docs/roles-and-access).
:::
