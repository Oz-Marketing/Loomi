---
title: Flows
summary: Automation that reacts to what a contact does, instead of sending on a date you picked.
sector: studio
category: Campaigns
audience: everyone
order: 70
covers:
  - src/app/flows/**
  - src/app/api/flows/**
  - src/lib/flows/**
  - src/worker/**
---

A campaign goes out once, to everyone, on a date. A flow runs continuously and
reacts: someone submits a form, gets tagged, has a birthday next week — and the
right thing happens for that person, at the right time for them.

# The parts

**A trigger** puts a contact into the flow:

- Joins a list or matches an audience
- Submits a form
- Gets a tag
- A date arrives — a birthday, or a date field on the contact
- You enroll them by hand

**Steps** are what happens next. Send an email. Send a text. Wait three days. Add
a tag. Set a field. Split the path on a condition. Create a task for someone.
Push to a CRM.

**A goal** is what you were hoping for. When a contact hits it, they leave — no
more reminders to book the appointment they just booked.

# Building one

Start with the smallest version that works. A three-step welcome flow that runs
is worth more than a fifteen-step masterpiece that has been in draft for a
month.

Sketch it before you build it. "Who enters, what happens, when do they leave"
answered in three sentences makes the canvas an hour's work rather than an
afternoon's.

# The settings that stop a flow embarrassing you

| Setting | Why it matters |
| --- | --- |
| **Quiet hours** | A step landing at 3am sends at a sensible hour instead |
| **Re-entry** | Whether someone can go through twice. Usually no |
| **Maximum duration** | A hard stop, so nobody is enrolled forever |
| **Goal** | Ends the flow when the point of it is achieved |

Re-entry is the one that bites. A trigger that can fire repeatedly, plus
re-entry allowed, means the same person gets the same welcome email every time
they fill in a form.

# Testing

Enroll yourself first. Use short waits while you test, then set the real ones.
Watch a real contact through the first day before you leave it running.

A flow is live the moment you publish it. Contacts start entering immediately —
including, depending on the trigger, ones who already met the condition.

# Flow templates

A flow with no account attached is a template. Templates are deployed into an
account as a working copy, which is how the same nurture sequence runs at
several rooftops without being rebuilt at each one.
