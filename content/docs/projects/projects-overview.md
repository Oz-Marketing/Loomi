---
title: Projects overview
summary: The internal delivery surface — what it tracks, who files work into it, and how it routes.
sector: projects
category: Getting around
audience: staff
order: 10
covers:
  - src/app/app/projects/**
  - src/app/app/_components/app-sidebar.tsx
  - src/lib/services/projects.ts
---

Projects is where the agency's own work is tracked — the delivery side of what
Studio produces. It is internal. No client sees any of it, and clients cannot be
given access to it: Projects is not a sector a client tier may hold a role in.

# The shape of the work

Three objects, and everything else hangs off them:

| | What it is |
| --- | --- |
| **Initiative** | A body of work for one account — an onboarding, a launch, a seasonal push |
| **Task** | A single unit of work. The ticket. |
| **Team** | Who the ticket routes to |

A task does not have to belong to an initiative. Plenty of work is a one-off
request, and forcing it into a container it doesn't need is friction with no
payoff. But work that spans several teams and several weeks is much easier to
see as an initiative than as fourteen loose tickets.

# How work arrives

An account rep files a ticket against an account, picks the type of work, and
fills in the fields for that type. The rep is recorded as the **requester**;
whoever picks it up is the **assignee**.

The type matters more than it looks. It decides which fields the rep is asked
for — a print job asks for a hit date and a data pull, an email asks for a send
date and an audience — and it decides which teams the ticket can route to. That
is what keeps intake short: nobody answers ninety questions to request one
thing.

# The views

| View | Answers |
| --- | --- |
| **Initiatives** | What bodies of work are open, and for whom |
| **Tasks** | Everything, as a board or a table |
| **My Work** | What is on me right now |
| **Calendar** | What is landing, and when |
| **Budget** | What the money is committed to |

Board, table, and calendar are three views of the same tasks, not three
different lists. Filters carry across them.

# Account scope

Projects follows the same account picker as everything else, with one
difference worth knowing: **a group rolls up.** Standing in a group account, the
boards show its rooftops' work together, because delivery genuinely happens
across a group.

Admins also get the **All accounts** view here — and only here. It is the one
cross-account browsing mode left in Loomi, and it exists because "what is my
team working on" is a real question that no single account answers.

# What Projects is not

It is not a client-facing status page. It is not where client-visible reporting
comes from. And it is not the system of record for money owed — that is the
agreement, which [Project budgets](/docs/project-budgets) explains.
