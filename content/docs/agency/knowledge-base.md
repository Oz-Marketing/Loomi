---
title: The AI knowledge base
summary: What Loomi's assistants know about the platform, and how to change it.
sector: agency
category: Manage
audience: staff
order: 90
covers:
  - src/components/settings/knowledge-base-tab.tsx
  - src/lib/ai-knowledge.ts
  - src/app/api/knowledge/**
---

Loomi's AI assistants — the email assistant, the landing page assistant, the
campaign builder — work from a shared body of knowledge about the platform.
**Agency Settings → Knowledge Base** is that body of knowledge, and it is
editable.

# What it is for

It tells the assistants what exists: what a flow is, which blocks an email can
contain, how branding is applied, what a campaign consists of. Without it, they
produce generic marketing content that does not fit the tool it is going into.

# When to edit it

When something the assistants say is wrong or out of date. If the email
assistant keeps suggesting a block that no longer exists, this is where that is
fixed.

# How it differs from these docs

They serve different readers and neither replaces the other:

| | **Knowledge base** | **Docs** |
| --- | --- | --- |
| Read by | The AI assistants | People |
| Written as | Dense reference | Explanation and instruction |
| Optimized for | Being retrieved accurately | Being understood |

Writing one in the other's style makes it worse at its job. A doc written as
model context is unreadable; model context written as a tutorial buries the
facts.

:::tip
Some of what the assistants know is assembled automatically — the current block
library and template categories are read live rather than typed here. You do not
need to keep those in sync by hand.
:::
