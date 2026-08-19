---
title: Getting help and reporting bugs
summary: Where to look first, how to file something that gets fixed, and where release notes live.
sector: platform
category: Start here
audience: everyone
order: 70
covers:
  - src/components/support-modal.tsx
  - src/app/api/support/**
  - src/app/changelog/**
  - src/lib/changelog-publish.ts
---

# Three places, in order

1. **These docs.** The question-mark button in the top bar opens the help panel,
   and the docs are the first thing in it.
2. **The changelog.** If something moved or looks different, it may have
   changed on purpose. The clock icon in the top bar shows recent updates.
3. **The help desk.** Report a bug or request a feature from the same help
   panel.

# Filing something useful

The report form captures which page you were on automatically, so you do not
have to describe it. What it cannot capture is the part that matters:

- **What you expected to happen.** This is the single most useful sentence.
- **What happened instead.**
- **Whether it happens every time**, or happened once.

A screenshot of the wrong number beats a paragraph describing it. You can paste
one straight into the form.

:::tip
If Loomi is down or you cannot sign in, do not use the form — a report filed
inside a broken app is the wrong channel. The dev team's phone and email are at
the top of the help panel for exactly that case.
:::

# Release notes

Published updates appear in the changelog and, if you have the notification
turned on, in your bell panel. They are written for the person using the
feature, not for the person who built it.

Not every change produces a release note. Most work is plumbing that changes
nothing you do, and announcing it would only make the genuinely useful entries
harder to find.
