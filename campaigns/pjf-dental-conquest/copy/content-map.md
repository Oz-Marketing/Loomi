# PJF Dental/Medical Conquest — 6-Month Content Map

**Cadence:** 2 unique emails/month × 6 months = **12 emails**. Each email gets a
**resend to non-engaged** ~3–4 days later with a fresh subject.

**Model:** most emails are short **excerpts that link to a full blog post on
pjfcorp.com** (SEO + owned content). Every blog post ends with a **CTA back into
Loomi** (gated guide or consultation) so the funnel captures + qualifies.
A few touchpoints (intro, guide delivery, the convert/offer emails) link
straight to Loomi.

**Audience:** existing **dental + oral-surgery** practices, Northern Utah.
**Segments:** **A = oral surgery / surgical specialty** · **B = general / family /
cosmetic dental**. "Both" = sent to everyone.

**Engagement / resend:** "non-engaged" = **did not click through** (open is
unreliable with Apple MPP). This needs the `hasClickedEmail` condition
(suggestion #2). Until then, resends target non-openers.

**Sunset rule:** after ~3 consecutive non-engagements, drop the contact to a
low-frequency track (or suppress) to protect the young `news.pjfcorp.com` domain.

**Goal exit:** opting in (guide) or requesting a consultation moves a contact out
of the cold track into the opted-in / sales motion.

---

## The 6-month calendar

| # | Month | Phase | Seg | Email (subject, initial) | Links to | CTA into Loomi |
|---|-------|-------|-----|--------------------------|----------|----------------|
| 1 | 1 | Introduce | Both | Planning a clinic build, remodel, or expansion? | Loomi guide LP | Get the free guide |
| 2 | 1 | Introduce | Both | The clinic build & remodel guide we wish every practice had | Loomi guide LP | Download the guide |
| 3 | 2 | Educate | **A** | Why oral surgery build-outs go over budget | Blog A1 | Blog → Request a consultation |
| 4 | 2 | Educate | **B** | The remodel mistakes patients notice first | Blog B1 | Blog → Request a consultation |
| 5 | 3 | Educate | Both | What patients notice about your office (photo-led) | Blog 2 | Blog → Get the guide |
| 6 | 3 | Educate | Both | 5 lessons from 50 years building Utah clinics | Blog 3 | Blog → View projects / consult |
| 7 | 4 | Educate | Both | How to remodel without closing your practice | Blog 4 | Blog → Request a consultation |
| 8 | 4 | Educate | **A/B** | Case study — A: oral surgery suite · B: family-practice remodel | Blog 5A / 5B | Blog → Request a consultation |
| 9 | 5 | Convert | Both | What a clinic build/remodel really costs in Utah | Blog 6 | Blog → Request a consultation |
| 10 | 5 | Convert | Both | How [client] expanded without missing a patient | Blog 7 (case study) | Book a consultation |
| 11 | 6 | Convert | Both | Thinking about 2027? Start the timeline now | Blog 8 | Book a consultation |
| 12 | 6 | Convert | Both | Let's scope your project — free consultation | Loomi consult LP | Book a consultation (standing offer) |

> Phase 1 (Month 1) and emails 1–2 are **already built** in the live subaccount
> (intro + gated lead magnet). Emails 3–4 (the A/B "mistakes" pair) exist as
> templates too and slot into Month 2.

## Blog posts PJF needs to write (the "full excerpt" targets)

Each must (a) be **live before its email sends** and (b) **end with a CTA to the
Loomi guide or consultation page**. Suggested titles + slugs on pjfcorp.com:

| Blog | Working title | Slug | Feeds email |
|------|---------------|------|-------------|
| A1 | The 4 places oral surgery & specialty build-outs blow the budget | `/blog/specialty-buildout-budget` | 3 |
| B1 | What patients notice about your office — and what it costs you | `/blog/what-patients-notice` | 4 |
| 2 | Designing a dental office patients actually like | `/blog/patient-first-office-design` | 5 |
| 3 | 5 lessons from 50 years building Utah clinics | `/blog/50-years-lessons` | 6 |
| 4 | How to remodel your practice without closing | `/blog/remodel-without-closing` | 7 |
| 5A | Inside an oral surgery suite build (case study) | `/blog/oral-surgery-suite-case-study` | 8 (A) |
| 5B | A family-practice remodel, start to finish (case study) | `/blog/family-practice-remodel-case-study` | 8 (B) |
| 6 | What a clinic build or remodel really costs in Utah | `/blog/clinic-construction-cost-utah` | 9 |
| 7 | How [client] expanded without missing a patient | `/blog/[client]-expansion-case-study` | 10 |
| 8 | Planning your 2027 clinic project: the timeline | `/blog/clinic-project-timeline` | 11 |

(~10 posts; emails 1, 2, 12 link straight to Loomi.)

## Funnel logic per email

```
Email (excerpt)  →  Blog post on pjfcorp.com (SEO + full detail)
                       → CTA on the post → Loomi LP (guide opt-in OR consultation)
                          → form submit → tag (opted-in / qualified) → flow → HubSpot
```
Educational emails (3–9) drive to blogs; conversion emails (10–12) drive straight
to the consultation/booking page.

## UTM scheme (every clickable link)

`utm_source=email&utm_medium=email&utm_campaign=pjf-dental-conquest-{YYYY-MM}&utm_content={descriptor}`

- `utm_campaign` uses the **send month**, e.g. `pjf-dental-conquest-2026-08` for Month 2.
- `utm_content` per email: `e01-intro`, `e02-leadmagnet`, `e03-mistakes-a`,
  `e04-mistakes-b`, `e05-patients-notice`, `e06-50-years`, `e07-remodel-open`,
  `e08-case-a` / `e08-case-b`, `e09-cost`, `e10-case-study`, `e11-timeline`,
  `e12-offer`; append `-resend` on the non-engaged resend.
- Blog→Loomi CTAs should carry their own `utm_content` (e.g. `blogA1-consult`) so
  blog-driven conversions are attributable in Loomi's form-submission UTMs.

## Dependencies & open questions for PJF

1. Can they publish ~10 SEO posts on cadence (one ~2 weeks ahead of each send)?
2. Which real client/project can we feature in the case studies (emails 8, 10)?
3. Confirm a human **sender name + signature** (currently "The PJF Corporation
   Team"; a named person, e.g. R. Barton, lifts B2B response).
4. Cost-transparency post (email 9): are they comfortable publishing ranges?
