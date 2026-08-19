---
title: Forms
summary: Capturing leads on a website and turning them into contacts, CRM records, and flow enrollments.
sector: studio
category: Web & lead capture
audience: everyone
order: 120
covers:
  - src/app/websites/forms/**
  - src/app/api/forms/**
  - src/lib/forms/**
  - src/app/f/**
---

A form is built from blocks, the same way an email is, and every submission does
several things at once.

# What a submission does

1. **Creates or updates a contact.** Matched on email and phone, so a returning
   customer updates their record rather than becoming a second one.
2. **Records where it came from** — the page, the campaign, the source.
3. **Optionally enrolls them in a flow**, which is how a lead gets an
   acknowledgment in seconds rather than whenever someone checks.
4. **Optionally forwards to a CRM**, so the sales team sees it where they
   already work.

# Publishing one

Two ways:

- **Hosted.** Loomi gives the form its own address. Nothing to install.
- **Embedded.** A snippet on the client's site. The form resizes itself to fit,
  so it doesn't sit in a scrolling box.

# Spam

Forms are protected automatically — a challenge for suspicious submissions and
hidden traps that only a bot fills in. You do not have to configure it.

If real submissions ever stop arriving, say so rather than assuming the market
went quiet. That is a fixable configuration problem.

# Designing a form that converts

- **Ask for less.** Every field costs you submissions. Ask for what you will
  actually use tomorrow.
- **Say what happens next.** "We'll call you within one business day" converts
  better than "Submit".
- **Test it on a phone.** Most leads arrive from one.

# Templates

A form can be saved as a template and deployed into several accounts. The
deployed copy is independent, so a rooftop can adjust its own without changing
anyone else's.
