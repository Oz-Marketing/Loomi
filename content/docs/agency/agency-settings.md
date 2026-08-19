---
title: Agency settings
summary: The platform configuration panel — what is in it, and why it is a panel rather than a place.
sector: agency
category: Getting around
audience: staff
order: 10
covers:
  - src/components/agency-settings-button.tsx
  - src/components/settings/**
  - src/lib/settings-registry.ts
  - docs/settings-architecture.md
---

The cog in the top bar opens **Agency Settings**. It is the same panel on every
surface, and it owns the platform: who is in it, which accounts exist, and the
settings that apply across all of them.

| Group | Items |
| --- | --- |
| **Manage** | Accounts, Users, Teams, Field Blueprints, Knowledge Base |
| **Configure** | Industries, Markup, Alerts, Co-op Guidelines |

# Why it opens over the page

Nothing about the page underneath changes while it is open — no navigation, no
account switch, no nav swap. Close it and you are exactly where you were.

That is deliberate. Platform configuration is something you step into for a
minute and step out of; making it a destination meant losing your place every
time you needed to add a user.

Drill-ins stay inside the panel too. Opening an account or a user from here
opens it in place rather than pushing you out to a page behind the overlay.

# Three tiers of settings

Loomi has settings in three places, and knowing which is which saves a lot of
hunting:

| Tier | Where | Owns |
| --- | --- | --- |
| **Agency** | This panel | The platform: accounts, users, cross-account config |
| **Account** | The sidebar's Settings link | One account: branding, domains, integrations |
| **Personal** | Your profile | You: theme, password, notifications |

The rule of thumb: if it affects more than one account, it is in this panel.

# Users here are agency people

The Users tab lists **your team**, not an account's clients. An account's own
users are listed in that account's settings.

The distinction matters because one combined list put agency staff inside every
account they covered, and put clients into the platform roster. They are two
rosters for two different groups of people.
