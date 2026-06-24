# PJF Prospect List — Import Field Mapping

Import at **Contacts → Import** on the **PJF Corp** subaccount, targeting the
**PJF Prospects** list. The list is pre-verified before import — assume clean.

The Loomi importer auto-maps headers (case/space/underscore-insensitive). The
custom fields below were created with matching `csvAliases`, so these headers
auto-map without manual mapping. Confirm the mapping on the dry-run step.

| CSV header     | Maps to (Loomi)             | Type / notes |
|----------------|------------------------------|--------------|
| Email          | `email` (native)             | Required-ish. Dedupe key #1. Lowercased. |
| Phone          | `phone` (native)             | Dedupe key #2. E.164-normalized (US +1 added). |
| First Name     | `firstName` (native)         | Used in `{{firstName}}` merge token. |
| Last Name      | `lastName` (native)          | |
| Practice Name  | `custom:practice_name`       | text → HubSpot `company` on handoff. |
| Title          | `custom:job_title`           | text → HubSpot `jobtitle`. |
| Specialty      | `custom:specialty`           | text (e.g. Oral Surgery, General Dentistry). |
| Segment        | `custom:segment`             | select `A` / `B` (reporting + HubSpot). |
| Region         | `custom:region`              | text (Utah county/metro). |
| Source         | `source` (native)            | e.g. `Apollo`. |
| Consent Date   | `custom:consent_date`        | date — flexible formats accepted. |
| Consent Source | `custom:consent_source`      | text — the lawful basis / where consent/contact basis came from. |
| Tags           | `tags` (native)              | comma-separated. **Must include the segment tag** (see below). |

## Required: segment tag in the Tags column

The cold-sequence flow branches email #3 (A vs B) on the **tag**
`pjf-segment-a` / `pjf-segment-b` (case-insensitive). So every row's `Tags`
cell must carry the right segment tag:

- Segment A (specialists): `pjf-prospect, pjf-segment-a`
- Segment B (general/cosmetic/medical): `pjf-prospect, pjf-segment-b`

`pjf-prospect` is also applied automatically by the flow's first step, so it's
optional in the CSV — but harmless and clearer to include. The `Segment` column
(A/B select field) is for reporting/HubSpot; the **tag** is what drives the
branch.

## Dedupe & overwrite

- Match precedence: **email → phone → create**.
- List-targeted import does **not** overwrite existing contact fields (adds to
  the list only). For a fresh cold list this is moot.

## Compliance note

This is a cold/conquest B2B list. Keep `Consent Source` accurate (e.g. "Apollo
verified business email — legitimate-interest cold outreach"). The CAN-SPAM
footer (PJF's physical address + one-click unsubscribe) is appended to every
send automatically from the account record — do not add one to the data.
