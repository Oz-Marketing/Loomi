# Oz Dealer Tools → Loomi Reporting migration plan

Inventory of every analytics surface in Oz Dealer Tools (ODT), what has already
landed in Loomi Reporting, and where the rest should go.

Sources: `oz-dealer-tools` (CodeIgniter 4 / MySQL), `oz-reports` (CodeIgniter 4 /
MySQL — the dealer-data host) and `Loomi/Code/loomi-app` (Next.js / Postgres /
Prisma).

> **Revised 2026-08-14.** The earlier revision of this document treated
> dealer-data access as the migration's blocking problem and recommended
> building a read-only MySQL connection from Loomi. That is now wrong: a
> push bridge from Oz Reports into Loomi Postgres was built for the contact
> sync and the budget import, it runs on cron, and it already carries most of
> the data the "blocked" reports need. See §3.

---

## 1. Where we stand

ODT has **22 reporting surfaces** (20 client-facing + 2 internal). Loomi
Reporting now has **20 ported** — but see §1.1: three of those twenty have
never had server credentials and do not run anywhere. The twenty are the
Digital Ads group, Website Analytics,
Reputation (live + history), Business Profile, Call Tracking, Lead Performance,
Sales Trend, Service Trend, Service Retention, Customer Heatmap, Direct Mail
ROI, Budget, the Ad Meeting deliverable, the Marketing Overview, the Executive
Dashboard, Marketing Lists, and Billboards.

**Phases 1–4 are complete**, and of the three surfaces deferred pending the "is
ODT being retired" question, two have since shipped. **One surface is left:
API Usage**, which is a rebuild rather than a port — it reads ODT's own request
log, and that log stops existing with ODT. See "What replacing ODT still
requires".

Everything already ported shares one architectural trait worth preserving:
**live pull, no metrics DB.** Every `/api/reporting/*` route resolves the
account → its platform config → hits the vendor API on each request. There is
no warehouse in the middle.

The dealer-data reports will *not* share it. Their data arrives by push into
Postgres (§3), so they read local tables. That split is deliberate and worth
stating in code comments as each one lands, so nobody "fixes" a Prisma query
into a vendor call later.

| ODT report | Loomi route | Status |
|---|---|---|
| Google Ads | `/reporting/ads/google` | ✅ ported (incl. ad-group drilldown) |
| Facebook Ads | `/reporting/ads/meta` | ✅ ported |
| OTT / CTV (StackAdapt) | `/reporting/ads/stackadapt` | ✅ ported |
| Email Campaigns (GHL) | `/reporting/ads/blasts` | ✅ ported — now **Email & Text Blasts**, merged with Loomi sends (see below) |
| Website Analytics (GA4) | `/reporting/websites` | ⚠️ code ported, **not live** — no credential in any environment (§1.1) |
| Reputation Report | `/reporting/reputation` | ⚠️ code ported, **not live** — no credential in any environment (§1.1) |

Loomi additionally has three things ODT does not: **PDF + XLSX export**
(`/api/reporting/export/*`, platform-agnostic), a **cross-account roll-up**
(`org-report-rollup.tsx` + `rollup-configs.ts`) that is effectively a partial
Executive Dashboard, and **Engagement / Contacts** reporting that is Loomi-native.

One surface is built but sits outside Reporting: the **budget module**
(`/app/projects/budget`, see `docs/budget-module.md`), which covers what ODT's
Budget Report covers and more. Bringing it into Reporting is a new read-only
view over data Loomi already holds, not a port.

---

### 1.1 Three ported reports have never run — no credentials, anywhere

Verified 2026-08-16 by reading the **running process environment** on the
production droplet (`/proc/<pid>/environ`, which is authoritative over any
`.env` file), and the env file on staging. Local dev matches.

| Report | Credential it needs | dev | staging | prod |
|---|---|:--:|:--:|:--:|
| Website Analytics | `GA4_SERVICE_ACCOUNT_JSON` | ✗ | ✗ | ✗ |
| Reputation (live) | `GOOGLE_MAPS_API_KEY` / `GOOGLE_PLACES_API_KEY` | ✗ | ✗ | ✗ |
| Business Profile | `GBP_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | ✗ | ✗ | ✗ |

For contrast, every integration Oz **already had a credential for** is live in
production: `META_SYSTEM_USER_TOKEN`, the three `GOOGLE_ADS_*` variables, and
`STACKADAPT_API_KEY`. So this is not a broken deploy or a missing env file — it
is one setup step that was never finished, for exactly the three integrations
that required a NEW credential to be provisioned in Google Cloud.

**What a user sees.** `getGa4Config()`, `getPlacesApiKey()` and `getGbpConfig()
each return null, so the route answers 503 `not_configured`. The reports render
"not configured on the server yet" to everyone, and have since they shipped.

**`GOOGLE_CLIENT_ID` is set in production and is NOT relevant here.** It is read
only by `src/lib/auth.ts` — it is the Google SSO login. There is no fallback
from `GBP_CLIENT_ID` to it, and adding one would be wrong: SSO and the Business
Profile API need different OAuth clients and scopes.

**Mapping IDs is downstream of this.** `Account.ga4PropertyId` and
`Account.googlePlaceId` say *which* property or listing to read; the credential
is what permits reading it. Populating the columns while the credentials are
absent changes nothing — both reports still 503. Provision first, then map.

Order of work:

1. **GA4** — create a service account, grant it Viewer on each dealer property,
   set `GA4_SERVICE_ACCOUNT_JSON`. The grant list then *is* the property
   inventory: `listGa4Properties()` reads it back, so nobody copies 38 ids by
   hand. Then `scripts/map-reporting-integrations.ts` proposes the mapping.
2. **Places** — create a Maps/Places API key, set `GOOGLE_MAPS_API_KEY`. The
   same script proposes a listing per rooftop from name + address. Review every
   one: a wrong `googlePlaceId` is read in reverse by the review ingest and
   files one rooftop's reviews under its neighbour.
