# Audience Segment Builder — Audit & Plan

**Date:** 2026-08-13
**Question asked:** is the segment builder strong enough to be the source of truth for
audiences we push into Google Ads (Customer Match) and other retargeting platforms?

**Short answer:** No, not yet — but the gap is architectural, not cosmetic. The filter
*vocabulary* is decent. The *evaluation model* (client-side JS over a capped page of
already-fetched contacts) can't produce a trustworthy, complete, repeatable membership
list, and there is currently no consent/eligibility model, no identity normalisation for
hashed upload, no membership persistence, and no write path to any ad platform.

---

## 1. What exists today

| Piece | File | Role |
|---|---|---|
| Filter type system | [src/lib/smart-list-types.ts](../src/lib/smart-list-types.ts) | Field catalogue, operator sets, `FilterDefinition` JSON shape |
| Filter engine | [src/lib/smart-list-engine.ts](../src/lib/smart-list-engine.ts) | Pure in-memory predicate evaluator over `Contact[]` |
| Builder UI | [src/components/contacts/segment-editor.tsx](../src/components/contacts/segment-editor.tsx) | Two-pane group/condition builder + live preview |
| Storage | `model Audience` — [prisma/schema.prisma:407](../prisma/schema.prisma) | `filters` = JSON string, `providerMetadata` = unused JSON string |
| API | [src/app/api/audiences/route.ts](../src/app/api/audiences/route.ts), [`[id]/route.ts`](../src/app/api/audiences/[id]/route.ts) | CRUD only — no resolve, no count, no members |
| Presets | [src/lib/smart-list-presets.ts](../src/lib/smart-list-presets.ts), [api/audiences/seed-lifecycle](../src/app/api/audiences/seed-lifecycle/route.ts) | Seeds lifecycle segments for automotive accounts |
| Server-side resolution | [src/lib/services/loomi-flows.ts:1560](../src/lib/services/loomi-flows.ts) | `resolveAudienceContactIds()` — keyset-scans all contacts, runs the same JS engine. **Not exported, flows-only.** |

Nine consumers call `evaluateFilter()` — segments list, segment editor, all four blast
recipient/schedule pages, the email blast modal, and the flows engine.

### What's genuinely good

- One `FilterDefinition` JSON shape used everywhere; version-stamped (`version: 1`).
- Nested group logic (AND/OR at group level *and* across groups).
- Custom fields are first-class — declared with a type, merged into the field catalogue,
  routed through `Contact.customFields` by the engine ([smart-list-types.ts:283](../src/lib/smart-list-types.ts)).
- Thoughtful date operators (`within_last_days`, `more_than_days_ago`, `overdue`) with
  calendar-day semantics, which is what the lifecycle flows actually need.
- Flows already keyset-paginate the whole contact table rather than capping at 10k
  ([loomi-flows.ts:1528](../src/lib/services/loomi-flows.ts)) — the right instinct, just applied in only one place.

---

## 2. Findings

Ordered by what would hurt most when a segment becomes an ad-platform audience.

### 2.0 — HIGH ✅ **FIXED**: the campaign recipient cap was applied *before* the segment filter

Found while wiring up Phase 1; same root cause as §2.1, but on the send path rather than
a display.

> **Correction to an earlier draft of this section.** I first wrote this up as "blasts
> silently drop every recipient past 5,000", implying unbounded data loss. That
> overstated it. There is a *deliberate* 5,000-recipient ceiling per campaign, enforced
> server-side ([email schedule route:89](../src/app/api/blasts/email/[id]/schedule/route.ts),
> [SMS:82](../src/app/api/blasts/sms/[id]/schedule/route.ts)), so a large audience being
> capped is intended behaviour. The real defect is narrower and subtler — the **ordering**
> described below.

The blast schedule pages don't just *show* a filtered count — they build the actual
recipient list in the browser and POST it:

```
src/app/messaging/blasts/[id]/schedule/page.tsx:325   fetch(`/api/contacts?accountKey=…&all=true`)   // capped at 5,000
src/app/messaging/blasts/[id]/schedule/page.tsx:407   matched = evaluateFilter(sendable, filter, …)
src/app/messaging/blasts/[id]/schedule/page.tsx:408   return matched.map(c => ({ contactId, accountKey, email, fullName }))
```

