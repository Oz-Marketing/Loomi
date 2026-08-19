---
title: Pacing alerts and the change log
summary: What raises an alert, who it reaches, why it will not repeat — and the one thing never to do to it.
sector: projects
category: Pacing
audience: staff
order: 70
covers:
  - src/app/api/internal/meta-pacer-alerts/**
  - src/lib/ad-pacer/constants.ts
  - src/app/api/alert-rules/**
  - .github/workflows/meta-pacer-alerts.yml
---

The alert engine runs once a day, early morning Mountain time. It refreshes
spend for every linked account first, then evaluates the rules — so an alert is
never raised against yesterday's data.

# What a rule is

Each rule names four things:

1. **A metric** — account monthly pace, campaign budget burn, a performance
   figure
2. **A baseline** — a fixed threshold, deviation from a rolling average, period
   over period, or a condition holding for a duration
3. **A fire condition** — the comparison that makes it true
4. **A tier** — Urgent, or FYI

Two guards stop rules firing noise:

- **A volume gate.** Below a floor of spend, the percentages are arithmetic on
  nothing. A campaign that spent $12 is not 400% off pace in any useful sense.
- **A cooldown.** A rule that is still true does not re-fire for a set number of
  hours. Without it, one unresolved problem alerts every single morning until
  somebody mutes the whole category — which loses you every other alert too.

Rules are configured platform-wide in **Agency Settings → Alerts**, per channel.
See [Alert rules](/docs/alert-rules).

# Who gets told

Alerts route to the people attached to the ad — its owner, its designer, its rep
— not to everyone with access to the account.

That routing is what makes them actionable, and it has one consequence worth
repeating: **an ad with nobody attached alerts nobody.** Attaching people is
part of setting an ad up.

Each person's own notification settings decide whether an alert reaches the bell
panel, their inbox, or both. See [Notifications](/docs/notifications).

# The one trap

:::warning
**Never re-run the alert job by hand late in the day.**

Its de-duplication is keyed by date. A manual run in the evening marks today as
alerted, which silently suppresses the next morning's scheduled run — and the
failure is invisible: no error, no alert, just a quiet morning that looks like
good news.

If you need a current read on where something stands, open the pacer. It is live
and it costs nothing.
:::

# The change log

Every edit in the pacer writes a row: which ad, which field, from what to what,
by whom, and when. Period-level and account-level changes are recorded too, so a
budget goal change is as traceable as an ad edit.

Changes saved together share a group, so a bulk apply reads as one action rather
than forty separate ones.

It is written automatically. Nobody can add to it, and nobody has to remember
to.

## What it is for

Three questions, all of which get asked eventually:

- **"Who changed this budget?"** — the log has the name and the timestamp.
- **"When did this ad go live?"** — status changes are recorded like any other
  field.
- **"Was this month's target always $18,000?"** — the log shows the before and
  after; a frozen month shows what was true at settlement.

Meta and Google keep separate logs. They share the engine, not the history.
