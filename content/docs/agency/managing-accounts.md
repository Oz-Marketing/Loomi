---
title: Accounts and groups
summary: Creating an account, setting it up properly, and grouping rooftops under a parent.
sector: agency
category: Manage
audience: staff
order: 20
covers:
  - src/components/accounts-list.tsx
  - src/components/subaccount-detail.tsx
  - src/app/api/accounts/**
---

Accounts are created in **Agency Settings → Accounts**.

# Setting one up properly

A new account works immediately and is useless until it is configured. The
order that saves rework:

1. **Name and industry.** Industry drives the field blueprint, so set it before
   anyone starts adding contacts.
2. **Branding.** Colors, fonts, logo. Every template built afterwards inherits
   these; setting them later means going back through the templates.
3. **Sending identity.** From name, from address, reply-to, and the postal
   address that legally has to appear in marketing email.
4. **Integrations.** Ad accounts, Business Profile, CRM destination.
5. **Users.** Who at the client gets access, and to what.

:::warning
Step 3 is the one that gets skipped, and it is the one that stops a blast
sending. An account without a verified sending domain and a postal address
cannot send email — deliberately, because sending without them damages
deliverability for every account.
:::

# Groups

A group account owns other accounts. Set the parent on the child, and the group
gains the option to roll its children's data up.

A group is a real account as well as a parent: it can have its own contacts,
templates, and campaigns. Give it a primary account if it operates as a business
in its own right.

See [Accounts, groups, and scope](/docs/accounts-and-scope) for what rolls up
and what doesn't.

# Custom domains

An account can publish landing pages on its own domain. It is a DNS change on
the client's side — a record they add to prove they own it, and once verified,
pages publish there instead of on the Loomi address.

Verified is the word that matters. Until the record is in place and checked, the
domain does nothing and pages stay on the Loomi address. After verification the
client's domain becomes the real address for every landing page in the account,
and the Loomi address forwards to it.

If an account has more than one verified domain, the first one verified is the
one pages publish on. Adding a second doesn't move existing pages — that is
deliberate, because moving a page's address after it has been advertised loses
whatever standing it had built up.

Give this a lead time. It depends on somebody else making a DNS change, and that
is rarely same-day.

# Archiving

Archive rather than delete. An archived account stops appearing in pickers and
keeps its history, which is what you want when a client leaves and then comes
back, or when someone asks what ran two years ago.