`recipients` is what `handleSchedule()` sends. Same shape in the SMS
([sms/[id]/schedule/page.tsx:166](../src/app/messaging/blasts/sms/[id]/schedule/page.tsx)) and multi-channel
([multi/[id]/schedule/page.tsx:196](../src/app/messaging/blasts/multi/[id]/schedule/page.tsx)) flows.

The browser fetched the **5,000 most-recently-added** contacts and *then* applied the
segment filter. So the ceiling landed before the filter instead of after it.

For a segment that correlates with recency ("added this week") the difference is
invisible. For one that doesn't — *"purchased more than 2 years ago"*, *"lapsed
service"*, *"lease ending soon"* — the campaign reached only those members who happened
to fall inside the newest 5,000 rows. On a 40,000-contact rooftop that can be a small and
essentially arbitrary slice of the real audience. Nothing indicated it: the campaign
reported sending to its full (truncated) list, and the sent-count reconciled perfectly.

The intended behaviour is the reverse order — filter the whole roster, *then* apply the
ceiling, and say so when the audience exceeds it.

**Fix (shipped).** All three send paths and all three audience-picker counts now resolve
server-side through `POST /api/segments/recipients`
([recipients.ts](../src/lib/segments/recipients.ts)), which filters the entire roster and only
then applies the limit. When an audience genuinely exceeds the ceiling the schedule button
is disabled and the pre-flight checklist says *"Audience is N contacts — over the 5,000
per-campaign limit. Narrow the segment."* rather than quietly sending a prefix. The
deliverability predicates were copied verbatim from the pages (including
`isLikelyDialablePhone(normalizePhoneNumber(…))` for SMS) so this changes *which contacts
are considered*, not *what counts as reachable*.

**Still worth doing:** size the historical exposure. I couldn't from this worktree — the
local dev database has 5 contacts across 4 accounts. Against production:

```sql
SELECT "accountKey", COUNT(*) FROM "Contact" GROUP BY 1 HAVING COUNT(*) > 5000 ORDER BY 2 DESC;
```

Any rooftop listed there has had recency-skewed sends on non-recency segments, and past
campaign results for those segments should be read with that in mind.

### 2.1 — Blocking: segment membership is computed client-side over a capped sample

`listContactsForAccount({ all: true })` caps at **`MAX_FETCH_ALL = 5000`**
([queries.ts:170](../src/lib/contacts/queries.ts)). Both the segments list and the segment editor fetch
with `all=true` and then run `evaluateFilter` in the browser:

- [segments/page.tsx:159](../src/app/contacts/segments/page.tsx) — member counts
- [segment-editor.tsx:192](../src/components/contacts/segment-editor.tsx) — live preview

For any account past 5,000 contacts, **every segment count in the product is silently
wrong** and the preview is a sample of the 5,000 most-recently-added contacts, not the
segment. There is no warning banner for the single-account case (`sampled` is hardcoded
`false` at [segment-editor.tsx:165](../src/components/contacts/segment-editor.tsx)).

Org-wide/roll-up mode is worse: it uses `/api/contacts/aggregate` with
`limitPerAccount=250` (hard max 250, [aggregate/route.ts:19](../src/app/api/contacts/aggregate/route.ts)) — so a
portfolio segment is evaluated against at most 250 contacts per rooftop.

Dealer CRM extracts routinely run 20k–100k+ rows per rooftop. This is the single biggest
issue: you cannot ship an audience to Google whose size you can't correctly state.

### 2.2 — Blocking ✅ **FIXED**: the browser engine and the server engine disagree

**Fix (shipped).** The five messaging fields are now denormalised columns on `Contact`
(`lastEmailDeliveredAt`, `lastEmailOpenedAt`, `lastEmailClickedAt`, `lastSmsAt`,
`lastMessageAt`), advanced forward-only by the SendGrid and Twilio webhook handlers and
backfilled from existing event history by
[scripts/backfill-contact-engagement.ts](../scripts/backfill-contact-engagement.ts).

That removes the divergence at the root rather than patching each consumer: the fields are
on the row, so every reader sees them. Three consequences worth noting —

- `getMessagingSummaryForContacts` and its four aggregate joins are **deleted**. Reading a
  contact no longer costs an aggregate over `EmailEvent`/`SmsEvent`.
- Engagement segments now take the **SQL fast path** instead of forcing a full-roster scan,
  which matters because they're among the most common.
- The rollups are **timestamps**, so segments can finally ask *"opened in the last 30
  days"*. The lifetime booleans (`hasOpenedEmail`) are kept and derived from the
  timestamps, so saved segments are untouched — but they decay toward "everyone" as a
  roster ages and new segments should prefer the dated versions.

