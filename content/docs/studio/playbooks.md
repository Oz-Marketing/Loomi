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

# Why it is not per-account

Playbooks are global on purpose. A playbook that existed separately at each
rooftop would be a copy, and copies drift — which is exactly the condition the
coverage audit exists to detect.
