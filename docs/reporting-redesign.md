# Reporting redesign — data audit, client/internal split, and the face lift

Three questions, answered in order:

1. **What are we actually pulling today, and what are we leaving on the table?** (§1–§2)
2. **How do we serve clients and the internal digital team from the same platform?** (§3)
3. **How do we make these pages look like the references — is there something to install?** (§4)

Plus the empty-section integration links (§5) and sequencing (§6).

Audited against `src/lib/integrations/*` and `src/app/api/reporting/*` on
2026-08-15. Every figure below is a **live pull** — Reporting has no metrics
warehouse, by design (see `docs/odt-reporting-migration.md`). The dealer-data
reports (calls/leads/sales/service/heatmap/direct-mail) are the exception: they
read local Postgres filled by the Oz Reports bridge.

---

## 1. What we pull today, field by field

### Google Ads — `src/lib/integrations/google-ads.ts`

| Section | GAQL source | Fields |
|---|---|---|
| Account totals | `FROM customer` | impressions, clicks, ctr, average_cpc, cost_micros, conversions, conversions_value, cost_per_conversion |
| Offline enrichment | `FROM conversion_action` | all_conversions, all_conversions_value → offline leads / purchases / purchase value |
| Campaigns | `FROM campaign` | id, name, status, budget amount + the account metric set |
| Ad groups (drilldown) | `FROM ad_group` | id, name, status, type + metrics |
| Devices | `FROM customer`, `segments.device` | impressions, clicks, ctr, cost, conversions |
| Daily | `FROM customer`, `segments.date` | impressions, clicks, cost, conversions |
| Search terms (top 20) | `FROM search_term_view` | term, impressions, clicks, ctr, cost, conversions |
| Keywords (top 50) | `FROM keyword_view` | text, match_type, **quality_score**, ad group, campaign, status + metrics |
| Locations (top 30) | `FROM geographic_view` | city / region / metro (name-resolved) + impressions, clicks, ctr, cost, conversions |
| Auction insights | `FROM campaign` | search IS, top IS, abs-top IS, budget-lost IS, rank-lost IS |

### Meta — `src/lib/integrations/meta-ads.ts`

| Section | Insights call | Fields |
|---|---|---|
| Account | `level=account` | impressions, clicks, ctr, cpc, spend, cpm, actions, cost_per_action_type, action_values |
| Campaigns | `level=campaign` | campaign id/name + the above (no cpm) |
| Devices | `breakdowns=device_platform` | impressions, clicks, ctr, spend |
| Daily | `time_increment=1` | impressions, clicks, spend, actions, action_values |
| Demographics | `breakdowns=age,gender` | impressions, clicks, spend |
| Creatives | `level=ad` | campaign_id, ad_id, ad_name, **impressions only**, plus thumbnail/image URLs |

### GA4 — `src/lib/integrations/ga4.ts`

| Section | Dimensions | Metrics |
|---|---|---|
| Overview | — | sessions, totalUsers, newUsers, screenPageViews, bounceRate, averageSessionDuration |
| Channels | sessionDefaultChannelGroup | sessions, totalUsers |
| Top pages (10) | pageTitle, pagePath | screenPageViews, averageSessionDuration |
| Trend | date | sessions, totalUsers |
| Devices | deviceCategory | sessions, totalUsers |
| Source / medium (25) | sessionSource, sessionMedium | sessions, totalUsers, newUsers, bounceRate, avgSessionDuration, screenPageViews |
| VDP views (10) | pageTitle, pagePath (platform-filtered) | screenPageViews, totalUsers, averageSessionDuration |

### Google Business Profile — `src/lib/integrations/gbp.ts`

Daily: impressions split desktop/mobile × maps/search, `WEBSITE_CLICKS`,
`CALL_CLICKS`, `BUSINESS_DIRECTION_REQUESTS`, `BUSINESS_BOOKINGS`,
`BUSINESS_CONVERSATIONS`, `BUSINESS_FOOD_ORDERS`. Plus monthly search keywords.

### Reputation — `src/lib/integrations/google-places.ts` + `ReviewEvent`