The flows engine now calls the same `collectSegmentContactIds` the builder does, so an
audience trigger and a preview are answered by one piece of code.

### 2.2 (original finding)

`resolveAudienceContactIds()` loads **raw Prisma rows** and hands them to the same
`evaluateFilter`. But the messaging fields are *materialised* by the API layer from
`EmailEvent` / `SmsEvent` aggregates ([queries.ts:255](../src/lib/contacts/queries.ts)) and don't exist on the
DB row. So on the server:

- `hasReceivedEmail`, `hasOpenedEmail`, `hasClickedEmail`, `hasReceivedSms`,
  `hasReceivedMessage` are all `undefined` → `toBoolean(undefined)` → **`false`**
- `lastMessageDate` is always empty

A segment like *"has opened an email in the last 90 days"* previews as N in the UI and
enrolls **zero** contacts through a flow trigger. Same JSON, two answers.

Second divergence: an empty `groups` array means *everyone* in `evaluateFilter`
([smart-list-engine.ts:26](../src/lib/smart-list-engine.ts)) and *nobody* in `resolveAudienceContactIds`
([loomi-flows.ts:1569](../src/lib/services/loomi-flows.ts)). Opposite fail modes on the same input.

### 2.3 — Blocking ✅ **FIXED**: no consent / suppression / DND model in segmentation

**Fix (shipped).** Three parts, in order of how much they matter:

1. **An unconditional export gate** ([eligibility.ts](../src/lib/segments/eligibility.ts)).
   `resolveEligibleForSync` is what every export path calls, and it removes suppressed,
   opted-out, and unidentifiable contacts whether or not anyone thought to filter for
   them. This is deliberately **not** a filter the user adds or a checkbox they tick —
   a warning is something people learn to click past, and this is the one control between
   "we hold this person's email" and "we uploaded this person's email to Google".

   It gates per channel, so someone who unsubscribed from email but never opted out of
   SMS stays in the audience via phone rather than being dropped wholesale.

2. **A per-sub-account consent basis** (`audienceSyncConsentBasis` / `…At` / `…By` on
   `Account`, written through [audience-consent](../src/app/api/accounts/[key]/audience-consent/route.ts)).
   Absent it, the gate throws — a **hard stop**, not an empty result, because an empty
   result reads as "nobody qualified" rather than "you may not do this". Recorded per
   sub-account because that's the level the statement is actually true at: one rooftop's
   intake forms say nothing about another's. Restricted to developer/super_admin, and it
   records who attested and when.

   Per-contact consent would be finer-grained, but **the CRM feeds carry no consent
   column today**, so there is nothing truthful to populate one from. See the open
   decision in §6.

3. **Visibility.** `dndEmail` / `dndSms` are now filterable, and the builder shows the
   syncable count next to the segment size with a breakdown — *"12,431 syncable · 3,902
   excluded: 1,204 opted out, 890 suppressed, 1,808 no email or phone"*. The gap between
   segment size and audience size is the number that surprises people, and it should
   surprise them while they're building, not after the platform reports back.

### 2.3 (original finding)

`Contact.dnd` (`{email, sms}`) is selected from the DB but **never serialised into the API
`Contact`** ([queries.ts:72](../src/lib/contacts/queries.ts)) and is absent from `FILTERABLE_FIELDS`. Same for
`EmailSuppression` — it's applied at *send time only*
([email-blasts.ts:668](../src/lib/services/email-blasts.ts), [loomi-flows.ts:2736](../src/lib/services/loomi-flows.ts)).

That is survivable while segments only feed email/SMS, because the send path filters them
out downstream. **It stops being survivable the moment a segment is exported.** An
audience push to Google is not a send — it bypasses every one of those gates. As written,
a Customer Match upload would include people who unsubscribed, hard-bounced, or filed a
spam complaint.

Also missing: any record of *how* a contact's data was collected, which is the basis for
the Customer Match policy attestation, and any `Consent{adUserData, adPersonalization}`
signal to pass with the upload.

### 2.4 — High: the engine fails **open** on unknown operators

Every evaluator ends in `default: return true` — text ([:195](../src/lib/smart-list-engine.ts)),
number ([:241](../src/lib/smart-list-engine.ts)), date ([:347](../src/lib/smart-list-engine.ts)),
tags ([:416](../src/lib/smart-list-engine.ts)), select ([:452](../src/lib/smart-list-engine.ts)).

