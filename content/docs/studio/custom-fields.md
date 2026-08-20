---
title: Custom fields
summary: Tracking the things this account cares about that a generic contact record doesn't have.
sector: studio
category: Audiences
audience: everyone
order: 40
covers:
  - src/app/api/contact-custom-fields/**
  - src/components/settings/custom-field-editor-modal.tsx
  - src/lib/contacts/custom-fields.ts
---

Name, email, and phone are the same everywhere. Everything else is
business-specific: the vehicle someone drives, when their lease ends, which
service adviser they see, what size boat they own.

Custom fields are how an account records those. Once a field exists, it can be
filled in by a form, set by a flow, imported from a spreadsheet, filtered on in
a segment, and merged into an email.

# Field types

| Type | Use it for |
| --- | --- |
| Text | Anything free-form |
| Number | Amounts, counts, mileage |
| Date | Purchase date, lease end, birthday |
| Yes/no | A simple flag |
| Choice | A fixed set of options |

Pick the narrowest type that fits. A date stored as text can't be used in "more
than 12 months ago", which is exactly what you will want it for.

# Blueprints

Fields don't have to be invented per account. A **blueprint** is a starting set
of fields for an industry, so a new dealership account arrives already knowing
about vehicles and service visits instead of starting blank.

An account can add its own fields on top. Blueprints are a head start, not a
constraint.

# Choosing names

The field label is what everyone sees for years, in the segment builder, on
forms, in reports. Two habits pay off:

- **Say what it holds, not where it came from.** `Lease end date` outlives
  `Import column F`.
- **Be consistent across accounts.** Segments and reports are much easier to
  reason about when the same idea has the same name at every rooftop.

:::note
Removing a field removes the data in it. If a field has stopped being useful,
stop filling it in before you delete it, and check no segment or flow is
still testing it.
:::
