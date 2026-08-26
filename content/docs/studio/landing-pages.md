---
title: Landing pages
summary: Standalone pages for a campaign, on Loomi's address or the client's own domain.
sector: studio
category: Web & lead capture
audience: everyone
order: 130
covers:
  - src/app/websites/landing-pages/**
  - src/lib/landing-pages/**
  - src/app/lp/**
  - src/app/api/landing-pages/**
---

A landing page is a single page built for one campaign, with one thing to do on
it. Built from marketing blocks — hero, features, testimonials, FAQ, an embedded
form — with mobile-specific overrides where the desktop layout doesn't survive
the trip.

# Publishing

Every page gets an address on Loomi immediately. Accounts that have verified a
custom domain can publish to their own instead, which is usually what a client
wants for a campaign they are paying to drive traffic to.

Verifying a domain is a DNS change — see
[Account settings](/docs/managing-accounts).

# Which address to share

Once an account has a verified domain, that domain is the page's real address.
It is what the page's **Public URL** shows, what the copy button gives you, and
what search engines are told to treat as the page's home.

The Loomi address keeps working and forwards to it, so links already in an ad, an
email, or a printed QR code don't break. UTM tags survive the forward, so a visit
that arrives the long way round is still attributed to the right campaign.

Share the client's address anyway. Sending traffic to the Loomi address when the
page lives somewhere else costs an extra hop, and the client sees your platform's
name in a URL they are paying to promote.

# The parts people forget

| Thing | Why |
| --- | --- |
| **Page title and description** | What shows in a search result or a shared link |
| **Social preview image** | What shows when the URL is pasted into a message |
| **Tracking** | Analytics and pixel tags, if the campaign is being measured |

None of these are visible on the page itself, which is exactly why they get
missed.

# Measurement

Pages track views, clicks on calls to action, how far people scroll, and
submissions. Enough to answer whether the page or the traffic is the problem —
lots of views and no scrolling is a page problem; no views is a traffic problem.

# The AI assistant

The editor has an assistant that builds and edits the page conversationally,
working from the account's brand. It is quickest for a first structure. As
everywhere, the offer details and legal wording are yours to verify.

# Before you send traffic

- Open it on a phone
- Submit the form yourself and confirm the lead arrives where it should
- Click every link
- Check the page says what the ad that points at it promised
