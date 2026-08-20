---
title: Users, invites, and access
summary: Adding someone to Loomi and giving them exactly the access they need.
sector: agency
category: Manage
audience: staff
order: 30
covers:
  - src/app/users/**
  - src/app/api/users/**
  - src/app/api/onboarding/**
  - src/components/settings/capability-manager.tsx
---

# Adding someone

Users are invited, never created with a password you set. The invite email
carries a link they use to set their own.

Two rosters, and picking the wrong one is the usual mistake:

- **Agency Settings → Users** — your team. Agency staff, assigned to the
  accounts they cover.
- **An account's own Users tab** — that client's people.

An agency user *assigned* to accounts is covering them, not a member of them.

# Granting access

Access is three separate decisions. Make them separately — bundling them is how
someone ends up with far more than they need:

1. **Tier.** Staff or client. Clients get Reporting only.
2. **Sector roles.** One per sector they need. A designer needs
   `Studio: Designer`, not `Studio: Lead`.
3. **Accounts.** Every account, or a named list.

Start narrow. Widening later takes seconds; discovering someone has had access
to every account for eight months does not.

# Sensitive capabilities

A short list of actions no role grants, given per person and logged:

| Capability | Grant it to |
| --- | --- |
| Send blasts | People who actually press send |
| Export contact data | People who have a reason on the day |
| See cost and spend | People who discuss money with clients |
| Change markup | Almost nobody |
| Manage integration credentials | Whoever sets accounts up |
| Impersonate users | Support, for debugging |

A grant can be scoped to one account rather than everywhere. Use that — "send
blasts, at this rooftop" is usually the accurate permission.

# When someone leaves

Deactivate on their last day, not at the end of the week. Their sessions end and
their access stops immediately.

Deactivate rather than delete: their name stays attached to the campaigns they
built, which is what you want the next time someone asks who set something up.

# Impersonation

Impersonation lets support see exactly what a user sees. It is logged, it is
obvious on screen while it is happening, and it is a granted capability rather
than something admins have by default.
