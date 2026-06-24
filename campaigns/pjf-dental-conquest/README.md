# PJF Corporation — Dental/Medical Conquest Campaign (Phase 1)

A 6-month, value-first B2B cold-outreach campaign to Utah dental & medical
practices. Loomi owns acquisition → nurture → "qualified"; qualified leads hand
off to PJF's HubSpot. Email-first; **no cold SMS** (SMS only after opt-in).

**Phase 1 (Month 1) is built and live** on the `pjfCorp` subaccount in local
dev. Phases 2–3 are scoped but not yet built (review Phase 1 first).

## How it was built

Everything is provisioned via Loomi's own service layer by an idempotent script:

```bash
DATABASE_URL=… npx tsx scripts/pjf/provision.ts
```

Re-running updates the account, fields, forms, pages, and templates in place and
fully rebuilds the three flows. Source modules:

| File | What it holds |
|------|---------------|
| `scripts/pjf/brand.ts` | Brand colors/fonts/logo, business details, sender identity, UTM helper, tags |
| `scripts/pjf/email-layout.ts` | Responsive inline-CSS email shell + button/heading helpers |
| `scripts/pjf/emails.ts` | The 6 email templates (HTML + subject/preview variants) |
| `scripts/pjf/forms.ts` | Opt-in + consultation form schemas (v1 FormTemplate) |
| `scripts/pjf/pages.ts` | The 2 landing pages (HTML mode, embed forms) |
| `scripts/pjf/provision.ts` | Orchestrator (account → fields → list → forms → pages → templates → flows) |

## What's live on the `pjfCorp` subaccount

- **Account** — branding, address, Mountain TZ, sender `communications@news.pjfcorp.com`.
- **8 custom fields** — `practice_name, job_title, specialty, segment (A/B),
  region, consent_date, consent_source, lifecycle_stage`.
- **Funnel tags** — `pjf-prospect → pjf-engaged → pjf-opted-in → pjf-qualified →
  pjf-handoff` (+ `pjf-segment-a/b` set at import).
- **List** — `PJF Prospects` (cold import target).
- **2 forms (published)** — `/f/pjf-clinic-build-guide-opt-in`,
  `/f/pjf-request-a-consultation`.
- **2 landing pages (published)** — `/lp/pjf-clinic-build-guide-lead-magnet`,
  `/lp/pjf-request-a-consultation`.
- **6 email templates** — `pjf-dental-01-intro`, `-02-lead-magnet`,
  `-03-mistakes-specialists`, `-03-mistakes-general`, `-guide-delivery`,
  `-reengage`.
- **3 flows (published / active):**

```
Cold Sequence (Phase 1)   [trigger: list "PJF Prospects"; quiet hours 08:00–17:00 MT; exits on opt-in]
  → tag pjf-prospect → Email 1 (intro)
  → wait 3d → Email 2 (lead magnet) → wait 5d
  → condition: hasOpenedEmail?
       engaged → tag pjf-engaged → condition: tag pjf-segment-a?
                                       A → Email 3A (specialists)
                                       else → Email 3B (general)
       else → Email (re-engagement)

Opt-in Capture            [trigger: lead-magnet form submission]
  → tag pjf-opted-in (SMS now allowed) → Email (guide delivery)

Qualified Handoff         [trigger: consultation form submission]
  → tag pjf-qualified → push_to_crm (HubSpot) → tag pjf-handoff
```

## Funnel → Loomi mapping

Loomi has no native pipeline, so stages are tags (+ the `lifecycle_stage` field
for reporting). Prospect → Engaged (`hasOpenedEmail`) → Opted-in (lead-magnet
form) → Qualified (consultation form) → Handoff (HubSpot push).

## Compliance (built-in)

- Every flow email gates on deliverable-email, DND (`dnd.email`), and the
  `EmailSuppression` list; SendGrid auto-appends the **CAN-SPAM footer**
  (PJF's physical address + one-click unsubscribe) from the account record. No
  footer is baked into templates (would duplicate).
- Cold SMS is impossible by default — SMS only sends when `dnd.sms` allows, and
  nothing in Phase 1 sends SMS.

## Two placeholders to swap before launch

1. **Lead-magnet PDF** — currently `…/assets/pjf/clinic-build-guide.pdf`
   (placeholder). Set `LEAD_MAGNET_PDF_PLACEHOLDER` in `brand.ts` to the real
   asset URL (or upload via Media) and re-run.
2. **HubSpot Meetings embed** — the consultation LP has a styled placeholder +
   an HTML comment showing exactly where the `meetings-iframe-container` div +
   `meetings-embed.js` go. Drop in PJF's Meetings link once the portal's ready.

## To go live (config, not code)

1. Attach a **SendGrid API key** + verify the **`news.pjfcorp.com`** sending
   domain (DKIM/SPF). Sending is inert until this exists.
2. Warm the domain (conservative pacing) before the cold list.
3. Import the Apollo prospect list into **PJF Prospects**
   (see `import/field-mapping.md`).
4. Connect the **HubSpot** Private-App token (scope `crm.objects.contacts`) as a
   CRM destination + optional pipeline/stage; `push_to_crm` activates
   automatically. **Live-test one real push** (still pending from PR #71).
5. Swap the two placeholders above.

## Phases 2–3 (not yet built)

- **Phase 2 (Months 2–4):** "What patients notice" (photo-led), "Lessons from
  past projects" (case studies), segment variants, a dedicated re-engagement
  track. Extends the Cold Sequence flow / adds a nurture flow.
- **Phase 3 (Months 5–6):** strongest proof/case studies, direct consultation
  CTA + booking, standing offer.
