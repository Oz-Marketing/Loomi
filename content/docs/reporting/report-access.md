---
title: Who sees which report
summary: How report visibility is decided per account and per user, and what to do when a report is missing.
sector: reporting
category: Getting around
audience: staff
order: 15
covers:
  - src/lib/permissions/reports.ts
  - src/lib/permissions/report-sources.ts
  - src/components/settings/report-access-tab.tsx
  - src/app/reporting/_components/nav-visibility.ts
---

Whether a report appears is decided by two independent things. Both have to
pass.

# 1. Does the account have the data?

A report whose source isn't connected doesn't appear. A Business Profile report
needs a connected profile; an ads report needs a linked ad account.

This is automatic — nobody switches it on. Connect the source and the report
appears.

# 2. Is it enabled for this account and this user?

Report access is configured per account. On top of that, a user's Reporting role
decides how much they get: an Analyst sees more than a Viewer, and a Client sees
the client-facing set.

# When someone says a report is missing

Work through it in this order:

1. **Which account are they in?** By far the most common answer.
2. **Is the source connected for that account?** Check the account's
   integration settings.
3. **Is the report enabled for the account?** Check its report access settings.
4. **Does their role include it?** Check their Reporting role.

Only after all four is it a bug worth filing.

# Spend visibility

Seeing cost and spend is a **granted capability**, separate from any role. A
user can legitimately have full Reporting access and still not see money — that
is the grant doing its job, not a broken report.

See [Roles and access](/docs/roles-and-access).