Live Places: rating, review count, status, recent reviews, **one** competitor.
Local history: distribution over time, trend, reply rates, coverage.

### StackAdapt — `src/lib/integrations/stackadapt.ts`

The entire field set is five columns: `impressionsBigint`, `clicksBigint`,
`cost`, `conversionsBigint`, `uniqueImpressionsBigint` — at account, campaign,
campaign-group, daily, and creative level. ctr / cpc / cpm / CPA are derived
locally, not pulled.

### First-party (Postgres, via the Oz Reports bridge)

Calls, leads, sales, service, retention, heatmap ZIPs, direct-mail matchback,
billboards, blasts, budget lines. Documented gap: **dealer gross is not in the
bridge payload** — Sales Trend charts transaction revenue and says so.

---

## 2. What's available and unused

Ranked by what it would change about a decision, not by how easy it is.

### Tier 1 — the numbers people are actually asking for

**Meta: reach + frequency.** Not pulled anywhere. Frequency is the single
number that explains "why did our CPM go up" and "why are we getting fatigued,"
and reach is what a dealer means when they ask how many people saw the ad.
*Caveat: reach/frequency are de-duplicated and non-additive — they cannot be
summed across a breakdown or across a date split, so they belong on the
headline row only.*

**Meta: placement breakdown** (`publisher_platform`, `platform_position`).
Facebook vs Instagram vs Audience Network vs Reels vs Stories. This is the most
actionable optimization cut Meta offers and we don't have it. Today the digital
team has to open Ads Manager to answer "should we turn off Audience Network."

**GA4: key events / conversions** (`keyEvents`, `sessionKeyEventRate`). The
website report currently cannot state a single outcome — only traffic. This is
also what makes the site report tie out against the ad reports.

**Google: call metrics** (`metrics.phone_calls`, `phone_impressions`,
`phone_through_rate`). Dealers judge Google on phone calls. We report
conversions generically and never isolate calls.

**StackAdapt: video completion + placement.** For a CTV/OTT product, VCR and
quartile completions are the deliverable; impressions and clicks are close to
meaningless on connected TV. Also missing: the domain/app placement report,
which is the brand-safety answer when a dealer asks where their ad ran.

**✅ RESOLVED 2026-08-16 — video shipped.** `scripts/stackadapt-introspect.ts`
was run against the live API on production (the only environment with
`STACKADAPT_API_KEY`). `DeliveryStatsRecord` has 89 fields; the video set is:

```
videoStartsBigint        BigInt   Video starts
videoQ1PlaybacksBigint   BigInt   25% video completions
videoQ2PlaybacksBigint   BigInt   50% video completions
videoQ3PlaybacksBigint   BigInt   75% video completions
videoCompletionsBigint   BigInt   100% Video Completions
videoCompletionRate      Float    Video completions per video start
```

Declining to guess was the right call. The 25/50/75 marks are `Q{n}Playbacks`
but 100% is `Completions`, so the natural guess `videoQ4PlaybacksBigint` does
not exist — and because `METRICS_FRAGMENT` is shared by all five delivery
queries, that one name would have taken down the whole StackAdapt report rather
than blanking a section. `stackadapt.test.ts` now asserts each verified name and
explicitly asserts Q4's absence, so a later edit "from memory" fails in CI.

VCR is a client-visible KPI (hidden entirely when `video_starts` is 0 — a
display-only buy is not a 0% completion rate), and the quartile funnel is a
team-lens section, since where viewers drop off is a creative-length decision.

**Also found: a `margins` field.** `DeliveryStatsRecord` exposes StackAdapt's own
margin as `margins` — plural. `stripInternalCost` matched only `actual_*` and
`margin`, so the plural would have passed straight through to clients had anyone
added it while browsing that 89-field list. Nothing requested it, so nothing
leaked; the guard now blocks it and the fragment carries a "do not add" note.

Still open for StackAdapt: the domain/app **placement** report (brand safety —
where the ad ran).

Reach and frequency, incidentally, are NOT missing from StackAdapt — the
fragment already requests `uniqueImpressionsBigint` and `frequency`, and the
report already renders both.

### Tier 2 — internal optimization, low client value

