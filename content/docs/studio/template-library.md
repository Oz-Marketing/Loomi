---
title: The template library
summary: One shelf for every reusable thing — emails, forms, landing pages, flows, ad designs — and how to deploy from it.
sector: studio
category: Templates & creative
audience: everyone
order: 80
covers:
  - src/app/templates/**
  - src/app/api/templates/**
  - src/app/api/template-taxonomy/**
---

**Templates** is one page covering every medium: email designs, form layouts,
landing pages, flows, and ad designs. They were separate libraries once, and
being separate meant nobody could answer "what do we have for a spring service
push" without opening four screens.

# Where a template lives

| Scope | Who sees it |
| --- | --- |
| **Global** | Every account. The agency's shelf. |
| **Account** | One account. Usually a deployed copy someone has since customized. |

# Deploying

Deploying takes a global template and drops a working copy into one or more
accounts. The copy is **detached**: it gets its own identity, and editing it
never touches the original.

That is the whole point. The library stays the reference version; each rooftop
gets something it can adapt without breaking anyone else's.

:::note
Ad designs are the exception — they can be *linked* to their template so
automated ads follow design changes. See [Ad templates](/docs/ad-templates).
:::

# Draft, published, and scheduled

- **Draft** — visible to your team, not usable in a campaign
- **Published** — available for use
- **Scheduled** — published, but only between two dates

Scheduling matters for seasonal creative. A template outside its window
disappears from the library rather than being picked up by mistake in March.

# Filing

Categories and tags are set on the library card, not inside the editor. Keep
them honest: the library is only as useful as your ability to find things in it,
and an untagged template is one nobody else will ever reuse.
