# Oz Dealer Tools → Loomi Reporting migration plan

Inventory of every analytics surface in Oz Dealer Tools (ODT), what has already
landed in Loomi Reporting, and where the rest should go.

Sources: `Oz Dealer Tools/Code/ozdealertools` (CodeIgniter 4 / MySQL) and
`Loomi/Code/loomi-app` (Next.js / Postgres / Prisma).

---

## 1. Where we stand

ODT has **22 reporting surfaces** (20 client-facing + 2 internal). Loomi
Reporting has **5 ported in full and 1 partial** — the entire Digital Ads group
plus Website Analytics, and the live half of Reputation.

Everything already ported shares one architectural trait worth preserving:
**live pull, no metrics DB.** Every `/api/reporting/*` route resolves the
account → its platform config → hits the vendor API on each request. There is
no warehouse in the middle.

| ODT report | Loomi route | Status |
|---|---|---|
| Google Ads | `/reporting/ads/google` | ✅ ported (incl. ad-group drilldown) |
| Facebook Ads | `/reporting/ads/meta` | ✅ ported |
| OTT / CTV (StackAdapt) | `/reporting/ads/stackadapt` | ✅ ported |
| Email Campaigns (GHL) | `/reporting/ads/email` | ✅ ported |
| Website Analytics (GA4) | `/reporting/websites` | ✅ ported |
| Reputation Report | `/reporting/reputation` | ⚠️ partial — live rating + recent reviews only; no review history, trends, or reply rates |

Loomi additionally has three things ODT does not: **PDF + XLSX export**
(`/api/reporting/export/*`, platform-agnostic), a **cross-account roll-up**
(`org-report-rollup.tsx` + `rollup-configs.ts`) that is effectively a partial
Executive Dashboard, and **Engagement / Contacts** reporting that is Loomi-native.

---

## 2. Full ODT inventory

Grouped as the ODT sidebar presents them (`app/Views/default.php:749-880`).

### Executive Dashboard
Cross-org roll-up. Shown only to super admins and org owners/admins who belong
to more than one org. Routes: `reports/executive-dashboard`, `ajax-load`,
`ajax-load-retention-org`.

### Big Picture

| Report | Route | Data source | What it shows |
|---|---|---|---|
| **Marketing Overview** | `reports/marketing-dashboard` | 17 AJAX endpoints fanning out to *every* other source | The composite. Cards for ROI, GA4, Google Ads, Facebook Ads, leads, sales, service, budget, email, call tracking, reputation, OTT/CTV, service retention, GBP. Charts: ad spend, budget, lead sources, call performance, sales mix, service pay type, top cities (sales + service). |
| **Budget Report** | `reports/budget` | `budgets` MySQL DB (`account_budgets`) | Planned vs. billed spend by category, channel, month; incoming (agency-billed) vs. account budgets; grand totals. |
| **Ad Meeting Report** | `reports/ad-meeting` | Same fan-out as Marketing Overview + `POST ad-meeting/analyze` | Staff/super-admin only. A client-meeting deliverable across all channels with an **AI-generated written analysis** on top. |

### Digital Ads
All four ported. ✅

### Onsite / Experience

| Report | Route | Data source | What it shows |
|---|---|---|---|
| Website Analytics | `reports/website-analytics` | GA4 Data API | ✅ ported |
| **Business Profile** | `reports/gbp` | Google Business Profile API, **per-org OAuth** (`gbp_refresh_token`) | Local listing performance. Includes a connect/disconnect OAuth flow and a location picker. |
| Reputation | `reports/reputation` | Google Places (live) + `ozrep` MySQL DB (history) | ⚠️ partial — see §1 |
| **Call Tracking** | `reports/call-tracking` | `ozreports` DB via `OzReportsData::getCalls()` | Call volume and answer rate, summarized by status, tracker, city, day-of-week, hour, and date. |

### Sales & Service