- **Google:** hour-of-day and day-of-week (`segments.hour`, `segments.day_of_week`)
  → ad-schedule bid decisions; RSA asset performance
  (`ad_group_ad_asset_view`) → which headlines to cut; PMax asset-group and
  listing-group performance → the current PMax black box; conversion actions
  **by name** (we only bucket by type/category); change history; search-term
  add/exclude status.
- **Meta:** quality / engagement-rate / conversion-rate rankings (Meta's own
  diagnostic triad); ad-level *performance* metrics — we pull ads for their
  thumbnails and take impressions only; `outbound_clicks` and
  `inline_link_click_ctr` (the real CTR — today's `ctr` counts every click
  including reactions); learning-phase and delivery status.
- **GA4:** landing pages (`landingPage`); `engagementRate` / `engagedSessions`
  — GA4's own replacement for the `bounceRate` we still lead with;
  `sessionCampaignName` for tying GA4 back to the ad platforms; `newVsReturning`;
  event-level (`eventName`, `eventCount`) for form submits and click-to-call.
- **GBP:** post/update performance and photo views — currently invisible, and
  they're a service the agency sells.
- **Reputation:** only one competitor is supported; a set of 3–5 is the same
  code. No non-Google sources (DealerRater, Cars.com, Facebook). No
  response-time SLA metric.

### Tier 3 — the one nobody else can build

**Cost per lead and cost per sold unit, per channel.** Loomi is the only tool
that holds media spend *and* the CRM outcome. Google Ads can tell you cost per
conversion; only Loomi can tell you cost per *actual delivered unit*, because
`ContactEvent` has the sale and `Account.*Margin` has the billed spend. Nothing
in Reporting joins them today.

This is the report that makes the platform non-replaceable, and it needs no new
integration — only the join. It is also the thing Dealer Teamwork cannot answer
(see `docs/dealer-teamwork-parity.md`).

---

## 3. Client view vs. team view

### Recommendation: one report, two lenses — not two sets of pages

A `?view=client|team` lens on the existing routes, defaulting by role:

- `client` role → client lens, locked, no toggle rendered.
- `admin` / `super_admin` / `developer` → team lens by default, with a visible
  **"View as client"** switch in the top bar.

Why not separate routes: two routes means two components, and two components
drift — within a quarter the client's CTR and the team's CTR are computed
differently and someone is on a call defending the gap. It also means a rep
about to screen-share has no way to see exactly what the client sees.

The lens is a prop threaded to the section list. Sections declare
`lens: 'both' | 'team'`. That is the whole mechanism.

### Google Ads

| Client lens | Team lens adds |
|---|---|
| Billed spend, impressions, clicks, CTR, conversions, cost/conv | Raw (pre-margin) cost beside billed — **see open question Q2** |
| Daily trend | Impression share, lost-to-budget vs lost-to-rank |
| Top campaigns (plain-language names) | Ad-group drilldown, bid strategy, budget pacing vs plan |
| Device + top locations | Keywords with quality score + match type, zero-conversion spend flags |
| Cleaned top search terms | Full search terms with add/exclude, hour × day-of-week heatmap |
| Calls, form fills | Conversion actions by name, RSA asset performance, change history |

### Meta

| Client lens | Team lens adds |
|---|---|
| Spend, reach, frequency, impressions | Placement breakdown (FB/IG/AN/Reels/Stories) |
| Results and cost per result | Quality / engagement / conversion-rate rankings |
| Top creative with thumbnails | Ad-level table with CTR decay (creative fatigue) |
| Demographics, daily trend | Frequency warnings, learning-phase status, ad-set delivery |

### GA4

| Client lens | Team lens adds |
|---|---|
| Sessions, users, key events, channels | Landing pages, engagement rate vs bounce |
| VDP views, top pages | Full source/medium with paid attribution tie-out |
| Trend | Self-referral / bot / (not set) diagnostics |

Same pattern for StackAdapt (client: reach, VCR, completions; team: placement,
domain list, frequency) and GBP (client: discovery vs direct, actions; team:
keyword detail, post performance).