3. **Business Profile** — the two steps already documented below ("Business
   Profile is the only per-account credential"). No mapping needed; each
   rooftop connects itself through the Integrations page.

`checkReportingCredentials()` (src/lib/integrations/credential-check.ts) logs
this table at boot, so the next environment missing one says so on startup
rather than when a client opens an empty report.


## 2. Full ODT inventory

Grouped as the ODT sidebar presents them (`app/Views/default.php:749-880`).

### Executive Dashboard
Cross-org roll-up. Shown only to super admins and org owners/admins who belong
to more than one org. Routes: `reports/executive-dashboard`, `ajax-load`,
`ajax-load-retention-org`.

### Big Picture

| Report | Route | Data source | What it shows |
|---|---|---|---|
| **Marketing Overview** | `reports/marketing-dashboard` | 17 AJAX endpoints fanning out to *every* other source | ✅ **shipped** as the single-account Reporting home — see "The dashboard is two dashboards" |
| **Budget Report** | `reports/budget` | `budgets` MySQL DB (`account_budgets`) | Planned vs. billed spend by category, channel, month; incoming (agency-billed) vs. account budgets; grand totals. |
| **Ad Meeting Report** | `reports/ad-meeting` | Same fan-out as Marketing Overview + `POST ad-meeting/analyze` | Staff/super-admin only. A client-meeting deliverable across all channels with an **AI-generated written analysis** on top. |

### Digital Ads
All four ported. ✅

### Onsite / Experience

| Report | Route | Data source | What it shows |
|---|---|---|---|
| Website Analytics | `reports/website-analytics` | GA4 Data API | ⚠️ code ported, **not live** (§1.1) |
| **Business Profile** | `reports/gbp` | Google Business Profile API, **per-org OAuth** (`gbp_refresh_token`) | ⚠️ code ported, **not live** — OAuth client never created (§1.1) |
| Reputation | `reports/reputation` | Google Places (live) + `ozrep` MySQL DB (history) | ⚠️ code ported, **not live** (§1.1) |
| **Call Tracking** | `reports/call-tracking` | `ozreports` DB via `OzReportsData::getCalls()` | ✅ **shipped** — required extending the bridge (`pushcalls`) |

### Sales & Service

| Report | Route | Data source | What it shows |
|---|---|---|---|
| **Lead Performance** | `reports/lead-performance` | `ozreports` DB | ✅ **shipped** — comparisons exact, not prorated; count differs from ODT's |
| **Customer Heatmap** | `reports/heatmap` | `ozreports` DB | ✅ **shipped** — bundled ZIP centroids, self-rendered map |
| **Sales Trend** | `reports/sales-trend` | `ozreports` DB | ✅ **shipped** — transaction revenue, not gross (see the gross gap) |
| **Service Trend** | `reports/service-trend` | `ozreports` DB | ✅ **shipped** |
| **Service Retention** | `reports/service-retention` | `ozreports` DB | ✅ **shipped** — fixes ODT's repeat-buyer bug; will not tie out |
| **Service Mailer ROI** | `reports/service-mailer` | `purls` DB + `ozreports` DB | ✅ **shipped** as Direct Mail ROI — matchback runs bridge-side; BDC CSV not ported (see Marketing Lists) |
| **Service Mailer Summary** | `reports/service-mailer-summary` | `purls` + `ozreports` | ✅ **folded into** Direct Mail ROI as its totals row — one page, not two |
| **Billboard Map** | `reports/billboards` | ODT's own app DB (`BillboardModel`) | ✅ **shipped** as Billboards — one-time import, not a bridge feed; expiry derived at read time |

### Tools

| Surface | Route | Data source | Notes |
|---|---|---|---|
| **Marketing Lists** | `reports/marketing-lists` | `ozreports` DB | ✅ **shipped** at `/reporting/lists` — real editable segments, not fixed buckets. BDC export still open. |

### Internal / diagnostic
`reports/api-usage` (super admin, ODT app DB), `reports/gbp-debug`,
`reports/stackadapt-debug`, `reports/email-debug`, `inventory-incentives`.
Not migration candidates as-is.

---

## 3. Dealer data: the bridge already exists

Loomi does not connect to any of ODT's MySQL databases and **does not need to.**
Oz Reports pushes into Loomi Postgres on cron. The push side lives on the Oz
Reports host (`oz-reports/app/Controllers/Loomi.php`) because that is where the
dealer data and the dealer→account mapping (`dealer_map.loomi_account_key`) both
live; Loomi only validates and upserts.

| Push route | Loomi endpoint | Lands in |
|---|---|---|
| `pushcustomers`, `pushcustomersps` | `/api/ingest/contacts` | `Contact` |
| `pushleads` | `/api/ingest/contacts` | `Contact` (tagged `lead`) |
| `pushevents`, `pusheventsps` | `/api/ingest/events` | `ContactEvent` |
| `pushbudgets` | `/api/ingest/budget-lines` | `BudgetLine` |

Cadence, per `docs/oz-reports-contact-sync.md`: leads hourly, sales/service
nightly, and a **Sunday `?all=1` sweep over full history**, one dealer per
request, across all 38 mapped rooftops. Every ingest is idempotent.

Two consequences the earlier plan missed:

**Powersports normalization is partial.** `pushcustomersps` and `pusheventsps`
map the PS tables onto the same *columns* as the automotive ones — so the
`PS_SALES` / `STD_SALES` table-and-column branching in `OzReportsData` does not
need porting. But the `details` JSON keys still differ, and anything reading
them has to handle both shapes:

| | automotive | powersports |
|---|---|---|
| sale | `deal_type` (NEW/USED), `sale_type` (LEASE), `apr` | `new_used` (N/U), `unit_type`, `rate` |
| service | `customer_pay`, `warranty_pay`, `internal_pay`, `hours` | `category`, `stock_number` — **no pay split** |

`src/lib/reporting/dealer-trends.ts` handles both; reuse its helpers rather
than re-deriving the mapping.

**The event payload already carries the report dimensions.** From
`Loomi.php:756`, each `ContactEvent` ships:

- service → `amount` (RO total) plus `details.customer_pay`,
  `details.warranty_pay`, `details.internal_pay`, `details.hours`
- sale → `amount` (out-the-door) plus `details.sale_type`, `details.deal_type`,
  `details.apr`, `details.term`
- both → `eventDate`, vehicle year/make/model/VIN/mileage, `sourceCrm`,
  `reference`, and a nullable `contactId` linking to the `Contact`

With `Contact.postalCode` populated by the same bridge, that is everything four
of the "blocked" reports need:

| Report | Reads | Notes |
|---|---|---|
| **Sales Trend** | `ContactEvent` where `type='sale'` | ✅ **shipped** — units, mix, revenue, APR |
| **Service Trend** | `ContactEvent` where `type='service'` | ✅ **shipped** — RO count, pay-type split (automotive) |
| **Service Retention** | `ContactEvent` grouped by `contactId` | ✅ **shipped** — both cohort metrics; see the two caveats below |
| **Customer Heatmap** | `ContactEvent` → `Contact.postalCode` | ✅ **shipped** — bubble map, ranked ZIPs/cities, placement accounting |

### The gross gap

**ODT's Sales Trend reports dealer gross; Loomi cannot.** `getSalesTrend` is
built on `totalgross` / `frontgross` / `backgross` — gross *profit*. The bridge
sends neither: `pushevents` ships `outthedoor` (automotive) and `unitsoldprice`
(powersports) as `amount`, which is what the **customer paid**. The shipped
report therefore charts transaction revenue and labels it as such.

Closing this is a bridge change — add the gross columns to the `pushevents`
payload in `oz-reports/app/Controllers/Loomi.php` and widen `ContactEvent` (or
put them in `details`). Until then, do not relabel `revenue` as "gross".

The same caveat applies to anything downstream that wants gross: Marketing
Overview's ROI card and the Executive Dashboard both use it in ODT.

### Marketing Lists ARE Studio's segments

The open question was whether Marketing Lists should be a Reporting page or
fold into Studio's audience tooling. It was a false choice: they are the same
`Audience` records, read through the same `/api/audiences`, sized with the same
`evaluateFilter` against the same field set, and edited with the same
`FilterBuilder`. A list created in Reporting appears in Studio and vice versa
**immediately, because there is nothing to synchronise** — there is one record.

Building a Reporting-specific list model would have been faster and wrong: two
definitions of "customers due for service" drift within a month, and the first
symptom is a mail file that doesn't match the count the rep quoted.

**ODT's fixed buckets became editable presets.** Early Reminder, Routine
Reminder, FLF and the Lost Souls tiers were hardcoded SQL in
`getMarketingListSizes`. Loomi seeds them as real segments
(`LIFECYCLE_PRESETS` via `/api/audiences/seed-lifecycle`, idempotent), so a
store can adjust a window instead of filing a ticket.

**This is the first writable surface in Reporting**, and clients can use it.
`POST /api/audiences` already scope-checks — a non-developer may only write to
an account they're assigned — so a client can create a list for their own store
and cannot touch anyone else's. One deliberate limit: **account-less lists are
read-only here.** Those are shared across the book, and a client editing one
would silently change every other dealer's list; they render with a "Shared"
badge and a disabled edit button.

**Sizes are computed in the browser, and that is deliberate.**
`evaluateFilter` is an in-memory engine with no SQL translation. Sizing
server-side would mean writing that translation — a second implementation of
every operator, whose first bug would be a size here disagreeing with the same
segment in Studio. So the page fetches the account's contacts once and
evaluates every list against that array, exactly as Studio's segments page
already does. It is the same load pattern, not a new one, but it is why the
page asks for a single sub-account rather than a group.

### What replacing ODT still requires

**Decided 2026-08-14: Loomi is replacing Oz Dealer Tools.** That turns three
"optional" surfaces into required work, and adds a cutover concern none of the
reports raised.

| Surface | Why it isn't just another port |
|---|---|
| **Marketing Lists** | Needs the BDC call-list export, which needs caller names and phone numbers. The bridge deliberately doesn't carry those (see the Call Tracking note). Moving it means deciding to move contact data, with a retention question attached. |
| ~~**Billboard Map**~~ | ✅ **Shipped 2026-08-14.** Resolved as a one-time migration into native Loomi tables rather than a bridge feed, and the "cross-org sharing model Loomi has no concept of" turned out to be the account hierarchy Loomi already has. See "Billboards move, they don't sync". |
| **API Usage** | Internal diagnostics over ODT's own request log. Once ODT is gone the log stops existing, so this is a rebuild against Loomi's own telemetry, not a port. |

**Three things beyond the surfaces:**

1. **The bridge outlives "transitional".** Both ingest routes are commented as
   throwaway, to be deleted when Oz Reports is decommissioned. Ten reports now
   depend on them permanently. If Oz Reports is going away too, the
   sales/service/lead/call/review/mailer feeds need a new home first — and the
   `modified_at` improvement in `oz-reports-contact-sync.md` becomes worth
   doing, because the Sunday sweep is currently the only thing that repairs an
   edited historical row.
2. **Nothing has run end-to-end.** Four bridge routes (`pushcalls`,
   `pushreviews`, `pushmailer`) and their ingests exist but have never
   executed. Every one supports `?dry_run=1`; that is the cutover checklist's
   first line.
3. **Reports that will not tie out.** Service Retention (repeat-buyer fix),
   Lead Performance (BAD/DUPLICATE filter), Sales Trend (transaction revenue,
   not gross), and Customer Heatmap (current address, not address-at-sale) all
   deliberately differ from ODT's numbers. Each is documented above. Whoever
   runs the cutover should expect the comparison and have the reasons to hand,
   because "the new system's numbers are wrong" is the first thing anyone will
   say.

### The dashboard is two dashboards

`/reporting` now renders one of two things, chosen by scope:

- **one account selected** → **Marketing Overview**, the port of ODT's
  `reports/marketing-dashboard`: how is THIS store doing, every channel on one
  page.
- **no account, or a group** → the existing role-aware **portfolio dashboard**,
  with its widgets and saved layouts.

ODT only ever had the first, because an ODT user was always inside one org.
Loomi users switch accounts from the top bar, so "the dashboard" genuinely
means two different questions depending on where they are. The portfolio view
also has user-customisable layouts that a single-account composite has no
equivalent for — replacing it outright would have discarded that to answer a
question it was never asked.

**The overview adds no arithmetic of its own** beyond summing media spend
across channels. Every figure is fetched from the report route that owns it, so
a number here cannot disagree with the report it links to. Channels that
don't report are listed as labelled absences, never as zeros — a zero reads as
"we ran it and got nothing", which is a different and wrong claim.

**Shared with the Ad Meeting builder.** Both surfaces need "every report for
one account, side by side", and they were always going to drift if each kept
its own route list — one would gain a channel the other silently lacked, and
nobody would notice until a client asked why the deck and the dashboard
disagreed. `_components/account-sources.ts` is now the single list, imported by
both. Consolidating also fixed a latent bug in the Ad Meeting builder, which
looked for the Google rating at the top level of the reputation response rather
than under `place`.

### Direct Mail is the one report Loomi cannot compute

Every other dealer report ships raw rows and lets Loomi do the arithmetic. This
one cannot, for a structural reason rather than a convenient one: the matchback
joins mailed recipients to repair orders on **`custno`**, the DMS customer
number — and Loomi has no custno anywhere. `ContactEvent` keys on `contactId`,
resolved by email/phone at ingest; the mail file and the RO share only the
DMS's own identifier, which lives on the Oz Reports host.

Pushing raw recipients instead would move the name and address of everyone
mailed — tens of thousands per campaign — **and still not work**, because the
join key would be missing on arrival. So the match runs where both databases
and the key are (`Loomi::matchbackFor`), and only aggregates cross. No row
leaving that method describes an individual.

The consequence to be honest about: `MailerCampaign` cannot be recomputed from
Loomi's own data. If the matchback logic changes, the fix ships in PHP and the
campaigns are re-pushed.

**Re-push is not optional here.** The service window stays open 45 days past
the last in-home date, so a campaign's matched ROs keep growing for weeks after
the drop. The report flags campaigns still inside that window as "(open)" so a
rising number doesn't read as an error.

### The report is called ROI and ODT never computed one

ODT's Service Mailer ROI reports attributed revenue, matched ROs, and per-RO
averages. It has **no campaign cost anywhere**, so it cannot produce a return —
revenue alone is not ROI, and the name has probably flattered a few campaigns.

Loomi does hold the spend: direct mail is a budget channel, and `BudgetLine`
carries what the client was charged. So the report computes a real return when
mail spend is on the budget and shows **null** when it isn't, with a note
saying why, rather than falling back to revenue and relabelling it. A zero cost
is treated as uncosted rather than as infinite return.

Note the denominator is **client gross** — what the dealer was charged — not
Oz's cost. This report is client-facing, and it must not become the latter.

### Reputation is keyed by place id, not account key

Every other push route sends `loomi_account_key`, because `dealer_map` carries
it. The reputation database does not: ODT maps a rooftop to an org through its
**own** `organizations` table, which the Oz Reports host cannot see, and
`dealer_map` has no rooftop column.

Rather than add a column and have someone populate 38 rows by hand,
`pushreviews` sends the rooftop's Google **`place_id`** and Loomi resolves the
account — inverting `GOOGLE_PLACES_MAP`, the same config the live Reputation
report already reads. One source of truth instead of two that drift.

Inverting an account-first map can surface a config error the forward lookup
never would: two accounts pointing at one listing. The ingest **refuses** that
(409 `ambiguous_place`, naming both) rather than guessing, because guessing
would attribute a rooftop's reputation to its neighbour. An unknown place id
returns 404 `unmapped_place` — the signal to add it to the map. Only the
primary `placeId` matches; a `competitorPlaceId` is a listing we watch, not one
we own.

**Why re-push matters more here than anywhere else.** Unlike a sale, a review
CHANGES after publication — `reply_sent` flips when the store answers it. Reply
rate is the metric Places cannot provide at all, so re-pushing is not
housekeeping, it is how that number stays true. The route uses a 90-day default
window rather than 30 for that reason.

**Live and history answer different questions, and both stay.** Places gives
the current rating over every review the listing ever had; `ReviewEvent` gives
distribution, trend, and reply rate over a range, limited to what the sync has
recorded. Their averages will differ, and the report says so rather than
picking one. History cannot be backfilled — Places returns only a handful of
recent reviews, so a review not recorded today is gone tomorrow.

### Call Tracking deliberately leaves PII behind

The bridge's `pushcalls` route sends timestamp, status, duration, tracker name,
and caller city/state/ZIP. It does **not** send `caller_name`, `caller_number`,
or the call-recording URL, even though Oz Reports stores all three.

The report needs none of them — it reports volume, answer rate, and the
tracker/city/hour breakdowns — and copying a caller's phone number and a
recording of their conversation into a second system is not a decision a
reporting sync should make on its own. City/state/ZIP are sent because the
geographic breakdown needs them and they are already coarse.

`CallEvent` therefore has no contact link either: `ingest-events.ts` resolves a
contact by email/phone, and doing the same here would mean carrying the number
across after all. Calls are reported in aggregate; they are not part of a
person's timeline.

If the BDC call list from Marketing Lists ever moves across, it will need the
caller's number — that is a deliberate widening with its own retention
question, not something to slip in because the column exists upstream.

**Two smaller decisions worth knowing.** Statuses are lowercased at ingest: the
tracker has sent both `Answered` and `answered`, and a case-sensitive match
would split one status into two rows and halve the reported answer rate.
`status` is a plain string rather than an enum, so a new vendor outcome appears
in the report as itself instead of crashing the ingest or vanishing — "missed"
is defined as *not answered*, so a voicemail still lands in one half of the
split.

**Hour and weekday are computed in the dealership's local time**, not UTC — "we
miss calls at 8am" is a claim about their morning. Until `Account` carries a
timezone this is hardcoded to `America/Denver` (where the group is) in both the
page and the API default. That assumption breaks silently the moment a rooftop
opens outside Mountain time; an `Account.timezone` column is the fix.

### Loomi's lead count is not ODT's lead count

The bridge drops the CRM's own junk before pushing
(`oz-reports/app/Controllers/Loomi.php`):

```php
$q->whereNotIn('lead_status', ['BAD', 'DUPLICATE']);
```

That filter is right — someone in the store already dismissed those, and
re-importing routes junk to a salesperson. But it means **bad and duplicate
leads never reach Loomi**, so:

- Loomi's "Leads" ≈ ODT's `good_leads`, **not** ODT's `total_leads`.
- A good/bad split is not unimplemented, it is **unobtainable** — the bad ones
  don't exist on this side.

The gap is not small. The bridge's own comment records 20 of 68 leads (~29%) at
Young Nissan Riverdale. Expect a persistently lower number than ODT's, and read
the difference as the filter working rather than as data loss. The report says
so on the page.

**Conversion is computed, not imported.** ODT's `sold_from_leads` and
`total_gross` came from the DMS's attribution and aren't pushed. Loomi derives
conversion itself — a lead `Contact` with a later `sale` `ContactEvent` — which
is a different measurement, and inherits the contact-linkage caveat from the
retention section. It is a floor: a sale that couldn't be matched back to its
lead isn't counted. Gross is unavailable (see the gross gap above).

### Comparisons are exact, not prorated — an improvement over ODT

ODT compared a partial month by prorating the comparison month **linearly**:
`total × (throughDay / daysInMonth)` (`getLeadsSummaryProrated`). It had no
choice — monthly aggregates were all it had. That assumes leads arrive evenly
through a month, which weekends, month-end pushes and campaign flights all
break.

Loomi has a timestamp on every lead, so it counts the prior period **through the
same day of month, exactly**. No estimate. `proratePartial` is kept in the lib
and unit-tested purely so ODT's number can be reproduced when reconciling — the
report does not use it.

One edge the exact method introduces and proration hid: comparing 31 March
against February, there is no 31st. `clampDay` cuts the prior period at the
28th (or 29th) and the UI says where the cut landed, rather than silently
comparing 31 days against 28.

### The Ad Meeting document assembles client-side

The fan-out runs in the **browser**, not on the server. `ReportDoc` is designed
to be built from data the client already fetched, and both exporters already
work that way — so the meeting document calls the same report routes the
on-screen pages call, with the same auth, margin handling, and comparison
logic. A server-side assembler would be a second implementation of all of it,
and its first bug would be a number in a client deck disagreeing with the
report the client is looking at.

Consequences:

- **Partial assembly is the normal case.** No account has every channel. A
  source that is unconfigured or failing becomes a row in the document's own
  "Not included" section, carrying the route's own error message — never
  silently dropped. A deck that omits the channel nobody set up is how a rep
  gets blindsided in the room.
- **Staff-only, and absent from the sidebar on purpose.** The page and the
  analysis route both gate on `MANAGEMENT_ROLES`: it is drafted and reviewed
  before a client sees it, and each analysis costs Opus tokens.
- **Still client-safe.** Staff authorship is not permission to include margin —
  the document carries the same figures as the rest of Reporting, and the
  budget section comes from the client-safe projection.
- **`ReportDoc` has no prose field**, so the analysis rides as a single-column
  "Analysis" section — one row per paragraph. That renders as stacked
  paragraphs in the PDF and one column in the workbook, with no change to the
  shared type or the PDF template.

**Model choice.** The analysis runs on **Opus** (`claude-opus-5`), not the
app-wide `ANTHROPIC_MODEL` (Sonnet): it is read aloud to a paying client and is
the one part of the deliverable nobody proofreads against a source. It is
generated a handful of times a month, so the token difference is small.

The installed SDK (0.78.0) predates that model, but `Model` ends in
`(string & {})` so the ID passes through — the same reason
`ANTHROPIC_FLOW_MODEL` already works. What the old SDK lacks is typed
`stop_details` and the server-side `fallbacks` parameter, so a refusal is
handled by hand (`stop_reason === 'refusal'`, checked *before* reading content)
rather than retried on a fallback model by the API. **Bumping the SDK is what
unlocks server-side fallbacks** — worth doing before this sees heavy use.

### Business Profile is the only per-account credential

Google Ads and GA4 authenticate as the **agency**: one refresh token, one
service account, used for every dealer. Their reports either work everywhere or
nowhere. Business Profile can't work that way — a location's insights are
readable only by a Google identity that *manages that listing*, which is the
dealership's, not ours. So every account carries its own grant in
`GbpConnection`, and the report has a setup state no other report has.

Consequences to design around, all handled:

- **The token belongs to a person.** If they leave the dealership or revoke
  access, the connection dies. `invalid_grant` is surfaced as `auth_expired`
  with a reconnect prompt, not as a generic API error.
- **Connecting is staff-only, reading is not.** The report route runs behind
  `requireReportingAccess` (admits `client`); connect / pick-location /
  disconnect run behind `MANAGEMENT_ROLES`. A client hitting an unconfigured
  account is told to ask their account manager, not shown a button they can't
  use.
- **The refresh token never leaves the server.** Encrypted with the same
  AES-256-GCM helper as `CrmDestination.accessToken`; `getConnectionStatus`
  returns a DTO with no token field, and that is the only shape any route
  serializes.
- **`business.manage` is read/write and there is no read-only variant.** Loomi
  issues GETs exclusively — the single `apiGet` in `gbp.ts` is the only request
  helper. The scope makes writes possible; the code is what prevents them.

**Fixed a CSRF hole rather than porting it.** ODT puts the bare org id in the
OAuth `state` and trusts it in the callback
(`GBPReport::oauthCallback`), so a crafted callback link could bind a Google
grant to any org. Loomi signs `state` (HMAC, 10-minute expiry, nonce) and
additionally requires the user completing the flow to be the one who started
it. `gbp.test.ts` covers forged, payload-swapped, and expired states.

**Two config steps before it can connect:**

1. Set `GBP_CLIENT_ID`, `GBP_CLIENT_SECRET`, `GBP_REDIRECT_URI`. The first two
   can be copied from ODT's `.env` — the Business Profile APIs need Google to
   approve project access via a request form, and ODT's project
   (`976098770938`) already has it, so reusing that OAuth client avoids a fresh
   application.
2. Add Loomi's callback to that client's authorised redirect URIs in the Google
   Cloud console: `https://<reporting host>/api/reporting/gbp/callback`.

Until both are done the report returns `not_configured` and says so.

### Budget in Reporting shows no margin

**Reporting and the budget hub have different audiences, and the difference is
commercially sensitive.** `/app/projects/budget` is gated to `MANAGEMENT_ROLES`
and shows Oz's own numbers. `requireReportingAccess` admits the **`client`**
role — these pages are what dealers see.

So `/api/reporting/budget` does not return `getAccountSummary`'s payload. It
returns a deliberate re-projection (`src/lib/reporting/budget-view.ts`) that
drops `cost`, `revenue`, `byLineType`, `knownRevenue`, `uncostedAmount`, the
agreements' `defaultMarkup` and per-fee breakdown, and **`spendTarget`**.

`spendTarget` is the one that looks harmless. It is `amount × markupSnapshot` —
what actually reaches the platform. Publish it beside `amount`, what the client
pays, and anyone can divide one by the other and read Oz's markup off the page.
It is margin in a thin disguise.

Measured against the real ledger, the hub's summary carries **25–32 margin
fields** per account that the reporting view does not. `budget-view.test.ts`
asserts the omission by walking the whole object graph — by key name *and* by
value, so a margin figure mapped onto an innocuous key still fails the test.
**Add a field to `BudgetSummary` and it does not appear in Reporting until
someone decides it is the client's to see.**

Both surfaces call `getAccountSummary`, so they cannot disagree about the
client's actual budget.

### "Settled" and "spent" are not the same thing

A `BudgetLine` can be `status: 'settled'` with `settledAt` set and
`actualAmount` **null** — closed out with no figure ever recorded. This is not
hypothetical; it is the state of every settled line in the local ledger.

Reporting that as `$0` turns a missing number into a catastrophic underspend: a
month with $21k planned renders as a $21k negative variance, as though the money
was never used. The view therefore reports actuals as **null, not zero**, when
nothing has been recorded, and the UI prints "—" and "Closed, no spend recorded"
rather than a variance. A genuine recorded zero is still shown as zero — "we
spent nothing" is a real answer.

### Retention depends on contact linkage

ODT keyed retention on `custno`, the DMS customer number, which is present on
every row by construction. Loomi has no equivalent — the identity is
`ContactEvent.contactId`, resolved at ingest by (accountKey, email) then
(accountKey, phone). An event with neither, or one that landed before its
`Contact` existed, carries a **null `contactId`** and cannot participate: with
no identity there is no way to know a sale and a service visit are the same
person.

Excluded events bias every retention rate **downward**, so the report shows a
linkage-coverage banner whenever any are unlinked. Do not remove it, and do not
add a retention-style metric elsewhere without the same disclosure.

Coverage self-heals: `ingestEvents` re-resolves `contactId` on the update path,
so the Sunday `?all=1` sweep links events whose contact arrived later. If
coverage is persistently poor for an account, that is a data problem at the
source (ROs with no contact details), not a reporting bug.

### Why the heatmap draws its own map

ODT drew a Google Maps `HeatmapLayer` and geocoded every ZIP **client-side on
each page load**, with the API key hardcoded in
`app/Views/admin/reports/heatmap.php:369` — re-geocoding the same ZIPs on every
render, with a public key.

Loomi bundles a **US Census ZCTA Gazetteer centroid table** (33,791 ZIPs, public
domain, `src/lib/reporting/zip-centroids.json`, regenerate with
`npx tsx scripts/build-zip-centroids.ts`) and renders bubbles as inline SVG.
The table is **server-side only** — the API joins against it and returns
coordinates for the few dozen ZIPs an account actually has, so the browser
receives kilobytes.

Google Maps was the alternative, and the deciding argument against it was the
**PDF exporter**: `src/lib/reporting/pdf.ts` drives headless Chromium on the
droplet. A tile-based map there needs outbound network from the server, a key
restricted by server IP rather than referrer, and a race against async tile
loads on every capture — and the Ad Meeting deliverable is exactly a PDF of
every report. Inline SVG is in the DOM synchronously. No key, no per-load
billing, and dealer customer distributions never leave our infrastructure.
Leaflet + OSM was rejected for the same server-side reason plus third-party
tile requests from client browsers. Bulk-geocoding via Nominatim is forbidden by
the OSM usage policy.

The trade-off is no street context behind the bubbles. City labels on the
busiest ZIPs and a scale bar do the orienting.

**Geometry lives in `src/lib/reporting/map-projection.ts`, not the component**,
because two bugs there are invisible in code review and obvious on screen —
both were caught by rendering the component to static HTML and looking at it:

- One ZIP 400km out set the scale for the whole map and collapsed a 19-ZIP
  trade area into a 60px blob. `selectMapCore` trims stragglers beyond 4× the
  volume-weighted median distance, refuses to trim if that would drop half the
  business, and reports what it left off.
- Labelling the top N unconditionally piled "Layton / Kaysville / Farmington"
  on top of each other. `pickLabels` does greedy collision avoidance and names
  each city once even when it spans several ZIPs.

A third fix, `fitHeight`, adapts the frame to the data's aspect — a north–south
corridor in a fixed wide frame leaves most of the width empty, and the
projection must not stretch geography to compensate.

### Two more heatmap caveats

**The address is the customer's current one, not their address at the time of
sale.** ODT read zip/city/state off the DMS transaction row. Loomi has no
address on `ContactEvent` — it lives on `Contact` and is overwritten by each
contact sync, so a customer who moves takes their entire history to the new ZIP.
Usually the more useful reading for a trade-area map, but not the same question,
and it will not tie out with ODT for a dealer with ZIP churn.

**Placement coverage is a second linkage tax.** An event reaches the map only if
it is linked to a Contact *and* that Contact has a postal code — two independent
ways to fall out, reported separately as `unlinked` and `noPostal`. Every share
on the page is out of what could be placed, and the UI says so.

### Retention will not tie out with ODT

ODT's Metric A documents "retained = at least one service visit after their
purchase date", but its SQL joins each customer's **global** first service visit
and requires *that* to fall within the window. For a repeat buyer whose
first-ever service predates a later purchase, the difference is negative, so
they drop out of `retained_12m`, `retained_24m` **and** `retained_ever` despite
plainly servicing after that purchase.

Loomi implements the documented definition — first service visit *after that
sale* — so its rates read **higher** than ODT's for any dealer with repeat
business. Verified against the database with a synthetic repeat buyer: ODT's
shape reports 0, Loomi's reports the buyer as retained. Expect questions when
the two are compared side by side; this is the reason.

**Caveat — freshness vs. completeness.** The incremental windows filter on
*event date* (`closedate`, `contractdate`), not a modified-at column, so an
edit to an old record only lands on the Sunday sweep. Aggregate trends are
correct; do not build anything that assumes same-day accuracy for historical
rows. `ContactEvent.contactId` is also nullable — events land even when no
contact matches, which is right for trend counts but means retention cohorts
must exclude nulls rather than assume them.

### What is still genuinely blocked

Four sources never got a push route:

| Source | Feeds | What's needed |
|---|---|---|
| ~~`ozreports` calls tables~~ | ~~Call Tracking~~ | ✅ **done** — `pushcalls` + `CallEvent` shipped |
| ~~`ozreputation_ozrepdata` (`ozrep`)~~ | ~~Review history, reply rates~~ | ✅ **done** — `pushreviews` + `ReviewEvent` shipped |
| ~~`purls`~~ | ~~Service Mailer ROI + Summary~~ | ✅ **done** — matchback runs bridge-side, results pushed |
| `ozdealertools_odtdata7622` | ~~Billboards~~, API usage | Billboards ✅ **moved** — one-time import (`scripts/import-odt-billboards.ts`), not a bridge feed, because ODT is going away. API usage still needs a home. |

Each follows a pattern that already works twice over. Prefer extending the
bridge to introducing a second access mechanism.

**Lead Performance sits between the two.** Leads arrive as `Contact` rows
tagged `lead`, carrying `source`, `dateAdded`, and `customFields.lead_category`
/ `lead_status`. That supports counts by type over time, but ODT's version also
does month-over-month, YTD, and same-day-prorated comparisons
(`OzReportsData::getLeadsSummaryProrated`, `getLeadsYTDProrated`) — that math
has to be rewritten against Postgres regardless. Treat it as a port of the
*calculations*, not of the data access.

---

## 4. Proposed Loomi Reporting IA

Current nav (`reporting-sidebar.tsx:60`) is a flat list of leaves plus one
collapsible group. Everything below fits that existing pattern — new groups are
`NavItem`s with `children`, and new ad-platform reports are one line each in
`DIGITAL_ADS_REPORTS`.

```
Dashboard                 existing — absorbs the Marketing Overview KPI strip
Contacts                  existing (Loomi-native)
Engagement                existing (Loomi-native)

Digital Ads ▾             existing group
  Meta                    ✅
  Google Ads              ✅
  OTT / CTV               ✅
  Email                   ✅

Websites                  ✅ existing

Local Presence ▾          NEW group
  Business Profile        NEW — GBP
  Reputation              MOVE existing here, + review history
  Call Tracking           NEW

Sales & Service ▾         NEW group
  Lead Performance        NEW
  Sales Trend             NEW
  Service Trend           NEW
  Service Retention       NEW
  Customer Heatmap        NEW
  Direct Mail ROI         NEW — Service Mailer + Summary merged

Budget                    NEW leaf — read-only view of the budget module
Settings                  existing
```

**Budget as a top-level leaf, not under Digital Ads.** The earlier revision put
it under Digital Ads and called it a judgment call. It reads better at top
level now that the module exists and covers every channel including non-digital
fee lines — filing it under Digital Ads would misrepresent its scope to anyone
reading the nav.

Three ODT surfaces map to something other than a nav item:

- **Marketing Overview** → the existing `/reporting` Dashboard. It is already
  role-aware; it becomes the composite once its feeder reports exist.
- **Executive Dashboard** → the "all accounts" mode of that Dashboard. Loomi's
  `org-report-rollup` already does this for the six live platforms; each new
  report adds one `RollupConfig` entry in `rollup-configs.ts`.
- **Ad Meeting Report** → not a page. It is a *deliverable*: an export preset
  that assembles every live report for one account into one `ReportDoc` and
  runs it through the existing PDF exporter, with the AI analysis section
  generated by Loomi's existing Claude integration.

Follow the project's naming rule when labelling these: use the words the team
says out loud, not the model's vocabulary.

---

## 5. Phasing

**Phase 1 — nav + the reports the bridge already feeds**
1. ✅ **Nav restructure.** `Local Presence` and `Sales & Service` groups exist,
   unported members marked `soon`; Reputation moved into Local Presence.
2. ✅ **Sales Trend** and **Service Trend.** `src/lib/reporting/dealer-trends.ts`
   (queries + folding, unit-tested), `/api/reporting/{sales,service}-trend`,
   and pages under `/reporting/{sales,service}-trend`. Reuse `dealer-trends.ts`
   for the rest of the group — it already handles both source shapes — and
   `_components/dealer-charts.tsx` for the charts.
3. ✅ **Service Retention.** `src/lib/reporting/service-retention.ts` (both
   cohort metrics + linkage coverage, unit-tested),
   `/api/reporting/service-retention`, page at `/reporting/service-retention`.
   No date picker — each cohort carries its own window.
4. ✅ **Customer Heatmap.** `src/lib/reporting/customer-geography.ts` +
   `map-projection.ts` + `zip-centroids.ts` (all unit-tested),
   `/api/reporting/customer-geography`, page at `/reporting/heatmap`.
   Sales/service toggle, deal-type filter, self-rendered bubble map, ranked
   ZIPs and cities, placement accounting.

**Phase 1 is complete.** The four reports the push bridge already feeds are
shipped; only the Budget read-only view (item 5) remains, and it is blocked on
the classification decisions in `docs/budget-module.md`, not on code.
5. ✅ **Budget** in Reporting as a read-only view.
   `src/lib/reporting/budget-view.ts` (client-safe projection, leak-tested),
   `/api/reporting/budget`, page at `/reporting/budget`. Year picker, not a
   date range. See "Budget in Reporting shows no margin" below.

**Phase 2 — unblocked API work**
6. ✅ **Business Profile (GBP).** `src/lib/integrations/gbp.ts` (API client,
   unit-tested), `gbp-state.ts` (signed OAuth state), `gbp-connection.ts`
   (encrypted token storage), the `GbpConnection` model, four routes under
   `/api/reporting/gbp`, and a page at `/reporting/business-profile`.
   **Needs two config steps before it can connect — see below.**
7. ✅ **Ad Meeting.** `src/lib/reporting/meeting-doc.ts` (assembly, unit-tested)
   + `meeting-analysis.ts` (Claude), `/api/reporting/ad-meeting/analysis`, page
   at `/reporting/ad-meeting`. Staff-only, deliberately not in the sidebar.

**Phase 3 — extend the bridge**, cheapest first
8. ✅ **Lead Performance.** `src/lib/reporting/lead-performance.ts` (queries +
   comparison math, unit-tested), `/api/reporting/leads`, page at
   `/reporting/leads`. Month picker, not a date range. **Read the two caveats
   below before comparing it to ODT.**
9. ✅ **Call Tracking.** The first report that extended the bridge rather than
   reading it. Oz Reports: `Loomi::pushcalls` + a route. Loomi: `CallEvent`
   model, `/api/ingest/calls`, `src/lib/reporting/call-tracking.ts` (the six
   summaries, unit-tested), `/api/reporting/call-tracking`, page at
   `/reporting/call-tracking`.
10. ✅ **Reputation history.** Oz Reports: `Loomi::pushreviews` + a route.
    Loomi: `ReviewEvent`, `/api/ingest/reviews`,
    `src/lib/reporting/review-history.ts` (unit-tested), folded into the
    EXISTING `/api/reporting/reputation` rather than a second report.
11. ✅ **Direct Mail ROI.** Oz Reports: `Loomi::pushmailer` + `matchbackFor`
    (the matchback itself) + a route. Loomi: `MailerCampaign`,
    `/api/ingest/mailer-campaigns`, `src/lib/reporting/direct-mail.ts`
    (unit-tested), `/api/reporting/direct-mail`, page at
    `/reporting/direct-mail` — Summary folded in as totals above the list.

**Phase 4 — composites**
12. ✅ **Marketing Overview.** `src/app/reporting/_components/marketing-overview.tsx`,
    mounted at `/reporting` for a single account. The per-account source list
    and fan-out are shared with the Ad Meeting builder
    (`_components/account-sources.ts`) so the two cannot drift.
13. ✅ **Executive Dashboard.** `/reporting/executive`, eleven `RollupConfig`
    entries in `_components/rollup-configs.ts` (the six platform reports plus
    Sales, Service, Call Tracking, Direct Mail and Budget) rendered through the
    existing `OrgReportRollup`. Staff-only, and only with more than one rooftop
    in scope.

15. ✅ **Billboards.** `/reporting/billboards`, native `Billboard` table,
    `lib/reporting/billboards.ts` (20 tests), read route
    `/api/reporting/billboards` (client-visible) and write route
    `/api/billboards` (staff-only), plus the one-time importer
    `scripts/import-odt-billboards.ts`. See below for the three decisions.

### Billboards move, they don't sync

Every other ported surface reads through the Oz Reports bridge, because the DMS
keeps feeding those tables. Billboards were the exception on both counts: ODT's
own database was the system of record — someone typed each board in by hand —
and ODT is being retired. A recurring push route would have been a dependency
with an expiry date, so the rows move once (keyed on
`externalId = "odt:billboards:<id>"`, so the import is safe to re-run) and Loomi
owns them afterwards. This is the only surface where the bridge is not involved
at all.

**`is_group_level` was already a Loomi concept.** The open question called this
"a cross-org sharing model Loomi has no equivalent for", which was wrong — ODT's
flag means "show this board to every org beneath mine", and Loomi has
`parentAccountKey`. It ports as a `sharedWithChildren` boolean plus an ancestor
walk at read time (`visibleAccountKeys`), and that is the whole implementation.
The alternative — a join table of explicit shares — would have been a second
hierarchy to keep in step with the real one, and the first time someone
re-parented a sub-account the shares would quietly point at the wrong place.

**Expiry is derived, not stored.** ODT ran an `autoExpire()` sweep that UPDATEd
rows whose date had passed, so a board's status was only as fresh as the last
time someone loaded the page. Here `status` records intent (active / archived)
and expiry is computed from the date on read, so a contract that ends tonight
doesn't need a cron job to notice. One consequence worth knowing: **a board ODT
shows as `expired` will show in Loomi as active-with-a-past-date until someone
archives or renews it**, and the report calls that out in a banner rather than
hiding it. ODT's fourth status, `deleted`, has no equivalent — Loomi deletes
rows instead of tombstoning them, and the dump query excludes them.

The map reuses the Customer Heatmap's projection rather than a second one, with
one difference: a heatmap bubble is sized by volume, a board is a discrete place
that is either up or not, so boards plot as fixed pins coloured by state.

### Email & Text Blasts absorbed the Engagement page

**Shipped 2026-08-14**, and not an ODT port — a consolidation the ODT work made
obvious. Digital Ads → "Email Campaigns" read the previous provider's API and
nothing else, while `/reporting/engagement` read Loomi's own sends and nothing
else. Same subject, two pages, two sets of numbers, neither complete. They are
now one surface at `/reporting/ads/blasts`: Loomi email, Loomi text, the email
history carried over from the previous provider, and flows. Both old paths
redirect.

**Channels are reported apart, on purpose.** SMS has no open or click event —
not "we don't collect it", the events do not exist. A single engagement block
over both channels would divide email opens by a denominator that grows every
time someone sends a text, so the open rate would sink as texting increased and
read as engagement getting worse. Only sent / delivered / failed roll into the
combined header; `combine()` in `lib/reporting/blasts.ts` takes raw counts
rather than totals so no rate can be averaged in by accident, and a test asserts
the combined object exposes no engagement measure at all.

**The previous vendor is never named in the UI.** Its sends show as "Another
provider". Two consequences are surfaced rather than hidden: it reports one open
figure per campaign with no unique/repeat split, and it hands over per-campaign
totals with no underlying events — so the daily trend chart is Loomi-only and
says so, rather than spreading each campaign across its send window and drawing
a shape that never happened.

**Found while wiring it up:** the shared fan-out in
`_components/account-sources.ts` reads `accountMetrics` / `overview` / `summary`,
but the old email route nested its figures under `stats`. Email had therefore
been rendering as "no data" on the Marketing Overview and in the Ad Meeting
builder regardless of what the account actually had. The merged route exposes
`summary`, which fixes it. The Executive Dashboard roll-up was repointed for the
same reason — left alone it would have reported an account's pre-Loomi history
as its entire email programme, and zero for any rooftop that has only ever sent
through Loomi.

**Text analytics are new** (`lib/services/sms-analytics.ts`) — nothing
aggregated `SmsEvent` before. Two counting decisions worth knowing: delivery is
counted per distinct recipient rather than per event, because a retried message
produces two Twilio SIDs for one person and counting events would report more
deliveries than there were recipients; and opt-outs are counted as events
because an inbound STOP has no recipient row to be distinct on. Both are covered
by a DB probe.

**Flows follow the page date range** (added 2026-08-14). `/api/flows/analytics`
takes optional `start`/`end`; omitting both keeps the lifetime behaviour the
Studio analytics page relies on. The window means two different things on
purpose, because a flow mixes period measures with live state:

- **Sends, opens and clicks** are windowed on when the step ran.
- **Completions, exits and failures** are windowed on when the enrollment
  *started* — a cohort. Only `completed` carries its own timestamp; exits and
  failures record none, so an outcome-dated `completed` sitting beside a
  start-dated `exited` would describe two different groups of people.
- **`active` is never windowed.** An enrollment keeps no history of when it was
  in-flight, so "active during March" isn't recorded. It stays a live count and
  the card says "right now" whenever a window is applied.

The completion rate switches denominator to match: windowed it is completed ÷
entered (one cohort), unwindowed it is the original completed ÷ (active +
completed). Mixing a live `active` with a cohort `completed` would have divided
one population by another. A DB probe covers all of it.

**Deferred / undecided:** API Usage — see the open questions.

---

## 6. Open questions

1. ~~**Is ODT being retired or running alongside Loomi?**~~ **ANSWERED
   2026-08-14: Loomi is replacing ODT.** Everything ports, internal tooling
   included. This closes questions 2 and 3 below — Billboard Map and Marketing
   Lists are now in scope rather than optional, and API Usage needs a home
   because there will be no ODT to read it in. See "What replacing ODT still
   requires".
2. ~~**Marketing Lists**~~ ✅ **shipped** at `/reporting/lists` — and the
   "Reporting page or Studio tooling?" question turned out to be a false
   choice: it is the same `Audience` records either way. See "Marketing Lists
   ARE Studio's segments". **Still open:** the BDC call-list export, which
   needs caller names and phone numbers the bridge deliberately does not carry.
   That is a decision to move contact data, with a retention question attached
   — not a port.
3. ~~**Billboard Map**~~ ✅ **shipped** at `/reporting/billboards`. Both worries
   dissolved on contact with the code: the "new push route" became a one-time
   import because ODT is being retired (§ "Billboards move, they don't sync"),
   and the "cross-org sharing model Loomi has no equivalent concept" for was
   `is_group_level`, which maps exactly onto `parentAccountKey`. **Still open:**
   nothing blocking, but the ODT dump has not been run — the importer is
   dry-run by default and no boards exist in Loomi yet.
4. **Ad Meeting Report** — confirm it should be an export preset rather than a
   page, and whether the AI analysis section is required at launch.
5. **Client visibility** — ODT gates Ad Meeting to staff and Executive
   Dashboard to multi-org owners/admins. Which of the new reports should the
   Loomi `client` role see?
6. **Billing margins** — the ported ads reports gross up media cost by a
   per-account margin. Do any of the dealer-data reports need the same
   treatment? (Budget already resolves margin at ingest.)
7. **Does the bridge outlive "transitional"?** Both ingest routes are commented
   as throwaway, to be deleted when Oz Reports is decommissioned. Phases 1 and
   3 make Reporting depend on them permanently. If Oz Reports is going away,
   the sales/service/lead tables need a new home first — and the
   `modified_at` improvement noted in `oz-reports-contact-sync.md` becomes
   worth doing.

**Resolved since the last revision:**

- ~~Dealer-data access — direct MySQL, an ODT API, or ETL?~~ Settled in
  practice: push-into-Postgres, already running for contacts, events, and
  budget lines.
- ~~Powersports parity — day one or later?~~ Day one, free; `pusheventsps`
  already normalizes PS into the shared shape.
</content>
</invoke>