| Report | Route | Data source | What it shows |
|---|---|---|---|
| **Lead Performance** | `reports/lead-performance` | `ozreports` DB | Leads by type with month-over-month comparison, trend, YTD, and prorated (month-to-date vs. same-day-last-year) variance. |
| **Customer Heatmap** | `reports/heatmap` | `ozreports` DB | Sales and service customers plotted by ZIP code. |
| **Sales Trend** | `reports/sales-trend` | `ozreports` DB | Units, gross, APR, new/used mix over time. |
| **Service Trend** | `reports/service-trend` | `ozreports` DB | RO counts and revenue split by customer-pay / warranty / internal. |
| **Service Retention** | `reports/service-retention` | `ozreports` DB | Sales→service conversion and service repeat-visit retention cohorts. |
| **Service Mailer ROI** | `reports/service-mailer` | `purls` DB + `ozreports` DB | Direct-mail campaign matchback: recipients, engagement, offer requests, attributed calls and ROs. Includes a BDC call-list CSV download. |
| **Service Mailer Summary** | `reports/service-mailer-summary` | `purls` + `ozreports` | Multi-campaign roll-up of the above. Routed but not in the sidebar. |
| **Billboard Map** | `reports/billboards` | ODT's own app DB (`BillboardModel`) | Out-of-home board locations on a map, including boards shared from other orgs. |

### Tools

| Surface | Route | Data source | Notes |
|---|---|---|---|
| **Marketing Lists** | `reports/marketing-lists` | `ozreports` DB | Sizes segmented marketing lists and exports a BDC call list. This is a *tool*, not a report. |

### Internal / diagnostic
`reports/api-usage` (super admin, ODT app DB), `reports/gbp-debug`,
`reports/stackadapt-debug`, `reports/email-debug`, `inventory-incentives`.
Not migration candidates as-is.

---

## 3. The one real blocker: dealer data

Of the 16 unported surfaces, **10 are blocked on MySQL databases Loomi cannot
currently reach.** ODT connects to five databases; Loomi is Postgres-only and
references none of them.

| DB (ODT connection name) | Feeds | Loomi access today |
|---|---|---|
| `ozreports_dashboarddata` (`ozreports`) | Leads, sales, service, calls, ZIP geography, `dealer_map` | ❌ none |
| `ozreports_budgets` (`budgets`) | Budget Report | ❌ none |
| `ozreputation_ozrepdata` (`ozrep`) | Review history, reply rates | ❌ none |
| `purls` | Service Mailer ROI + Summary | ❌ none |
| `ozdealertools_odtdata7622` (`default`) | Billboards, API usage | n/a — ODT app data |

**The bridge key is small.** `OzReportsData` takes an `oz_reports_id` and derives
everything else from `dealer_map` (`getCdkAccountingCode`, `getCdkSvcCode`,
`getCallTrackerId`, `getDealerType`). So Loomi's `Account` model needs only two
new fields:

```prisma
ozReportsId  Int?   // → ozreports.dealer_map.id — unlocks leads/sales/service/calls
ozRepOrgId   Int?   // → ozrep — unlocks review history
```

`cdk_accounting`, `cdk_svc`, `call_tracker_id`, and `dealer_type` all resolve
from `ozReportsId` at query time, exactly as ODT does it.

### Access options

**(a) Direct read-only MySQL from Loomi** — add a `mysql2` pool alongside Prisma
and port `OzReportsData`'s queries to TypeScript in `src/lib/integrations/`.
*Recommended.* It preserves the live-pull model every ported report already
uses, keeps one hop, and the query logic is already written and battle-tested —
it just needs translating. Requires network reachability from the DigitalOcean
host and a read-only MySQL user.

**(b) Read-only HTTP API on ODT** that Loomi calls. Keeps dealer SQL owned in
one place, but makes ODT a permanent runtime dependency of Loomi and adds a hop
to every report load.

