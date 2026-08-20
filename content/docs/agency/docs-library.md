---
title: How the docs library works
summary: Where these articles come from, how to edit one, and how they are kept current as the app changes.
sector: agency
category: Manage
audience: staff
order: 100
covers:
  - content/docs/**
  - src/app/docs/**
  - src/lib/docs/**
  - scripts/seed-docs.ts
  - scripts/docs-drift.ts
  - scripts/docs-propose.ts
  - .github/workflows/docs-review.yml
---

The articles you are reading are written as markdown files in the repository and
loaded into Loomi on each deploy. That gives them two properties that matter:
they are reviewed in the same pull request as the code they describe, and they
can still be corrected in the app without waiting for a deploy.

# Editing an article

Anyone with docs access gets an **Edit** button on the article. It edits the
title, the summary, the body, who it is for, and whether it is published.

:::warning
The first time an article is saved in Loomi, it **detaches from its file**.
Deploys stop overwriting it, and from then on the app is the source of truth for
that article.

That is the right trade for a typo. It is the wrong trade for a rewrite — a
rewritten article that has detached will not receive any of the automatic
updates below. For anything substantial, change the file.
:::

# Audience

Two values, and the distinction is the same one the changelog uses:

- **Everyone** — clients see it. Write it for the person doing the job. It must
  not name infrastructure, internal tooling, or another client.
- **Staff only** — internal. Never shown to a client, whatever their access.

An article is also narrowed by **sector**: a client only sees articles for
sectors they can enter. Staff see everything.

# Keeping articles current

Each article declares the code it documents:

```
covers:
  - src/app/contacts/**
  - src/lib/segments/**
```

On every merge to the main branch, a job asks git a narrow question: have any
commits touched those paths since this article was last confirmed accurate?

**If yes, two things happen.**

1. **The article is flagged.** Staff see a "may be out of date" badge on it,
   naming what changed. Clients never see this — an out-of-date article is our
   problem, not theirs.
2. **A review is proposed.** Each flagged article and the diff of its covered
   code go to Claude, which returns either the article unchanged or a corrected
   version. Anything it changes is opened as a **pull request**.

Nothing publishes itself. The badge says where to look; the pull request shows a
diff somebody merges or closes. That is the same contract release notes work
under — a machine may notice and draft, a person decides.

# Reviewing a proposed change

Read it as a draft from someone who has read the diff but not used the app. It
is told to leave the article alone unless behavior actually changed, and to
flag anything it could not confirm rather than writing a guess. The "needs a
human eye" section of the pull request is the part to read first.

Closing the pull request is a perfectly good outcome. The article stays flagged
until someone confirms it.

# Clearing a flag by hand

If you have read an article and it is still correct, use **I've checked it —
it's still correct** on the banner. That stamps who checked and when, which is
the difference between a resolved flag and a dismissed one.

# Adding an article

Add a markdown file under `content/docs/<sector>/<slug>.md`. The filename is the
URL, so choose it once — people paste these links.

```
---
title: Lists and segments
summary: One line. The card subtitle and the search blurb.
sector: studio
category: Audiences
audience: everyone
order: 20
covers:
  - src/app/contacts/segments/**
---

# First section

Body text.
```

An article with no `covers` is never checked for drift. That is allowed, and it
is the right answer for something like this article's own conceptual sections —
but for anything describing a screen, name the screen's code.

# House style

- Second person, present tense, American spelling.
- Say what to do, then why it works that way. The why is what makes someone able
  to handle the case you did not write down.
- Lead with the thing that goes wrong most often.
- No marketing language, no "simply", no exclamation marks.
