---
title: Notifications
summary: What Loomi tells you about, where it tells you, and how to turn each kind off.
sector: platform
category: Start here
audience: everyone
order: 50
covers:
  - src/components/notifications-panel.tsx
  - src/components/settings/notifications-tab.tsx
  - src/lib/notifications/**
  - src/app/api/notifications/**
---

The bell in the top bar is the in-app inbox. A dot on it means something arrived
since you last looked.

# Two switches per notification, not one

Every kind of notification has two independent settings in
**Settings → Notifications**:

- **In-app** — whether it appears in the bell panel
- **Email** — whether it also reaches your inbox

They are separate because they are different kinds of interruption. Turning
email off keeps the panel entry and quiets your inbox; turning in-app off stops
both, because there is nothing to mail if the alert is never raised in the first
place.

# What sends

| Kind | What triggers it |
| --- | --- |
| **Pacing alerts** | An ad is off pace against its plan, past a threshold |
| **Task and project activity** | Work assigned to you, comments, due dates |
| **Product updates** | A release note is published |
| **Playbook checks** | A blocking setup check started failing on an account where it was passing |
| **System notices** | Sync failures and other things that need someone to look |

Product updates default to **in-app on, email off**. An unsolicited product
email is a different sort of intrusion from an alert your work depends on, so
the inbox is opt-in.

# Only new problems notify

Several of these — pacing alerts, playbook checks, co-op guideline changes —
compare today against the last time they ran, and tell you only what changed.

That is deliberate. A notification that re-lists every standing problem each
morning becomes something you filter, and then the one morning something
genuinely breaks reads exactly like the thirty mornings before it. So a
problem that has been sitting there for a month does not re-announce itself,
and something going *green* is not an alert either.

The trade-off is that these tell you about **changes**, not about **state**. For
"where does everything stand right now", open the screen — the pacer, or the
Playbooks audit — rather than reading back through the bell.

# Pacing alerts specifically

Pacing alerts are routed to the people attached to the ad — its owner, its
designer, its rep — rather than broadcast. They run once a day. If you are not
getting one you expect, the usual cause is that you are not named on the ad,
not that the alert is broken.

:::tip
Alerts fire on a daily schedule and remember what they already said, so a
threshold you crossed yesterday does not re-alert every morning. If you want a
fresh read on where something stands, open the pacer rather than waiting for a
notification.
:::