**(c) ETL into Loomi Postgres** on the existing pg-boss worker. Best long-term
decoupling and the fastest cross-account roll-ups, but the most work and it
introduces a freshness lag the current reports don't have.

**Suggested:** (a) now, (c) later for anything that needs to fan out across
every rooftop at once (Executive Dashboard, org roll-ups).

One porting nuance: every `OzReportsData` query branches on
powersports vs. standard via different table and column maps (`PS_SALES` /
`STD_SALES`, `PS_SERVICE` / `STD_SERVICE`). That branching has to come across
too, or powersports accounts will silently report zeros.

---

## 4. Proposed Loomi Reporting IA

Current nav (`reporting-sidebar.tsx:60-77`) is a flat list of leaves plus one
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
  Budget                  NEW — cross-channel planned vs. billed spend

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

Settings                  existing
```

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

**Budget under Digital Ads** is a judgment call — it covers all channels, not
just digital. It sits there because spend pacing is what the ads tabs are
already about. Moving it to a top-level leaf is equally defensible.

---

## 5. Phasing

**Phase 1 — unblocked today (no new data source)**
1. Business Profile (GBP). Pure API. Needs a per-account OAuth connect flow
   (`gbpRefreshToken` etc. on `Account`) — the only ODT report with per-account
   OAuth rather than agency-wide credentials.
2. Ad Meeting export preset over the six live reports.
3. Nav restructure: create the `Local Presence` and `Sales & Service` groups
   with their members marked `soon`, so the shape is visible before the data
   lands.

**Phase 2 — the dealer-data bridge**
4. Pick an access option (§3). Provision the read-only MySQL user, confirm
   network reachability from the app host.
5. Add `ozReportsId` / `ozRepOrgId` to `Account` + a Settings field to populate
   them.
6. Port `OzReportsData` → `src/lib/integrations/oz-reports.ts`, including the
   powersports column branching. This is the largest single piece of work
   (~2,000 lines of PHP, though much of it is repetitive query building).

**Phase 3 — reports on the bridge**, cheapest first:
7. Sales Trend, Service Trend (single summary query each)
8. Lead Performance (comparison + trend + YTD + prorated math)
9. Call Tracking (six summarizer functions, all already written)
10. Service Retention (cohort math)
11. Customer Heatmap (needs a map component — the only new UI dependency)
12. Reputation history — completes the partial report
13. Budget Report (separate DB, separate connection)
14. Direct Mail ROI (two DBs joined; the most complex matchback logic)

**Phase 4 — composites**
15. Marketing Overview on the Dashboard
16. Executive Dashboard via `RollupConfig` entries for each new report

**Deferred / undecided:** Billboard Map, Marketing Lists, API Usage — see the
open questions.

---

## 6. Open questions

1. **Dealer-data access** — direct read-only MySQL, an ODT API, or ETL? And is
   the MySQL host reachable from the Loomi app host, or is there a firewall /
   VPC boundary in the way?
2. **Is ODT being retired or running alongside Loomi?** If retired, we port
   everything including internal tools. If it stays, we only port the
   client-facing reports and leave staff tooling in ODT.
3. **Marketing Lists** — Loomi already has Contacts, Audiences, and segments in
   Studio. Should Marketing Lists become a Reporting page, fold into Studio's
   audience tooling, or stay in ODT?
4. **Billboard Map** — worth porting? It runs off ODT's own DB and has no
   Loomi equivalent. It is also the only report with a cross-org sharing model.
5. **Ad Meeting Report** — confirm it should be an export preset rather than a
   page, and whether the AI analysis section is required at launch.
6. **Powersports parity** — needed day one, or can the first port target
   standard automotive tables and add PS after?
7. **Client visibility** — ODT gates Ad Meeting to staff and Executive
   Dashboard to multi-org owners/admins. Which of the new reports should the
   Loomi `client` role see?
8. **Billing margins** — the ported ads reports gross up media cost by a
   per-account margin. Do any of the dealer-data reports (Budget especially)
   need the same treatment?
