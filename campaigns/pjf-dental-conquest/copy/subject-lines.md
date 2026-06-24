# PJF Dental/Medical Conquest — Subject lines & preview text

Two variants per email: **INITIAL** (what the live flow uses now) and **URGENT**
(an alternate for A/B testing or a second pass). To swap, edit the email node's
`subject` in the flow, or update the template's hidden preheader for preview text.

No emojis. No serif. Value-first; no hard pitch until Phase 3.

---

### Email 1 — Introduction (both segments) · `pjf-dental-01-intro`
- **Subject (initial):** Building or remodeling your clinic? Start here.
- **Subject (urgent):** Before you sign a clinic build contract, read this
- **Preview (initial):** A short, no-pitch series from a contractor who builds dental and medical clinics.
- **Preview (urgent):** The planning decisions that cost practices the most — and how to avoid them.

### Email 2 — Gated lead magnet · `pjf-dental-02-lead-magnet`
- **Subject (initial):** The clinic build guide we wish every practice had
- **Subject (urgent):** 5 costly clinic-build mistakes (free guide inside)
- **Preview (initial):** What dentists should know before building a clinic — free, no strings.
- **Preview (urgent):** A quick read before you budget your next build or remodel.

### Email 3A — Common mistakes, Specialists (Segment A) · `pjf-dental-03-mistakes-specialists`
- **Subject (initial):** Why specialty build-outs go over budget
- **Subject (urgent):** Specialty clinic over budget? Here's why — and the fix
- **Preview (initial):** Imaging, surgical suites, and expansion — where complex builds slip.
- **Preview (urgent):** Surgical suites and imaging are where complex builds quietly slip.

### Email 3B — Common mistakes, General/Cosmetic/Medical (Segment B) · `pjf-dental-03-mistakes-general`
- **Subject (initial):** The remodel mistakes patients notice first
- **Subject (urgent):** Patients notice these remodel mistakes first
- **Preview (initial):** Patient experience, aesthetics, and flow — small misses that cost goodwill.
- **Preview (urgent):** The small remodel misses that quietly cost patient goodwill.

### Email — Guide delivery (opt-in flow) · `pjf-dental-guide-delivery`
- **Subject (initial):** Your clinic build guide is here, {{firstName}}
- **Subject (urgent):** Here's your clinic build guide
- **Preview (initial):** Your download link inside — plus what to read first.
- **Preview (urgent):** Download inside — start with the budget section.

### Email — Re-engagement (non-openers branch) · `pjf-dental-reengage`
- **Subject (initial):** Still planning a clinic project?
- **Subject (urgent):** Did you miss our clinic planning guide?
- **Preview (initial):** No pressure — just the free guide, in case it's useful.
- **Preview (urgent):** One link, no pitch — the free planning guide.

---

## UTM scheme (applied to every CTA link)

`utm_source=email&utm_medium=email&utm_campaign=pjf-dental-conquest-2026-07&utm_content={descriptor}`

`utm_content` per CTA: `intro-cta`, `intro-projects`, `leadmagnet-cta`,
`mistakes-a-cta`, `mistakes-b-cta`, `guide-download`, `guide-consult`,
`reengage-cta`, plus `logo` / `footer` on the header logo and footer link.
Landing-page forms capture these UTMs on submission automatically.
