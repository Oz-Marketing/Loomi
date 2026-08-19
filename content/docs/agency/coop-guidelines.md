---
title: Co-op guidelines
summary: Loading a manufacturer's co-op rules so the Ad Generator can check creative against them.
sector: agency
category: Configure
audience: staff
order: 80
covers:
  - src/components/settings/coop-guidelines-tab.tsx
  - src/components/settings/coop-pack-editor.tsx
  - src/lib/ad-generator/coop/**
---

Manufacturer co-op programs dictate how their brand may appear in advertising:
logo placement and size, required legal text, how an offer may be described,
which images may be used. Getting it wrong means a claim is rejected after the
money has been spent.

**Agency Settings → Co-op Guidelines** is where those rules are loaded so the
Ad Generator can check against them.

# What a rule pack is

A rule pack is one brand's rules, transcribed as checks the builder can apply,
each citing the document and section it came from.

The citation is not decoration. It is what lets someone answer "why is this
blocked" with a page reference instead of an opinion, and what makes the pack
maintainable when the program changes next year.

# Verified and unverified

| State | Behavior |
| --- | --- |
| **Verified** — transcribed from the current document | Rules can block an ad |
| **Unverified** | Rules warn only |

An unverified pack never blocks. It cannot confirm the rule is current, and
blocking on a rule that might be a year out of date stops real work for no
reason.

# Keeping packs current

Guideline documents are tracked by content. When the stored document changes,
the pack is marked as needing review rather than being silently trusted.

Programs change on the manufacturer's schedule, not yours. A pack that has not
been looked at since last year is the one to check first when something looks
wrong.

# What is deliberately not automated

Rules are transcribed by a person reading the document. They are **not**
extracted by AI.

This was tried and rejected. A co-op rule is a legal constraint with money
attached, and a plausible-sounding rule that is subtly wrong is worse than no
rule — it blocks correct work and passes incorrect work, with confidence.

:::note
Design-time checks catch layout problems — logo too small, missing required
element — while the ad is being built rather than after it is exported. That is
where most real failures are caught.
:::
