---
title: The email editor
summary: Building an email that survives every mail client, and where the AI assistant helps.
sector: studio
category: Templates & creative
audience: everyone
order: 90
covers:
  - src/lib/email/editor/**
  - src/app/templates/editor/**
  - src/app/api/components/**
  - src/lib/component-schemas.ts
---

Emails are built from **blocks** you drag into place — a hero, a text section, an
image, a button, a two-column split, a footer. Each block has its own settings
panel.

Blocks rather than free-form layout is a deliberate constraint. Email clients
disagree about almost everything, and a block that renders correctly everywhere
is worth more than a layout that renders perfectly in one place and collapses in
Outlook.

# Brand comes from the account

Colors, fonts, and the logo come from the account's branding settings. Set them
once and every email starts on-brand.

If something looks wrong across every template at an account, fix the branding
settings rather than the individual email.

# Personalization

Merge fields drop contact data into the copy — first name, a vehicle, a date.
Every one of them needs a fallback, because some contact somewhere is missing
that field, and `Hi ,` is the classic way to look automated.

# Images

- **Put the message in text, not in a picture of text.** Many clients block
  images by default, and a text-in-image email reads as a blank rectangle.
- **Always write alt text.** It is what shows while images are blocked.
- **Watch the file size.** Slow images on a phone mean the reader has moved on.

# The AI assistant

The assistant in the editor knows the account's branding and the block library.
It is good at:

- A first draft from a description
- Rewriting a section shorter, or in a different tone
- Subject line options

It does not know this month's offer, this dealer's legal wording, or what the
manager said on the call. Treat its output as a draft.

# Code mode

There is a raw HTML mode for the cases the block editor can't express — usually
an OEM-supplied template that has to go out exactly as given.

Use it when you need it, knowing the trade: a hand-coded email is yours to
maintain, and it stops inheriting brand changes automatically.

# Test before you save it as final

Send yourself a test and read it on a phone. Most email is read on a phone, and
most layout problems only appear there.
