---
title: Importing contacts
summary: Getting a spreadsheet of customers into an account without creating a mess you have to unpick.
sector: studio
category: Audiences
audience: everyone
order: 30
covers:
  - src/app/contacts/import/**
  - src/app/api/contacts/import/**
  - src/lib/contacts/import/**
---

Import lives at **Audiences → All Contacts → Import**. It takes a CSV.

# Before you upload

Three things are worth doing in the spreadsheet, because all three are painful
to fix afterwards:

1. **One header row, named plainly.** `First Name`, `Email`, `Phone`. The
   importer matches headers to fields, and a column called `fname_2` will need
   mapping by hand.
2. **One person per row.** A row holding two email addresses becomes one contact
   with one of them.
3. **Decide what the file actually is.** A list of everyone who has ever bought
   is a different import from a list of people who asked to hear from you. The
   second can be marketed to; the first needs thought.

# Mapping

After upload you map each column to a Loomi field. Anything you don't map is
ignored, which is the safe default — an unmapped column never silently lands
somewhere odd.

If a column has no home, that is a sign you may want a
[custom field](/docs/custom-fields) for it. Create it first, then re-import; the
new field will be in the mapping list.

# Matching and updating

Existing contacts are matched on email and phone. A matched row **updates** the
contact rather than creating a second one. A row that matches nobody creates a
new contact.

This means a re-import of a corrected file fixes the records rather than
doubling them — which is the intended way to fix a bad import.

# After the import

- The importer reports how many rows were created, updated, and skipped, and
  why. Read it. A large skip count means the file had a problem.
- Tag the import, or drop the contacts on a list, so you can find exactly this
  batch later.

:::warning
An import is the fastest way to email people who never asked to hear from you,
and that damages the account's ability to reach the people who did. If you are
not sure a file is marketable, ask before you send to it, not after.
:::
