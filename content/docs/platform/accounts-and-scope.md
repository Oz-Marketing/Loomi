---
title: Accounts, groups, and scope
summary: What the account picker changes, when a group rolls up, and why some pages ignore the roll-up.
sector: platform
category: Start here
audience: everyone
order: 20
covers:
  - src/contexts/account-context.tsx
  - src/components/account-switcher.tsx
  - src/components/account-scope-toggle.tsx
  - src/lib/account-slugs.ts
  - docs/account-scope.md
---

An **account** is one business you do marketing for — a single rooftop, a single
storefront. It owns its own contacts, templates, campaigns, creative, and
reports. Nothing crosses between accounts unless someone deliberately shares it.

The picker at the top of the sidebar chooses which account you are working in.
Changing it changes the page under you. If a screen looks empty or wrong, the
account picker is the first thing to check.

# Groups

Some accounts are **groups**: an account that owns other accounts. A dealer
group that owns five rooftops is one group account and five child accounts.

A group is two things at once, and keeping them apart saves a lot of confusion:

1. **A business in its own right.** It can have its own contacts, its own
   templates, its own campaigns.
2. **A parent.** It can show you its children's data added together.

When you are standing in a group, a **roll-up toggle** appears in the page
header on pages where the choice actually changes something. Off, you see the
group's own data. On, you see the group plus every account under it.

:::note
The toggle only appears on pages whose content changes with it. A control that
shows up on a page it cannot affect is worse than no control, so pages that
always show one account's data simply don't offer it.
:::

# Where roll-up applies, and where it doesn't

The rule is: **roll-up is for reading, not for operating.**

| Rolls up | Doesn't roll up |
| --- | --- |
| Dashboard totals | Sending a campaign |
| Contacts and audiences | Editing a template |
| Reporting | Building a flow, form, or landing page |
| Project boards and budgets | Generating an ad |

Reading across five rooftops is useful. *Sending* across five rooftops is a
different and much more dangerous action, so production surfaces always operate
on exactly one account. If you need to run the same campaign at five rooftops,
you build it once and deploy it — see
[The template library](/docs/template-library).

# The all-accounts overview

Admins have one more option in the picker: an **All accounts** view. It is a
deliberately narrow surface — a cross-account overview of Projects only.

It is not in Reporting on purpose. Reports gate their roll-up on the account
being a group, so an all-accounts selection would render them empty rather than
aggregate. Rather than ship a screen that silently shows nothing, the mode
simply isn't offered there.

# Sharing between accounts

Two things are shared deliberately rather than copied:

- **Assets** can be published to the Loomi library (everyone) or to all accounts
  of one brand. A shared asset appears inside each account's own library, where
  you already are — there is no separate cross-account browser to go and find
  it in.
- **Templates** — email, form, landing page, and ad designs — can live in the
  global library and be deployed into accounts as independent copies.

When you need *this* account to own its own version of something shared, copy
it. "That rooftop's photo, as mine" is a copy, not a share.
