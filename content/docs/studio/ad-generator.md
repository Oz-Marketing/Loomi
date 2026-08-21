---
title: The Ad Generator
summary: Producing on-brand ad creative by filling in a designer-built template.
sector: studio
category: Templates & creative
audience: everyone
order: 100
covers:
  - src/app/ad-generator/**
  - src/app/api/ad-generator/**
  - src/lib/ad-generator/**
---

The Ad Generator makes finished ad creative without opening a design tool. A
designer builds a template once; you fill in the offer and the vehicle, and get
every size back at once.

# Making an ad

1. **Pick a template.** What is available depends on the account and, for
   vehicle ads, the brand.
2. **Fill in the fields.** Offer type, vehicle, price or payment, dates.
   Required fields are marked.
3. **Choose the vehicle image.** Stock photography is fetched automatically for
   most models; you can upload your own.
4. **Preview every size.** The template lays out each size — square, story,
   banner — and they are not identical. Look at all of them.
5. **Export.** One size or all of them, as a zip.

# Offers and disclaimers

When the template is an offer template, the legal text is **generated from the
fields you filled in**, not typed. Enter a 1.9% APR over 60 months and the
disclaimer says that.

This is deliberate: disclaimers are rule-based, never written freehand and never
written by AI. It is what makes them consistent and defensible.

If the disclaimer looks wrong, the offer fields are wrong. Fix them there.

# Co-op rules

Ads for a manufacturer brand are checked against that brand's co-op rules —
logo placement, required legal text, how an offer may be phrased.

Two outcomes:

- **A warning.** Something to look at. You can proceed.
- **A block.** The ad breaks a rule that would fail a claim. Fix it.

:::note
A rule can only be checked if the guideline document behind it has been loaded
for that brand. An unverified brand warns rather than blocking — it is telling
you it cannot confirm, which is different from telling you it's fine.
:::

# Video ads

An ad moves when one of its layers is a video clip or an animated GIF — usually
the background. Nothing about the ad changes otherwise: the headline, the offer
and the disclaimer sit on top of the clip exactly where the designer placed them.

An ad like that gives you two exports:

- **The stills**, as always. They are frozen on the clip's poster frame, so a
  motion ad still has artwork for placements that don't take video.
- **Export video (MP4)**, which appears next to the download buttons only when
  something in the ad actually moves. One size gives you an `.mp4`; several give
  you a zip of MP4s, each with its matching poster frame.

The poster frame and the video's first frame are always the same picture. That
matters when publishing: Meta asks for a thumbnail alongside a video ad, and this
is where it comes from.

:::note
Video ads have no sound. Feeds autoplay muted, so the audio track is dropped on
purpose — never rely on a voiceover.
:::

Launching a moving ad to Meta from Loomi uploads the video and its thumbnail for
you, as a video ad rather than an image one. If the ad is a video and the server
has no video encoder installed, the launch is refused up front and says so —
before it creates anything on Meta.

# Sizes are not crops

Each size is laid out, not scaled. A headline that fits a landscape banner may
need to be shorter in a story format, and the template will show you.

If one size looks wrong while the others are fine, that size needs attention —
say so rather than exporting the set and hoping.

# What to check before exporting

- Every price, payment, rate, and date against the source
- The expiration date, against the actual offer window
- The vehicle image is the right model and trim
- Every size, not just the first one
- On a video ad, that the poster frame is a frame you'd be happy to show as a
  still — it's the thumbnail, not just the first frame