**Note:** this is a presentation split, not a security boundary. The API guard
(`requireReportingAccess`) already scopes by account; if a field must never
reach a client it has to be filtered server-side, not hidden in the lens.

### Phase 2 (shipped) — and what it turned up

`?view=client|team` on the ads routes, defaulting to team for
`MANAGEMENT_ROLES` and pinned to client for the `client` role, with a Team /
Client toggle and a preview banner. URL-backed, so "here's what they'll see" is
a link.

**The margin was already being served to clients.** `applyMargins` preserves the
raw platform cost as `actual_<field>`, and the routes returned `margin` at the
top level. No component rendered either — but both shipped in the JSON to every
caller, so a client could open devtools on their own report and read the
agency's raw media cost *and* its markup percent. `stripMarginInternals` now
removes both server-side for anyone below super-admin, recursing through
`campaigns[]`, `daily[]`, `devices[]` and the nested `compare` block.

This is exactly why decision 2 is enforced in the route: hiding the fields in
the lens would have left them in the payload. The components read
`actual_cost` / `actual_spend` and treat *absence* as "not permitted" — they
never see a role, so the rule lives in one place.

**Exports were a second leak.** `ExportMenu` builds its own section list, so a
client-lens PDF would still have contained keywords, quality scores and auction
insights. The doc sections are now gated by the same flag as the on-screen ones.

**Google's split is substantive; Meta's is thin — for now.** Google's team lens
holds keywords with quality score, auction insights, the ad-group drilldown, the
full search-term list, and a new zero-conversion-spend total in the keyword
header. Meta today has only raw spend and CPC/CPM campaign columns, because the
sections that would actually separate the two audiences — placement, delivery
rankings, frequency — do not exist yet. They arrive in Phase 3.

One more dead-payload find: the Meta route pulled `campaignCreatives` (ad-level
thumbnails) on every request and **no component rendered them** — resolved in
Phase 3 by removing the fetch (see below).

### Phase 3 (shipped, except StackAdapt)

**Meta placement breakdown** — `publisher_platform × platform_position`, team
lens, non-fatal like Google's enrichment sections. Now the report can answer
"should we turn off Audience Network" without opening Ads Manager.

**Meta reach + frequency.** Deliberately in their own row, *apart* from the
additive metrics: both are de-duplicated over the window and therefore
NON-ADDITIVE. The reach of two campaigns is not the sum of their reaches, and a
month's reach is not the sum of its days. Sitting them next to impressions
invites precisely that error, which is the most common way an agency overstates
how many people it reached. Frequency ≥ 4 changes tone and labels itself as
likely creative fatigue, and its delta is scored `lowerIsBetter`.

**GA4 key events.** `keyEvents` + `sessionKeyEventRate` on the overview, and
`keyEvents` per channel — so the website report finally states an outcome, and
the channel table ties back to the ad reports. A property with nothing marked
as a key event reports 0, which is honest: it means nobody has told GA4 what
counts as a result on that site.

Bounce rate briefly came out of the KPI row to make space and was put back on
request — dealers ask for it by name. The row is now four across rather than
six, so seven headline metrics land 4 + 3 instead of stranding the seventh
alone, and two-word labels stop truncating. Moving to `engagementRate` (GA4's
own replacement, of which bounce is the inverse) stays a deliberate separate
change, not a silent one.

**`campaignCreatives` fetch removed.** Two Graph round-trips per report load
for a field nothing read. It returns with the creative-performance section,
which needs ad-level *metrics* anyway — the helper only pulled impressions plus
a thumbnail, so that section could never have been built on it as written.

**A latent GA4 bug, nearly introduced and then caught.** Adding the key-event
metrics, I first "fixed" `metricInt` to truncate — reasonable-looking, since
the name says int. But several existing call sites read *fractional* metrics
through it (bounce rate, average session duration, average time on page), so
truncating would have silently reported every bounce rate under 100% as zero.
The helper is back to its original non-truncating behaviour, now with a comment
saying why, and the fractional call sites read through a `metricFloat` alias
that documents intent. There is a regression test.

---

## 4. The face lift

### Is there a plugin or extension to install?

