---
title: Roles and access
summary: What decides which parts of Loomi you can open, and how access is granted.
sector: platform
category: Start here
audience: everyone
order: 30
covers:
  - src/lib/permissions/**
  - src/lib/roles.ts
  - docs/permissions-architecture.md
---

What you can see in Loomi is decided by three separate things. Keeping them
apart is what lets someone be, say, a designer in Studio and an admin in
Projects without being either of those things everywhere.

# 1. Your tier

Staff or client. This is the coarse line, and it is the one that decides whether
you are inside the agency or outside it.

**Client users get Reporting.** That is the deliberate boundary: a client sees
their own reports and nothing about how the work is produced.

# 2. Your sectors and roles

Loomi is divided into four sectors. You hold a role in each sector you have
access to, and no role means the sector doesn't appear at all — the nav drops
it and its pages refuse.

| Sector | Roles, most access first |
| --- | --- |
| **Agency** | Owner, Admin, User Manager |
| **Studio** | Lead, Producer, Designer, Viewer |
| **Reporting** | Admin, Analyst, Client, Viewer |
| **Projects** | Admin, Lead, Member, Requester |

Clients may only hold a Reporting role. Studio, Projects, and Agency are
internal.

# 3. Your account list

Separately from all of the above, a user is either unrestricted — they can reach
every account — or limited to a named list. This is what stops one rooftop's
staff from seeing another rooftop's contacts even though both are, say, Studio
Producers.

# Sensitive actions are granted one at a time

A handful of actions are dangerous enough that no role confers them. They are
granted per person, and every grant is logged:

- Sending a blast
- Exporting contact data
- Seeing cost and spend
- Changing markup
- Managing integration credentials
- Impersonating another user

"Admin can do everything" is a reasonable default right up until the everything
includes irreversible outbound sends, bulk personal data, and money. These are
the exceptions.

# Asking for access

Access is assigned in Agency Settings by someone holding an Agency role. If a
page you expect isn't there, that is what to ask for — name the sector and what
you are trying to do, rather than asking to be "made an admin", which is
usually much more than you need.
