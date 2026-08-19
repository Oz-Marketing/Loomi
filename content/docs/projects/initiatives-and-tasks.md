---
title: Initiatives and tasks
summary: Filing a ticket, routing it to the right team, and moving it to done.
sector: projects
category: Delivery
audience: staff
order: 20
covers:
  - src/app/app/projects/board/**
  - src/app/app/projects/tasks/**
  - src/app/app/projects/initiatives/**
  - src/app/app/projects/new/**
  - src/lib/projects/ui.ts
  - src/app/api/projects/**
---

# Filing a ticket

**New** starts the intake. Four things decide everything that follows:

1. **The account.** Which client the work is for.
2. **The team.** Who does it.
3. **The type.** What kind of work it is.
4. **The initiative**, if it belongs to one.

The type is the load-bearing choice. It controls which fields you are asked for
and which teams the ticket can go to, so picking it accurately is what keeps
the form short and the brief complete.

| Type | Goes to |
| --- | --- |
| Dev, Email / Text, Landing page, Form, Flow | Development |
| Ads, Landing page, Form | Digital Ads |
| Social | Organic Social |
| PR, Mass Media | PR & Mass Media |
| Video | Video Production |
| Design, Print / Mailer | Graphic Design |

**Task** is the generic type, always available. Reach for it when nothing else
fits — not as a way to skip the questions.

## Tickets across several accounts

A request can be filed against several accounts at once. For creative types —
design, print, email, SMS, ads, social, video — you are asked whether the
creative is **shared** or **unique per account**.

That answer changes what gets created. Shared collapses to one task; unique
fans out to one task per account. Getting it wrong means either one designer
doing five stores' work on one ticket, or five tickets for one piece of art.

# Working a ticket

Statuses are the same everywhere:

**To do → In progress → In review → Done**, with **Blocked** and **Canceled**
off to the side.

Blocked is worth using honestly. A ticket sitting in "In progress" for nine days
because it is waiting on a client tells nobody anything; the same ticket in
Blocked with a comment tells everybody what to chase.

Priority is Low / Medium / High / Urgent. If everything is urgent, nothing is —
the board sorts by it, so inflation costs you the signal.

## Subtasks

A task can hold subtasks. Use them when one deliverable has genuinely separate
steps with different owners. Do not use them as a checklist — a checklist
belongs in the description, and subtasks each carry their own status, assignee
and due date, which is overhead you do not want on "remember to proofread".

## Comments and mentions

Comments thread on the task. Mentioning someone notifies them, which is the
reliable way to pull a person in — far better than reassigning the ticket to ask
a question and then reassigning it back.

## The activity log

Every change writes itself to the task's history: who assigned it, who moved it,
what changed from what to what. It is automatic, and nobody can write to it
directly.

That is the point. A record somebody has to remember to update is a record that
is wrong exactly when it matters.

# Build it

Tasks whose type produces something Loomi can make — email, SMS, landing page,
form, flow, ads — carry a launch action on the task detail.

**Build it** spins up the real thing in Studio, pre-filled with the account and
the brief, and links it back to the ticket. Ads open the pacer; flows open the
flow builder.

The link is what makes it worth using: from then on the ticket knows what was
built for it, and the asset knows what asked for it.

# Initiatives

An initiative groups tasks for one account and carries the things that belong to
the whole engagement rather than one piece of it — an owner, a start and due
date, a status, and the billing details captured at intake.

Its status is separate from its tasks': **Active, On hold, Completed,
Archived**. An initiative is not automatically complete because its last task
closed, because "the work is finished" and "we are done with the client on this"
are different statements.

:::tip
Archive rather than delete. An archived initiative keeps its tasks and its
history, which is what you want the next time somebody asks what was done for
an account two years ago.
:::