**No — and installing one would make this worse.** The reference dashboards are
Tailwind + a chart library, which is exactly what Loomi already is (Tailwind 4,
ApexCharts, `--card` / `glass-card` tokens in `globals.css`). A dashboard kit
would arrive with its own colour system, its own dark-mode mechanism and its
own component API, and we'd spend the project fighting it back into Loomi's
tokens rather than designing.

The real leverage is that **~35 report files already import their primitives
from one module** — `src/app/reporting/ads/_components/shared.tsx`
(`Kpi`, `Section`, `DataTable`, `EmptyState`, `LoadingState`, `DailyChart`,
`SpendBar`, `SpendDonut`, `DemographicsChart`). Every report is already routed
through the thing we need to change. Tighten those and the face lift lands on
every page at once, with near-zero per-file churn.

### What actually produces the look in the references

1. **KPI tiles.** Today: `text-xl` figure, a `text-[10px]` uppercase label, a
   bare percentage. References: a large figure, a delta *chip* with a direction
   arrow, and a sparkline behind the number. → new `StatTile`.
2. **Chart palette.** Today: `['#6366f1', '#38bdf8', '#a78bfa', '#fbbf24',
   '#34d399', '#f472b6']` hard-coded and repeated in four chart wrappers, with
   grid/foreground colours computed per chart from an `isDark` boolean passed
   down through every component. → one tokenized chart theme, derived from the
   CSS variables, with `isDark` read from context instead of drilled.
3. **Card and spacing scale.** `p-4` / `p-5`, `rounded-xl` / `rounded-2xl` mixed.
   The references are consistent and more generous. → one radius + padding scale.
4. **Type scale.** `text-[10px]` and `text-[11px]` appear throughout; it reads
   cramped and it's below what most people can comfortably read on a shared
   screen in a dealership. → a proper scale, minimum 12px for data.
5. **Section headers** get a right-side control slot, so filters and range
   pickers sit in the card (as in the references) rather than only at page top.
6. **Skeletons** matched to the real layout rather than one generic block set.

### Plan

Add `src/app/reporting/_components/ui/` — `StatTile`, `ChartCard`,
`ReportTable`, `ReportHeader`, `chart-theme.ts` — then re-export from
`shared.tsx` so **no existing call site breaks**. Reports adopt the richer props
(sparkline data, header controls) one at a time, but inherit the new look
immediately.

**Constraint the references don't cover:** they are all dark-only. Loomi ships
light and dark, and the appearance settings are a shipped feature. Every token
must be defined in both.

### What Phase 0 found when the palette was actually validated

Reporting had **two** palettes. `dealer-charts.tsx` carried a validated one;
`ads/_components/shared.tsx` carried a different, unvalidated set that the
ads reports and the GA4 charts both used. Run against the real light and dark
chart surfaces, the ads palette failed three of five checks:

- **Lightness band** — `#fbbf24` and `#34d399` sat outside it.
- **CVD separation** — `#a78bfa` vs `#38bdf8` at ΔE **5.2** under deuteranopia,
  below even the conditional 6–8 floor. A red-green colourblind reader could not
  tell two adjacent donut slices apart.
- **Contrast** — five of its six hues under 3:1 against the surface.

The dealer-charts palette passed everything, so it became the single source
(`ui/chart-theme.ts`) and the ads/GA4 sets were deleted.

**The palette is four hues, and that is a ceiling.** Re-validated at
`--pairs all` — the donut case, where every slice is on screen at once — every
fifth hue tried collided with one already in the set under *normal* vision:
cyan ΔE 11.8 vs emerald, purple ΔE 11.4 vs indigo, slate ΔE 2.5 vs pink under
protanopia (floor is 15). So a fifth category folds into a gray "Other" via
`foldToPalette()` instead of getting a hue. GA4's channel donut was rendering
**eight**; it now folds. `chart-theme.test.ts` guards the count.

Two other things fell out of the same pass:

- **Two dual-axis charts were removed.** `DailyChart` (spend vs clicks) and
  `Ga4TrendChart` (sessions vs users) each plotted two measures on two y-scales,
  which lets the axis choice manufacture crossings the data doesn't contain.
  Both are now two stacked plots on a shared x-axis. `dealer-charts.tsx` had
  already refused to do this and said so in its header — the ads and GA4 charts
  had simply not caught up. Props unchanged, so no call site moved.
