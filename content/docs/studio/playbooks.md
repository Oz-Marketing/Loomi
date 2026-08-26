---
title: Playbooks
summary: Named bundles of templates, and the audit showing which accounts are covered by them.
sector: studio
category: Templates & creative
audience: staff
order: 115
covers:
  - src/app/playbooks/**
  - src/app/api/playbooks/**
  - src/lib/playbooks/**
  - docs/playbooks.md
---

A playbook is a named bundle of templates — an ad design plus the email shell
that goes with it, for example. It is the step up from the library: the library
holds pieces, a playbook holds the set you actually run together.

:::note
Playbooks are gated per environment and may not be switched on where you are
working. If the nav entry isn't there, that is why.
:::

# The coverage audit

The first thing playbooks answer is a question the template library cannot:
**which accounts have creative for this, and which don't.**

The audit reads across accounts and shows, per playbook, who is covered. That
turns "we should probably run a spring service push everywhere" from an opinion
into a list of the rooftops that don't have one.

Scope it to one account, or run it across all of them.

# When a check does not apply

Some reds are not work. A rooftop that deliberately does not run Google will
still show as missing its Google setup, because the audit works out what applies
from what each account has configured rather than from a decision anyone
recorded.

When that happens, use **Not applicable** on the check and say why. The check
stops counting toward that account's coverage, and your reason is stored against
your name so the next person reading the row can tell a considered exemption from
someone who just got tired of the red.

Two things worth knowing:

- The waived count shows on the account's row, next to its score. A rooftop at
  100% with six waived checks is not the same as one at 100% outright, and the
  screen says so.
- What was actually observed stays visible on the check. Waiving records that you
  accept it, not that nobody should look.

**Score it again** puts a waived check back into the account's coverage.

# When the audit last ran

The audit runs itself every night and the result is stamped under the page
header. If that line says the last run is more than a day old, or that a run
started and never finished, the nightly job needs attention — what you are
looking at on screen was still computed fresh when you opened the page, so the
numbers are current either way.

You will also get a notification when a **blocking** check starts failing on an
account where it was passing before. Only new failures notify; a problem that has
been sitting there for a month does not re-announce itself every morning.

# Why it is not per-account

Playbooks are global on purpose. A playbook that existed separately at each
rooftop would be a copy, and copies drift — which is exactly the condition the
coverage audit exists to detect.
