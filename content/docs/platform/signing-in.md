---
title: Signing in and your profile
summary: Invites, passwords, Google sign-in, and the settings that follow you between accounts.
sector: platform
category: Start here
audience: everyone
order: 40
covers:
  - src/app/login/**
  - src/app/onboarding/**
  - src/app/forgot-password/**
  - src/app/reset-password/**
  - src/app/profile/**
  - src/lib/auth.ts
---

# Getting an account

You do not sign yourself up. Someone at the agency invites you, and the invite
email carries a link that lets you set a password and finish creating the login.

Invites expire. If yours has, ask for a new one rather than trying the old link
again — a fresh invite takes seconds to send.

# Signing in

Two ways in, and both land on the same account:

- **Email and password.** Standard.
- **Continue with Google.** Available if the email on your Loomi invite matches
  a Google account. Signing in with Google never *creates* an account — it only
  signs in a user who was already invited, which is what stops anyone with a
  Google address from getting in.

Forgot your password? Use the link on the sign-in page. The reset email goes to
the address on your user record.

:::note
Signing in on one Loomi address signs you in on the others. Studio, Reporting,
and Projects share a session, so moving between them with the switcher never
asks you to log in again.
:::

# Your profile

The **Profile** page — under your name in the top right — holds the things that
are yours rather than the account's:

- Your name, email, and avatar
- Your password
- Appearance: light or dark theme, font, and the reduced-motion and
  reduced-transparency options
- Your notification preferences

These follow you everywhere. Changing the theme in Studio changes it in
Reporting too.

# The account picker is not a login

Switching accounts changes what you are looking at, not who you are. Your
permissions come with you. If you cannot see an account in the picker, it has
not been assigned to you — that is a change someone with Agency access makes,
not something a different login would fix.