- **Two layout bugs only visible on render:** a wrapping `Cost / conv.` label
  pushed one tile's figure a line below its neighbours, and sub-5% donut slices
  collided with each other's percent labels. Both fixed.

---

## 5. Integration links on empty sections (agency users only)

Extend `EmptyState` with an optional `connect?: { href, label }`, rendered only
when the viewer is in `MANAGEMENT_ROLES`. Clients keep the plain "no data for
this period" copy with no link and no hint that anything is unconfigured.

| Report | Destination | Status |
|---|---|---|
| Google Ads, StackAdapt | `/settings/subaccounts/<key>?tab=integrations` | ✅ **shipped** — `EmptyState.connect` |
| Meta | same tab, Meta Ads card | ✅ **shipped** |
| Blasts (GoHighLevel) | same tab | ⚠️ deferred — GHL being unconfigured is a *soft* state there (the report still renders Loomi sends and shows a history banner), so it needs an inline agency-only note, not an `EmptyState`. Fold into the Phase 0 UI-kit pass. |
| Business Profile | in-page connect panel | ✅ already built and role-gated |
| GA4 | same tab, Google Analytics card | ✅ **shipped** (Phase 1) |
| Reputation | same tab, Google Places card | ✅ **shipped** (Phase 1) |
| Calls / leads / sales / service / heatmap / direct mail | — | ⚠️ not a Loomi setting — fed by the Oz Reports bridge's `dealer_map` |

**The bridge-fed reports get a diagnostic panel instead of a link** — "no
records received for this account; last ingest run: <date>" — since the fix
lives on the Oz Reports host, not in Loomi. Agency-only, same gate. Still open.

### Phase 1: the env-to-DB move (shipped)

Four new `Account` columns — `ga4PropertyId`, `ga4Platform`, `googlePlaceId`,
`googleCompetitorPlaceId` — with cards in the existing Integrations grid.
Beyond unblocking the connect links, this **removes a redeploy from onboarding a
rooftop**: mapping a GA4 property or a Google listing was an env-var edit.

Four things worth knowing about how it landed:

- **The env maps are still read, as a fallback.** `resolveGa4Property` and
  friends moved to `lib/integrations/account-mapping.ts`, which prefers the
  column and falls back to env. So the cutover needs no flag day. The old
  parsers stayed put renamed `*FromEnv` — the rename is what made the compiler
  point at every call site. Delete both the fallbacks and the env vars once
  `scripts/backfill-account-mappings.ts` has run everywhere.
- **The backfill never overwrites a column that already has a value.** It runs
  on every deploy, and someone who fixes a property id in the UI must not have
  it stamped back to the stale env value on the next one.
- **`googlePlaceId` deliberately has no unique constraint.** The review ingest
  reads it in reverse (listing → owning account), so two accounts sharing one is
  a real config error — but nulls are the common case, and the ingest already
  refuses and names both accounts rather than guessing. That is the safer
  failure: picking one would attribute a rooftop's reviews to its neighbour,
  silently. (`db push` also refuses to add a unique constraint over existing
  duplicate data, so the constraint would have to be earned first anyway.)
- **`VDP_PLATFORM_PATTERNS` had to move** to `ga4-platforms.ts`. The
  Integrations card derives its platform dropdown from that table so the two
  can't drift, but it's a client component and `ga4.ts` imports `node:crypto`
  for the service-account JWT exchange. Same split, same reason, as
  `lib/roles.ts` vs `lib/auth.ts`.

One copy fix fell out of it: the GA4 and Reputation reports both told the reader
to "map it on the server, then refresh." Unmapped is now a muted setup state
with a Connect button for agency users, not a red error panel — a red panel
about our own configuration is not a fact about the client's month.

---

## 6. Sequencing

