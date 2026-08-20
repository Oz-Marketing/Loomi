---
title: Alert rules
summary: The thresholds that decide when pacing tells somebody, and who it tells.
sector: agency
category: Configure
audience: staff
order: 70
covers:
  - src/app/api/alert-rules/**
  - src/lib/ad-pacer/alerts/**
  - scripts/backfill-alert-rules.ts
---

Alert rules are the conditions under which an ad's pacing raises a notification.
They are configured once for the platform and apply everywhere.

# What an alert is for

An alert is an interruption, and it is worth having only if somebody would do
something differently because of it. That single test is what should decide
every threshold here.

# Tuning them

The failure modes run in both directions:

| Too sensitive | Too loose |
| --- | --- |
| Alerts every morning | The month ends 30% under and nobody knew |
| People stop reading them | The tool that was supposed to catch it didn't |

The first is worse, because it disables the second's protection too. An alert
everybody ignores is not a safety net.

Start conservative. Widen only when a real miss shows a threshold was too tight.

# Who gets told

Alerts route to the people attached to the ad — its owner, its designer, its
rep — rather than broadcasting to everyone with access.

That routing is what makes the alerts actionable, and it means an ad with nobody
attached alerts nobody. Attaching people is part of setting an ad up, not an
optional extra.

# Timing

The alert engine runs once a day on a schedule, and remembers what it has
already said so a threshold crossed yesterday does not re-alert every morning.

:::warning
Do not re-run the alert job by hand late in the day. Its de-duplication is keyed
by date, so a manual run in the evening will silently suppress the next
morning's scheduled one.
:::