So an operator/type mismatch matches **everybody**. This is reachable in practice: change a
custom field's declared type from `date` to `text` after segments were saved against it, and
every stored `after` / `more_than_days_ago` condition on that field flips from "narrow the
audience" to "match all". Combined with an export path, that's an accidental full-database
push. Filter engines must fail closed.

Related: `contains ""` is also true for everyone — `cleanForSave` strips empty-value
conditions on save ([segment-editor.tsx:78](../src/components/contacts/segment-editor.tsx)), but nothing enforces that
server-side, and the API accepts any JSON with `version: 1` and an array of groups
([api/audiences/route.ts:42](../src/app/api/audiences/route.ts)).

### 2.5 — High: `POST /api/audiences` lets any authenticated user create an org-wide segment

The account check is `if (accountKey && userRole !== 'developer' && ...)`
([api/audiences/route.ts:52](../src/app/api/audiences/route.ts)). Omit `accountKey` entirely and the guard is
skipped — the segment is created with `accountKey: null`, which `getAudiences()` returns to
**every** user. `PATCH`/`DELETE` correctly restrict org-wide segments to
developer/super_admin ([`[id]/route.ts:15`](../src/app/api/audiences/[id]/route.ts)); `POST` doesn't. A `client`-role
user can create a segment nobody but a developer can then remove.

### 2.6 — High: dead and missing fields in the filter catalogue

- **`dateOfBirth`** is offered in the builder ([smart-list-types.ts:232](../src/lib/smart-list-types.ts)) but is not
  in `CONTACT_SELECT` and not on the API `Contact` type — so client-side it is *always*
  empty. Birthday segments silently match nothing in the UI (they do work server-side in
  flows, since that path reads full rows — divergence again).
- **`country`** exists on the Contact model and API type but isn't filterable — awkward,
  since Customer Match address matching requires a country code.
- ✅ **FIXED** — **`vehicleYear`** and **`vehicleMileage`** were typed `text`, so
  `> 60,000 miles` or `year between 2019 and 2022` were impossible. They now use a
  `numeric_text` type that offers *both* operator families and dispatches on the operator,
  so `mileage num_gt 60000` works while every saved `contains` / `equals` segment keeps
  working. Re-typing them to plain `number` would have invalidated those segments — and
  with the engine now failing closed, invalid means "matches nobody", silently.

  Both engines share a deliberately **restricted** numeric grammar (plain decimals,
  thousands separators stripped) rather than JS `Number()`, which also accepts hex and
  exponent notation. `'0x10'` is not 16 miles, `'1e3'` is not the year 1000, and — more
  practically — a shared restricted grammar is something SQL can reproduce exactly, where
  JS's full coercion table is not. The differential tests seed `'72,500'`, `' 85000 '`,
  `'12k'`, `'0x10'`, `'1e3'` and `'9500.5'` to hold both sides to it.