| Phase | Work | Why here |
|---|---|---|
| 0 | ✅ **shipped** — report UI kit + chart theme + `EmptyState.connect` | Everything else renders through it; do it once |
| 1 | ✅ **shipped** — GA4 + Places mappings → DB, integration cards | Unblocks §5, removes a deploy from onboarding |
| 2 | ✅ **shipped** — client/team lens on Google + Meta | Highest-traffic reports, proves the pattern |
| 3 | ✅ **shipped** — Meta placement + reach/frequency, GA4 key events, StackAdapt video (field names introspected 2026-08-16) | Each is additive to an existing route |
| 4 | ✅ **shipped** — lens on StackAdapt + Websites, Ad Templates made agency-only, drilldown leak closed | Less mechanical than expected — see below |
| 5 | ✅ **shipped** — Acquisition Cost report | The join nobody else can make |

---

## Phase 5 (shipped) — Acquisition Cost

`/reporting/acquisition`, under Sales & Service. Media spend ÷ CRM outcomes.

### The finding that shaped it: there is no per-channel attribution

Before writing anything I went looking for a path from a sale back to a
channel. **There isn't one.**

- `Contact.source` is the CRM's lead source — "AutoTrader", "Website",
  "Walk-in". A different taxonomy from ad channels, and "Website" says nothing
  about whether the visit came from Google or Meta.
- `ContactEvent.sourceCrm` names the CRM SYSTEM (cdk, tekion), not a marketing
  source.
- Nothing carries a click id, utm set or campaign into the deal record.

So spend-by-channel and leads-by-CRM-source are two truthful lists that must
never be divided by one another. `computeAcquisitionCost` will not do it, and
the shape it returns gives the UI nothing to do it with. That constraint is the
report's design, not a limitation of it.

Two things ARE honest, and the report produces exactly those:

1. **Blended** — total media spend ÷ total outcomes. No attribution claim. This
   is the standard automotive measure and what a GM means by "what does a car
   cost me in advertising".
2. **Platform-attributed** (team lens) — where a channel has offline
   conversions imported, that channel's spend ÷ its own matched purchases. The
   PLATFORM's attribution, labelled as such, never ours.

The two will not reconcile, and the report says so on screen: each platform
counts only what it matched, so its units are a subset of deliveries while its
spend is the full channel spend. Every per-channel figure is an upper bound. In
the preview, blended reads $487/unit against Google's $962 and Meta's $635 —
because the platforms matched 37 of 61 units between them.

### Guard rails, enforced in the pure module

- **Partial coverage is loud.** If a channel fails or is unlinked, total spend
  is understated and every cost comes out too low — a CPL quietly missing Meta
  looks like an improvement. `coverage.partial` drives a banner ABOVE the
  numbers it invalidates, naming each missing channel and why.
- **Null, never Infinity or zero.** No outcomes → no rate. No spend → no rate.
  Free leads are not a $0 cost per lead.
- **A channel with no offline import is absent, not zero.** Rendering "$0 per
  sale" or "∞" would both be inventions.
- **A channel that imported the capability but matched nothing is dropped** —
  "$4,000 for 0 purchases" reads as a channel failure when it is a matchback
  failure.
- **Leads are good leads.** The bridge filters CRM BAD/DUPLICATE before push
  (~29% at one rooftop), so this cost per lead runs HIGHER than a
  cost-per-total-leads figure. Stated beside the number.
- **Revenue is transaction revenue, not gross** — so the spend ratio is labelled
  "revenue per $1 media", never ROAS.
- **No group roll-up.** Blending a Chevy store's cost per unit with a Ford
  store's describes neither.

### The trend reads the ledger, not the vendors

A single month's cost per unit is dominated by the lag between click and
delivery; the twelve-month direction is the real signal. But twelve months × 
three vendors is thirty-six API calls per page load, so the monthly series
comes from `BudgetLine` in local Postgres — one query, `lineType = 'media'`
only (counting a management fee as media would inflate cost per unit by the
retainer), and `amount`, the billed figure, which is comparable to what the
channel routes return post-margin. Raw spend is `amount × markupSnapshot` and
is never summed here; exposing it would reopen the hole Phase 2 closed. The
difference in source is stated under the chart. Accounts with unclassified
budget lines get the volume trend instead of a row of dashes.

---

## Phase 4 (shipped)

Framed as "mechanical once 2 lands". It wasn't, in two ways.

### A margin leak Phase 2 missed

`/api/reporting/google/ad-groups` — the campaign drilldown — applies margins and
returned `actual_cost` / `actual_avg_cpc` / `actual_cost_per_conversion` to any
authenticated caller with access to the account. Phase 2 filtered the three main
report routes and did not touch the drilldown.

The team lens hiding the expand chevron was NOT protection: the endpoint is
reachable directly. Now stripped on the same `ELEVATED_ROLES` gate as its parent.

Audited the rest of `/api/reporting/*` at the same time. Only one other route
touches margin — **Budget** — and it was already correct by construction:
`lib/reporting/budget-view.ts` omits every margin figure and says so in its
header, because that route admits the `client` role. No change needed.

### "Lens everywhere" would have been mostly fake

Applied where there is a real split:

- **StackAdapt** — campaign groups (how the agency organises the buy) and
  creative-level delivery (which asset to swap) are team-only; raw media cost
  for super-admins. The two-column row collapses to one when the group card is
  hidden, rather than leaving campaigns marooned beside empty space.
- **Websites (GA4)** — source/medium is team-only. Channels already answers
  "where did traffic come from" for a client; source/medium is the
  reconciliation cut where `(not set)`, self-referrals and bot traffic surface.
  A debugging tool, not a result. The GA4 property id footer went with it.

Deliberately NOT split, because the honest answer is that no split exists:
Blasts (bounce and unsubscribe rates are the client's own list health),
Reputation, Business Profile, Call Tracking, and the dealer-data reports
(Sales/Service/Retention/Heatmap/Direct Mail). Inventing team-only sections
there would have meant hiding numbers from clients for the sake of symmetry.

### A third category the lens can't express

**Ad Templates is now agency-only outright** — hidden from the nav, the tab bar,
and the route for the `client` role.

The lens answers *how much detail*; this needed *whose report is it*. Ad
Templates ranks template usage **across every account**, so showing a reduced
version to one client would still expose the shape of the agency's work for all
the others. A registry flag (`internal: true`) is the right size for that, and
`visibleReports()` now has a test — the failure mode is silent, since a new
cross-account report added without the flag would look perfectly normal while
leaking.

The route gate is separate from the nav filter on purpose: hiding a nav entry is
not a permission check when the URL is still typeable.

**Executive followed it.** It is the same category — a cross-account comparison
of every rooftop — and was rendered in every client's nav on the reasoning that
the page gates on role anyway and the nav "can't [gate] — it has no session".
The second half stopped being true the moment the sidebar started reading
`userRole` for the Digital Ads filter, so the entry is now withheld too. The
page keeps its own gate.

### Type-scale sweep

Phase 0 defined a 12px floor for data and 11px for all-caps eyebrows, then
applied it only inside the new kit. Swept the remaining fifteen `text-[10px]`
and `text-[9px]` instances across the reporting tree to that scale.

One exemption, annotated in place so a future sweep doesn't "fix" it: the
notification count in the top bar sits inside a 14px dot and overflows above
9px.

---

## Decisions (locked 2026-08-15)

1. **One report, `?view=client|team` lens.** Not separate routes. Clients are
   locked to the client lens with no toggle rendered; agency roles default to
   team with a "View as client" switch.
2. **Raw pre-margin cost is visible to `super_admin` and `developer` only.**
   Account admins work in billed dollars. This is a server-side filter in the
   report routes, not a client-side hide — the lens is presentation, and margin
   is the one field where that distinction has teeth.
3. **GA4 + Places mappings move into the DB.** `Account.ga4PropertyId`,
   `Account.googlePlaceId`, `Account.googleCompetitorPlaceIds`. Env maps stay
   readable as a fallback through one deploy, then get deleted.
4. **Tier-1 build order:** Meta placement breakdown → Meta reach/frequency →
   GA4 key events → StackAdapt video completion. Google call metrics moves to
   Tier 2.
5. **Full light/dark parity.** The reference mocks are dark-only; Loomi ships
   both and appearance settings are a shipped feature, so every token gets
   defined in both themes.