- ✅ **FIXED** — **`ContactEvent` was entirely unreachable.** Service and sale history is
  now rolled up onto the contact (`serviceVisitCount`, `saleCount`, `lifetimeSpend`, and
  first/last service+sale dates), recomputed by the event ingest and backfilled by
  [scripts/backfill-contact-event-rollups.ts](../scripts/backfill-contact-event-rollups.ts).
  "2+ service visits", "spent over $1,500", "bought but never serviced" are now one
  condition each.

  **Recomputed, never incremented.** Event ingest is an upsert keyed on the source
  system's RO/deal id, so batches are legitimately re-delivered — anything additive would
  double-count on every replay, and a lifetime-spend figure that's 15% high is invisible.

  The rollups are **lifetime** aggregates by design. A rolling window ("visits in the last
  12 months") changes with the clock rather than with the data, so it can't be maintained
  on write and would sit silently stale between nightly recomputes. For an audience that
  feeds ad platforms, quietly-wrong is the worst property available. Windowed questions are
  expressed instead by combining a lifetime count with a recency date
  (`serviceVisitCount >= 2 AND lastServiceEventAt within the last 365 days`), which is
  exact at every moment. **The one thing this cannot express is a true windowed count** —
  "2+ visits *within* the last 12 months" — and that is a deliberate trade, not an
  oversight.
- ✅ **FIXED** — **No set operations.** Both now exist:
  - **List membership** (`listIds`), modelled as a multiselect over `ContactListMembership`
    with a checkbox picker in the builder, since the stored values are opaque ids.
  - **Segment composition** (`segmentRef`, `is in segment` / `is not in segment`), which is
    what makes a suppression audience expressible: *"everyone in Lapsed Service who is NOT
    in Recently Purchased"*, without restating the second segment's conditions inline and
    keeping two copies in sync by hand.

  Composition loads the referenced **definition**, not its member list. So the SQL
  translator inlines the referenced `WHERE` as a subexpression and the JS engine recurses
  into it against the same contact — no nested scan, no materialised id set, and a composed
  segment always means what the referenced segment means *right now*. Cycles are refused at
  load time with the offending path named, nesting is capped at 5, and a segment can't
  reference itself from the builder.

### 2.7 — Medium ✅ **FIXED**: no membership persistence, so no deltas

**Fix (shipped).** Three models —

- `AudienceSync` — one binding per (segment × sub-account × provider). Scoped per
  sub-account because a segment is a filter: an org-wide one resolves to different people
  in every rooftop, and the ad accounts are per-rooftop anyway
  (`Account.googleAdsCustomerId`). **This assumes the rooftop-first answer to the open
  question in §6** — org-level union audiences are additive later (the dedupe they need
  already exists as `resolveEligibleAcrossAccounts`), not a migration of this shape.
- `AudienceSyncMember` — the current membership as last pushed, which is the baseline each
  run diffs against. Only the current set is kept, not tombstones: platforms want deltas,
  and the history of what changed lives on the run rows.
- `AudienceSyncRun` — one row per attempt, including failures and skips, carrying segment
  size, eligible count, added/removed, the full exclusion breakdown, and (once a provider
  reports it) match rate.

Orchestration is [sync/run.ts](../src/lib/segments/sync/run.ts), scheduled on the
`loomi.audience-sync` pg-boss queue at 08:00 UTC — after the overnight CRM ingest, so an
audience reflects the day's changes rather than yesterday's.

Four behaviours worth calling out, each of which is a way this could have gone quietly
wrong:

- **A run row is always written**, including "nothing changed". Otherwise a sync that
  stopped running and a sync that ran and found nothing look identical from outside.
- **Membership is recorded only after a successful push.** Recording it first would leave
  the baseline believing contacts are live that never reached the platform, and the next
  run would compute its delta against a state that never existed — those people would
  never be resent.
- **An empty segment is refused, not obeyed.** Under the fail-closed engine a half-saved
  segment resolves to nobody; treating that as an instruction to clear the remote audience
  would be an expensive misreading.
- **A changed email is a remove plus an add.** The platform has no idea the two hashes are
  the same person.

Only a **dry-run destination** is wired. That's shadow mode, and it's useful on its own: it
proves the resolve → gate → dedupe → diff pipeline against real dealer data and produces
the real numbers, without a single contact leaving the building. The first real upload is a
change of adapter, not of pipeline.

### 2.7 (original finding)

`Audience` stores only the filter JSON. There's no snapshot of who was in it and when.
Consequences:

- Every count is a full recompute — and can't be trended.
- **Incremental sync is impossible.** Customer Match wants add/remove operations; without a
  previous membership snapshot there's nothing to diff against, so every sync would be a
  full re-upload (slow, quota-hungry, and it churns list membership dates).
- No audit trail of what was pushed to a third party — awkward for a data-deletion request.

`providerMetadata` exists on the model and is used for exactly one thing today: tagging
seeded lifecycle presets ([seed-lifecycle/route.ts:67](../src/app/api/audiences/seed-lifecycle/route.ts)). It's a JSON
string on a single row — not a workable place for per-provider sync state.

### 2.8 — Medium ✅ **FIXED**: no identity normalisation or hashing layer

**Fix (shipped).** [identity.ts](../src/lib/segments/identity.ts) — normalisation and
SHA-256 for email, phone, names, postal code and country, with 22 fixed-vector tests
([identity.test.ts](../src/lib/segments/identity.test.ts)) anchored on the published
`test@example.com` digest.

Fixed vectors rather than computed ones, because this is a silent-failure surface: a stray
uppercase letter or a missing country code doesn't error, it just fails to match, and the
platform reports a smaller audience with no explanation. Specific decisions worth knowing:

- **Gmail dots and +tags are NOT stripped.** Older guidance said to; current guidance
  doesn't, and over-normalising turns a matchable address into an unmatchable one.
- **Phones with no reliable country code are dropped, not guessed.** A 7-digit local
  number hashed without one matches nobody, so sending no identifier beats sending a wrong
  one.
- **Names are accent-folded** so "José" and "Jose" hash alike, and prefixes/suffixes
  (Dr., Jr., III) are removed.
- **Postal code and country travel unhashed** — that's what the platforms specify — but
  still need consistent normalisation or address matching drops.
- **An empty value never becomes a hash.** `sha256('')` is a real-looking identifier that
  matches a surprising number of other broken records.

Org-level dedupe is `identityDedupeKey` + `resolveEligibleAcrossAccounts`: one customer
across three Young rooftops is three `Contact` rows but uploads once, since inflating the
audience burns match quota and defeats frequency capping. Each account is still gated
independently, so one rooftop without a consent basis fails the whole union rather than
being silently skipped.

### 2.8 (original finding)

Google (and Meta) require SHA-256 of *normalised* values. We have most of the primitives —
`normaliseEmail`, `normalisePhone` (E.164) in [normalize.ts](../src/lib/contacts/normalize.ts), and validity
checks in [contact-hygiene.ts](../src/lib/contact-hygiene.ts) — but they're import-time only, applied
inconsistently (`/api/contacts` POST normalises; ingest paths vary), and there's no
name/zip/country normalisation, no hashing module, and no dedupe.

Cross-rooftop duplicates are guaranteed by design: uniqueness is `@@unique([accountKey, email])`
([schema.prisma:497](../prisma/schema.prisma)), so one person shopping at three Young stores is three
Contact rows. Any org-level audience push must dedupe on hashed identity, or match rate
and frequency capping both suffer.

### 2.9 — Low, but worth fixing while in here

- No server-side count endpoint for a `FilterDefinition` — every consumer re-implements
  "fetch contacts, evaluate, count".
- `resolveAudienceContactIds` is private to `loomi-flows.ts`; the right shape exists but
  can't be reused.
- Empty-`groups` segments are savable via API and mean "everyone".
- Filter JSON validation is `version === 1 && Array.isArray(groups)` — no field-exists
  check, no operator-valid-for-type check, no depth/condition-count limit.
- Org-wide segments deliberately drop custom fields from the catalogue
  ([segment-editor.tsx:117](../src/components/contacts/segment-editor.tsx)) — defensible, but a saved org-wide
  segment referencing a custom key then silently matches nothing.

---

## 3. What Google Customer Match actually requires

Nothing in the codebase does any of this today — [google-ads.ts](../src/lib/integrations/google-ads.ts) is a
**read-only** GAQL/`searchStream` reporting client. Confirmed by grep: no `userList`,
`offlineUserDataJob`, or any mutate call anywhere in `src/`. Same for Meta — no
`customaudiences` code exists.

The write path needs (verify exact shapes against the pinned API version — the client is on
`v24`, [google-ads.ts:44](../src/lib/integrations/google-ads.ts)):

1. **`UserListService`** — create a `crmBasedUserList` per (account × segment), with
   `uploadKeyType: CONTACT_INFO`, a membership lifespan (Google's max is 540 days), and a
   declared data source type. Store the returned resource name against our segment.
2. **`OfflineUserDataJobService`** — create a `CUSTOMER_MATCH_USER_LIST` job, `addOperations`
   in batches of hashed `UserIdentifier`s, then `runOfflineUserDataJob` (async — poll status).
3. **Hashed identifiers** — SHA-256 hex of: lowercased/trimmed email; E.164 phone;
   and for address matching, lowercased first/last name **plus** unhashed country code and
   postal code. Multiple identifiers per user materially raise match rate.
4. **Consent signals** — `Consent { adUserData, adPersonalization }` on the job.
5. **Policy floor** — a list needs roughly **1,000+ matched active members** before it will
   serve; below that it exists but targets nothing. The UI must say so *before* someone
   builds a 40-person segment and wonders why it does nothing.
6. **Auth** — the existing agency refresh token is `https://www.googleapis.com/auth/adwords`,
   which covers writes *if* the granting user has write access to the target customer under
   the MCC. Worth confirming before building. Developer-token access level also needs
   checking — Customer Match availability is gated on account policy/spend history, not just
   API access. `Account.googleAdsCustomerId` already exists
   ([schema.prisma:217](../prisma/schema.prisma)), so per-rooftop targeting is solved.

Meta later reuses ~90% of this: same normalise → hash → batch → job-status shape against
`/act_{id}/customaudiences`. StackAdapt likewise. The provider-specific part is small if the
core is built provider-agnostic.

---

## 4. Proposed architecture

Four layers. Each is independently shippable and useful on its own.

### Layer 1 — One resolver, server-side, SQL-first

Replace "fetch contacts then filter in JS" with a single
`resolveSegment(accountKey, definition, mode)` in `src/lib/segments/`:

- **Translate `FilterDefinition` → Prisma `where`.** Nearly every field is a real column
  and translates directly. `tags` → jsonb containment. Custom fields → jsonb path
  comparison (worth a GIN index on `customFields`).
- **Pre-compute the messaging fields** rather than translating them. Add a denormalised
  `ContactEngagement` row (or columns) — `lastEmailDeliveredAt`, `lastEmailOpenedAt`,
  `lastEmailClickedAt`, `lastSmsAt`, updated by the SendGrid/Twilio webhook handlers. This
  kills finding 2.2 permanently *and* makes engagement filters real date fields
  ("opened an email in the last 30 days") instead of lifetime booleans.
- **Same for `ContactEvent` rollups** — `serviceVisitCount12m`, `lastServiceAmount`,
  `lifetimeSpend`, refreshed on ingest. Unlocks §2.6's high-value automotive segments
  without a correlated subquery per condition.
- **Fail closed:** unknown field or operator/type mismatch → the condition returns *no
  rows* and the resolver reports a validation error the UI surfaces on the row.
- Three modes off one code path: `count` (SQL `COUNT`), `preview` (LIMIT 50), `members`
  (keyset scan, streaming). Delete the client-side path entirely; keep
  `smart-list-engine.ts` only for single-contact evaluation in flow condition nodes.

Endpoints: `POST /api/segments/preview` (definition → count + sample) and
`GET /api/audiences/:id/count`.

### Layer 2 — Eligibility + identity

- `dnd.email` / `dnd.sms` serialised onto the API Contact and exposed as filter fields.
- A **`syncEligible`** concept, computed not hand-maintained: has a usable identifier, not
  on `EmailSuppression`, not DND, not a role address, plus a per-account
  "consent basis" setting recorded once per sub-account (how the CRM data was collected).
  Every export path filters through it; it is not an optional checkbox in the UI.
- `src/lib/segments/identity.ts` — normalise → SHA-256 for email, phone, first/last name,
  zip, country. One module, unit-tested against the platforms' published test vectors,
  shared by every provider adapter.
- Org-level dedupe on hashed email/phone so one person across three rooftops uploads once.

### Layer 3 — Membership + sync state

```
AudienceMembership   (audienceId, contactId, addedAt, removedAt?)   -- snapshot for diffing
AudienceSync         (audienceId, provider, externalId, status, schedule, config, consent)
AudienceSyncRun      (syncId, startedAt, finishedAt, added, removed, matched, matchRate,
                      status, error)                                 -- observability + audit
```

A pg-boss job (`audience-sync`) recomputes membership, diffs against the last snapshot, and
pushes only the delta. **Register the queue with `createQueue()` in
[src/worker/index.ts](../src/worker/index.ts)** — a missing `createQueue` crash-loops the entire worker and
silently stops every scheduled job. That trap has bitten this codebase twice.

`AudienceSyncRun` is what makes this trustworthy rather than magic: last run, rows sent,
match rate, errors — visible in the UI. Match rate in particular is the number that tells a
dealer whether their CRM data is any good.

### Layer 4 — Provider adapters

```ts
interface AudienceDestination {
  key: 'google_ads' | 'meta' | 'stackadapt';
  ensureRemoteList(ctx): Promise<string>;      // create/find, return external id
  push(ctx, ops: {add: Hashed[]; remove: Hashed[]}): Promise<PushResult>;
  status(externalId): Promise<RemoteStatus>;   // size, match rate, serving state
}
```

Google first. The interface exists from day one so Meta/StackAdapt are a file each, not a
refactor.

---

## 5. Phasing

| Phase | Scope | Rough size |
|---|---|---|
| **0 — Correctness** ✅ **SHIPPED** | Fixed §2.4 fail-open, §2.5 permission hole, §2.2 engine divergence, dead `dateOfBirth`, `country`; added server-side filter validation | Small — do this first regardless of the Google decision |
| **1 — SQL resolver** ✅ **SHIPPED** | Translator + resolver + preview/count endpoints + UI on real counts; send path server-resolved (§2.0); engagement rollup columns; `numeric_text` mileage & year. **Still open:** `ContactEvent` rollups (moved to Phase 2, where the event filters live) | Medium-large. **The load-bearing phase** |
| **2 — Richer vocabulary** ✅ **SHIPPED** | `ContactEvent` rollups + filters, list membership, segment composition / exclusions | Medium |
| **3 — Eligibility + identity** ✅ **SHIPPED** | Unconditional export gate, per-account consent basis, hashing module w/ fixed vectors, org-level dedupe, eligibility visible in the builder | Medium |
| **4 — Membership + sync state** ✅ **SHIPPED** (UI deferred) | Layer 3 — the three models, delta orchestration, pg-boss queue, sync + run APIs, dry-run destination. Sync history UI deferred until there's a real provider to show | Medium |
| **5 — Google Customer Match** ✅ **SHIPPED (unproven against the live API)** | [google-ads.ts](../src/lib/segments/sync/google-ads.ts) — user list creation, offline user data job, batched hashed upload, consent signals, match-rate attribution, sub-1,000 servability warning. **Not yet run against a real Google Ads account** — see §7 | Medium |
| **6 — Meta / StackAdapt** | Second + third adapter on the same core | Small each |

Phases 0–2 are worth doing even if platform sync never ships — they're the difference
between segment counts you can quote to a dealer and segment counts you can't.

Feature-flag the sync surface (`NEXT_PUBLIC_ENABLE_AUDIENCE_SYNC`) per the existing pattern
in [feature-flags.ts](../src/lib/feature-flags.ts), so phases 4–5 can land on staging without exposing a
half-built destination picker in production.

---

## 7. Before the first real Customer Match upload

The adapter is written against the documented v24 REST surface and its payload shapes are
unit-tested, but **no request in it has ever reached Google**. Everything below is
verification that can only happen against a live account, in this order:

1. **Run the preflight** —
   [scripts/check-google-customer-match-access.ts](../scripts/check-google-customer-match-access.ts).
   Every mutate it issues sets `validateOnly: true`, so Google validates and returns the
   errors it *would* have raised without creating anything. It separates the three
   questions that get collapsed into one: does auth work, may this user mutate user lists
   on this customer, and is Customer Match policy-eligible on that account.
2. **Check the developer token's access level**, which the preflight prints. Basic access
   permits production mutates under a daily operations cap — fine for a nightly sync of a
   few rooftops, a real constraint across ~38.
3. **First run on one rooftop, `schedule: 'manual'`**, and read the `AudienceSyncRun` row
   before scheduling anything. The interesting numbers are `eligible` vs `segmentSize` and
   the four `excluded*` counts — if most of a segment is excluded, that's a CRM data
   problem worth knowing about before it's a campaign problem.
4. **Come back a day later for the match rate.** Matching is asynchronous, so
   `matched` / `matchRate` are filled in by the *following* run
   (`refreshAudienceSyncStatus`). A list under ~1,000 matched members exists but won't
   serve, and that's reported rather than left to be discovered mid-campaign.

The failure mode to watch for is the quiet one: a wrong field name in the identifier
payload doesn't error — Google accepts the upload and matches nobody. That's what the
match rate is for, and why step 4 isn't optional.

## 6. Open decisions

1. **Scope of a synced audience** — per-rooftop (one Google user list per sub-account, using
   `Account.googleAdsCustomerId`) or org-level with dedupe? Rooftop is simpler and matches
   how the ad accounts are structured; org-level is better for frequency capping across
   Young stores. Recommend rooftop-first, org-level as a later opt-in.
2. **Consent basis** — is a per-sub-account attestation ("this CRM data was collected with
   disclosure permitting third-party ad use") sufficient, or is per-contact consent tracking
   needed? Rooftop-level is the norm for dealer CRM data; per-contact is defensible but
   needs the CRM feeds to carry a consent column, which today they don't.
3. **Sync cadence** — nightly is almost certainly right (Customer Match processing isn't
   real-time anyway). Confirm before building a manual-trigger-only v1.
4. **Google Ads write access** — needs verifying before phase 5 starts: does the existing
   agency refresh token's user have write access under the MCC, and is Customer Match
   enabled on the target customers?
5. **Historical engagement backfill** — the `ContactEngagement` rollup can be backfilled
   from existing `EmailEvent`/`SmsEvent` rows. Worth doing so day-one engagement segments
   aren't empty.
