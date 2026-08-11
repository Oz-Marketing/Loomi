# Ad Generator → paid campaign launch

Proposal for closing the last gap in the autonomous ad pipeline: turning an
approved, compliance-passed generated ad into a live Meta or Google campaign
without leaving Loomi.

Status: **Phase A in progress** (started 2026-08-05). The autonomy pipeline this
builds on has since landed on `main`, so the ⑃ marks below are historical — those
files are all on `main` now.

Phases here are lettered (A/B/C) deliberately, to avoid collision with the
autonomy pipeline's own Phase 0–4.

## Decisions settled 2026-08-05 — these supersede the text below

Read this section before the rest of the document; four things changed.

**1. There is no per-ad approver.** Connor's call: co-op pre-approves the
*template*, and every ad generated from it inherits that approval, so ads
automate end to end with no human in the path. Approval therefore moves UP to
`AdTemplateDoc` rather than disappearing — a template records who pre-approved
it, against which `AdCoopRulePack` version, and when. This supersedes the
`approvedById` / `approvedAt` fields on `AdCreative` in the Schema section, and
resolves open question 4 (two-party approval) as "neither — it's not per-ad".

Two consequences worth stating:

- Per-ad `preflight()` STAYS, and still gates. A pre-approved template can
  produce a non-compliant *ad*, because the design isn't the only input: a
  missing required disclosure field or a stale offer is data, not layout.
  Template approval covers the design; preflight covers the data.
- It unblocks `mode: 'ready'`. Today generation only marks an ad `ready` when a
  *verified* co-op pack exists, and no packs have been transcribed, so
  everything is held as a draft indefinitely. Template pre-approval is the gate
  that lets an ad reach `ready` unattended.

**2. `CREDIT` does not exist any more.** Verified against Meta's own developer
docs: `special_ad_categories` accepts `HOUSING`, `FINANCIAL_PRODUCTS_SERVICES`,
`EMPLOYMENT`, `ISSUES_ELECTIONS_POLITICS`, `NONE`. `CREDIT` was replaced by
`FINANCIAL_PRODUCTS_SERVICES` on 14 January 2025 — passing `CREDIT` now would
have campaign creation rejected. This resolves open question 1, and the answer is
yes, it applies: lease and APR ads are credit ads (any financing term beyond 90
days), and the restrictions are concrete —

| Constraint | Value |
|---|---|
| Age | fixed 18–65+, cannot narrow |
| Gender | all, cannot narrow |
| Location radius | **minimum 15 miles** (US/Canada); no zip/postal targeting |
| Detailed targeting | restricted, and **no exclusions at all** |

So `AdLaunchPreset.specialAdCategories` must be **derived from the offer type,
not set by a user** (lease/APR/anything financing → `FINANCIAL_PRODUCTS_SERVICES`),
and `geoRadiusMiles` needs a hard floor of 15 whenever it applies. Belongs in the
compliance engine next to the co-op rules, as the original text argued.

**3. One launch is one campaign containing N ads — one per creative.** Resolves
open question 3. The offer is the unit a person budgets and the pacer tracks, and
Meta's own guidance favours fewer ad sets carrying more creatives over splitting
the learning phase. So `creativeIds` stays an array and `platformCampaignId`
stays singular; only `platformAdId` changes — it becomes a JSON map of
creativeId → adId, since there is genuinely one ad object per creative.

**4. `AdLaunch`'s unique index gets vehicle scope and a status predicate.**
Resolves the two remaining defects:

- `offerFingerprint` alone reproduces the Silverado collision — one Chevrolet
  4.9%/60mo programme covers the 2500HD and the 3500HD, and each needs its own
  campaign. Key on the vehicle-scoped fingerprint (`creativeOfferKey`), not the
  bare offer one.
- A `failed` launch must not permanently block its own retry, so the uniqueness
  has to exclude terminal-failure rows: a **partial** unique index over
  `status IN ('queued','publishing','published')`. Prisma cannot express that, so
  it goes in a `scripts/ensure-adlaunch-unique.ts` step run before `db push` in
  `deploy:prepare` — exactly the pattern `ensure-adcreative-offer-unique.ts`
  already exists for, and for exactly the same reason.

**Sequencing after Meta:** budget autopilot (the Fluency doc's step 3) before
Google. Most of that work exists; what's missing is the permission layer and the
safety rails. See [fluency-comparison.md](./fluency-comparison.md).

## Where the pipeline stops today

```
MarketCheck                Loomi worker (⑃)                      Loomi UI            Meta / Google
───────────                ────────────────                      ────────            ─────────────
regional OEM  ──06:00──►  poll-offers.ts
offers                        │  OemOfferSnapshot
                              ▼
Young VLA     ──05:30──►  sync-inventory.ts
CSV feeds                     │  InventoryVehicle
                              ▼
                     06:30  generate-ads.ts
                              │  preflight + co-op rules
                              │  renderCreativeToS3
                              ▼
                          AdCreative (draft | ready)
                              │
                              │  notification: incentive_ads_ready
                              ▼
                                                            review queue
                                                                  │
                                                                  ╳ ─────────────────►  ??
                                                            HANDOFF BREAKS HERE

                                                        human opens Ads Manager,
                                                        rebuilds everything by hand,
                                                        comes back, pastes a URL into
                                                        MetaAdsPacerAd.creativeLink
```

Everything left of the ╳ is built and live-verified. Everything right of it is
manual: a digital team member reads the notification, downloads the PNGs, writes
the post copy from scratch, assembles campaign → ad set → ad in Ads Manager,
then returns to Loomi and links the result to the pacer by hand via
`/api/meta-ads-pacer/[accountKey]/discover` + `/import`.

The proposal is to make the ╳ a button.

## What already exists

The expensive parts of this project are, unexpectedly, already done.

| Need | Status | Where |
|---|---|---|
| Meta write-capable API client | **done** | `metaGraphPost` — [meta-ads.ts:160](../src/lib/integrations/meta-ads.ts) |
| Meta token carries `ads_management` | **proven in prod** | `pushAdSetDailyBudget` writes budgets today |
| Google write-capable API client | **done** | `pushCampaignDailyBudget` → `campaignBudgets:mutate` — [google-ads.ts:192](../src/lib/integrations/google-ads.ts) |
| Google developer token has Standard access | **proven in prod** | same — mutate against live customer accounts works |
| Per-account platform identity | **done** | `Account.metaAdAccountId`, `Account.googleAdsCustomerId` |
| Platform-shaped ad copy types | **done** | `MetaCaption`, `GoogleCaption` + correct char limits — [copy-types.ts](../src/lib/ad-generator/copy-types.ts) |
| Copy generation service | **done** | `POST /api/ad-generator/copy` → `generateAdCopy` |
| Creatives persisted with stable URLs | **done** ⑃ | `renderCreativeToS3` — deterministic S3 keys, same creative overwrites |
| Placement-correct sizes | **done** | 1200×628, 1080×1080, 1080×1350, 1080×1920 — [ad-size-catalog.ts](../src/lib/ad-generator/ad-size-catalog.ts) |
| Durable job runner + heartbeat convention | **done** ⑃ | five `loomi.adgen.*` pg-boss queues, `AdAutomationRun` |
| Compliance gate | **done** ⑃ | `preflight()`, `coop-rules.ts`, versioned `AdCoopRulePack` |
| Loomi row ↔ live platform object linkage | **done** | `MetaAdsPacerAd.metaObjectId` / `.googleCampaignId` |

Two consequences worth stating plainly, because they're what make this a weeks
project rather than a quarters project:

**No new platform access is required.** Not a new Meta app, not a new OAuth
consent screen, not a Google API access-level upgrade. Both integrations already
mutate production objects. The usual long pole is gone.

**The copy contract was designed for this before there was a reason to.**
`MetaCaption` is `{ primaryText, headline, description }` at Meta's 125/40/30
limits; `GoogleCaption` is `{ headlines[], descriptions[] }` at 30/90. That is
the launch payload, already modelled, already generated, already enforced.

## What's missing

Five gaps. Only one is architectural.

### 1. There is no approval state

`AdCreative.status` is `draft | ready` and nothing else. `ready` is being used to
mean *approved* — `expire-ads.ts` logs "approved ad(s) DEMOTED to draft" — but
there is no `approvedById`, no `approvedAt`, and no reviewer-facing queue. The
automation panel (`shadow-panel.tsx` ⑃) is diagnostics, not review.

That's fine while the output is a PNG somebody looks at. It stops being fine the
moment a click in Loomi commits budget. **Approval attribution is the actual
precondition for the entire feature**, not a nicety: "who approved the ad that
spent $4,000 on a lease payment that expired" has to have an answer that isn't
"the cron job".

### 2. Auto-generated ads have no copy

`generate-ads.ts` ⑃ renders the image and stops. It never calls
`generateAdCopy`. So today an approved autonomous ad has pixels and no words —
and both platforms require text (Meta: primary text + headline; Google Demand
Gen: 3+ headlines, 2+ descriptions).

This is the largest missing piece by user-visible impact and one of the smallest
by effort, because the service, the types, and the limit enforcement all exist.
It is wiring, not design. Note it needs the same treatment as the rest of the
pipeline: copy is generated once and **persisted on the creative**, not
regenerated at launch time, or two launches of the same ad say different things.

### 3. No Facebook Page ID — anywhere in the codebase

Grepped: `page_id` does not exist outside landing-page internals. We store the
ad *account* but not the Page.

A Meta ad creative cannot be created without `object_story_spec.page_id`. This
is a hard blocker on Phase B. Also absent, and wanted for anything beyond
traffic campaigns:

- Instagram actor ID (IG placements)
- Pixel ID + the conversion event to optimize toward

Small schema change; needs a per-rooftop discovery-and-confirm step, since
picking the wrong Page for a 38-rooftop group publishes a Ford store's ad from
the Chevy store's Page.

### 4. No campaign-shape model

A creative implies nothing about objective, geo radius, bid strategy, audience,
budget, flight, or destination URL. Without a per-account **launch preset**, a
"launch" is a twelve-field form and nobody will use it twice.

### 5. Google's shape is genuinely different — and this is the one that bites

The generator emits **static PNGs**. Therefore:

- **Search is out.** Responsive search ads are text-only. The creative is unusable.
- The real fits are **Demand Gen**, **Display**, or feeding assets into an
  existing **Performance Max** asset group.
- Creating a Demand Gen campaign via API means `assets:mutate` per image, plus a
  logo asset, plus campaign → campaign budget → ad group → ad group ad, with
  per-format aspect-ratio requirements enforced server-side by Google.

Rough multiplier: **~2.5× the Meta effort for less value on the first pass.**
Hence the phasing below puts Google last and starts it as asset-injection rather
than campaign creation.

## Design

Four decisions that should be locked before code.

### Always create PAUSED

Both platforms allow creating a full structure with `status: PAUSED`. Loomi
creates it, reports "created and paused", and deep-links to Ads Manager. A human
flips it live — either in Ads Manager or via a second, explicit **Activate**
click in Loomi.

This is the correct risk posture and it is not a compromise. The twenty minutes
of tedious assembly is the part worth automating; the one irreversible decision
that starts spending money is the part worth keeping human. It also means a bug
in v1 produces a wrong *paused* campaign, which is an annoyance, not an
incident.

### Back-link to the pacer at creation time

The moment the Meta campaign is created, write the `MetaAdsPacerAd` row with
`metaObjectId` already populated, `flightStart`/`flightEnd` from the launch, and
`allocation` from the preset.

**This is the actual product.** Ads Manager can create a campaign; it cannot
create a campaign that is already pacing-instrumented, already reconciled to the
month's `MetaAdsPacerPeriodBudget`, and already owned by a named rep. Today
`MetaAdsPacerAd.creativeLink` is a URL somebody pastes and `discover`/`import`
is a cleanup step run later; this closes the loop at the source.

For Google the equivalent is a row with `platform: 'google'` +
`googleCampaignId` + `googleBudgetResourceName`.

### Re-run preflight at launch, not just at generation

Co-op packs are versioned and reissued (`AdCoopRulePack.version`,
`AdGuidelineDoc` change watching). An ad approved three weeks ago against a
since-revised Chevrolet pack must not launch silently.

So the launch path calls `preflight()` again with the *current* pack and blocks
on `severity: 'error'`. `AdCreative.coopCheckedVersion` already records what was
checked at generation; the launch compares against what's on file now and
surfaces the drift. This costs almost nothing — `preflight()` is pure — and it is
the difference between a compliance engine and a compliance decoration.

### Idempotency needs its own table

`AdCreative`'s `@@unique([accountKey, templateId, offerFingerprint])` protects
*generation*. It does nothing for *publishing*. A network timeout on the Graph
call followed by a retry creates two campaigns spending two budgets.

The `AdLaunch` row below carries the uniqueness constraint, written **before**
the first platform call and transitioned as it progresses. Same lesson as the
Silverado fingerprint collision: any table keyed on an offer needs scope, and
any table fronting a side effect needs the row to exist before the effect.

## The Loomi destination (optional, per account)

An ad needs somewhere to land. The default is the dealer's own site. But because
the inventory feed is already synced and normalized, Loomi can build the
destination too — and for an offer ad specifically it can build a *better* one
than a generic dealer SRP.

**Decision: not requiring the click to land on the dealer's OEM website is
accepted.** Some co-op programmes may prefer or require it; that risk is taken
knowingly, and the prominent **Visit dealer website** button (below) is what
keeps it defensible. Not revisited in this doc.

### Why this is worth building rather than just linking out

The offer→inventory match already exists — `inventory-match.ts` ⑃ is what decides
an offer has enough qualifying stock to advertise. That means the landing page
can show **exactly the units the offer applies to**:

> 2026 Silverado 1500 — $299/mo for 36 months — *and here are the 14 in stock
> that qualify, with photos and payments.*

That is a materially better paid destination than either a static offer page or a
dealer SRP the visitor has to re-filter themselves. It is also not something the
dealer's website vendor can easily produce, because the vendor doesn't know what
the OEM offer is.

Three further advantages, all of which follow from owning the page:

- **The pixel is a form field.** `LandingPage.metaPixelId` / `ga4MeasurementId` /
  `gtmContainerId` are per-page and render server-side as the vendor snippet, so
  conversion-optimized campaigns work on day one instead of waiting on a ticket
  to Dealer.com / DealerOn / Sincro.
- **Ad and page are compliant as a pair.** The creative's disclaimer is resolved
  from `AdDisclaimerTemplate` through the co-op engine. The LP renders the *same*
  resolved disclaimer from the *same* offer data, so the ad and its destination
  can't drift into contradicting each other — which is the actual co-op exposure.
- **Leads land in the dealer's CRM.** `embedded_form` → `FormSubmission` →
  Contact → `CrmDestination` / ADF delivery already works end to end.

### What gets built

Three surfaces, composing rather than duplicating:

| Surface | Route | Content |
|---|---|---|
| Offer LP | `/lp/[slug]` | Hero with the offer + resolved disclaimer, the qualifying-inventory grid, embedded lead form, **Visit dealer website** button |
| Inventory SRP | same LP, `?` filters | Filterable grid: condition, make, model, year, price band, body style, trim |
| VDP | `/lp/[slug]/v/[vin]` | Photos, spec, payment, lead form, **View on dealer site** → the vehicle's own `detailUrl` |

The VDP being a **child route of the LP slug** is deliberate. It inherits the
parent LP's domain, branding, header/footer snippets, pixels, and `LpTracker`
mount for free — so there is no second configuration surface, and attribution
keeps working because `LandingPageEvent.pageId` stays the parent LP.

### Two new block types

```
| 'inventory_grid'    // queries InventoryVehicle at render time; props carry the
                      // filter (offer-scoped, or open with facets) + card layout
| 'vehicle_detail'    // renders one VIN; only valid on the /v/[vin] child route
```

Adding block types is a well-worn extension point — there are 18 already — and a
block that **resolves data at render time** is not new either: `snippet` expands
an `AccountSnippet`'s blocks inline, and `embedded_form` resolves a `Form` by id.
`inventory_grid` follows the same pattern against `InventoryVehicle`.

What *is* new is that `LandingPage.schema` has so far described a **static,
single-URL** document. An SRP with facets and a VDP per VIN are parameterized and
multi-URL. That's the one genuinely architectural piece of this section, and the
child-route approach above is how it's contained — the LP row stays one row, and
the dynamism lives in two blocks and one route segment.

### The "Visit dealer website" button

Not a footnote — it's the thing that makes a Loomi destination palatable to a
dealer who is (reasonably) protective of their own site traffic.

`InventoryVehicle.detailUrl` is per-VIN, so on a VDP the button deep-links to
**that vehicle's page on the dealer's own site**, not a generic homepage bounce.
`Account.website` is the fallback for the offer LP and for rows with no
`detailUrl`. Both should be tracked as `cta_click` so the split between
"converted on the Loomi form" and "handed off to the dealer site" is measurable
rather than assumed.

### Default to noindex

Inventory pages default `LandingPage.noindex = true`. These are paid-traffic
destinations, not organic ones, and that single default removes the entire
duplicate-content / "Loomi is cannibalizing my own SEO" objection before a dealer
raises it. The field already exists and already excludes the page from
`/lp-sitemap.xml`.

## Schema

```prisma
// Account — additive, all nullable
model Account {
  metaPageId              String?  // object_story_spec.page_id — REQUIRED to create a Meta creative
  metaInstagramActorId    String?  // IG placements
  metaPixelId             String?  // conversion optimization
  metaDefaultConversionEvent String?
  googleConversionAction  String?  // resource name
}

// AdCreative — additive
model AdCreative {
  approvedById   String?
  approvedByName String?
  approvedAt     DateTime?
  // AdCopyVariation JSON (fields + meta + google), generated once and frozen.
  copy           String?  @db.Text
}
```

```prisma
/// Per-account campaign shape, so a launch is one click and not a form. One row
/// per (account, platform) — a rooftop's Meta launches all look alike; the
/// variation that matters is the offer, and that comes from the creative.
model AdLaunchPreset {
  id         String  @id @default(cuid())
  accountKey String
  platform   String  // "meta" | "google"

  objective       String  // OUTCOME_TRAFFIC | OUTCOME_LEADS | ...
  specialAdCategories String @default("[]") // JSON string[] — see open question 1
  bidStrategy     String?
  dailyBudget     String?
  flightDays      Int     @default(30)

  // Geo. Radius has a platform floor when a special ad category applies.
  geoZip          String?
  geoRadiusMiles  Int     @default(25)
  audienceSpec    String? @db.Text // JSON — saved audiences / interests

  // ── Destination ──
  // Three modes, per account:
  //   dealer_site  — urlTemplate points at the dealer's own SRP/VDP (no LP built)
  //   loomi_lp     — build a Loomi offer landing page and point the ads at it
  //   loomi_lp_inventory — offer LP + live inventory SRP/VDP (see below)
  destinationMode String  @default("dealer_site")
  // Used when destinationMode = dealer_site. Supports {{make}} {{model}} {{year}}
  // so one preset covers every model without a row per nameplate.
  urlTemplate     String? @db.Text
  // Used when a Loomi LP is built: which LP template to clone, and which Form to
  // embed for lead capture. Null form = no lead capture (traffic-only page).
  lpTemplateId    String?
  lpFormId        String?
  utmSource       String?
  utmMedium       String?
  utmCampaign     String?

  // Which rendered sizes feed which placement set.
  sizeIds         String? @db.Text // JSON string[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([accountKey, platform])
}

/// One publish attempt. Written BEFORE the first platform call, so a retry finds
/// the in-flight row instead of creating a second campaign. Mirrors the
/// AdAutomationRun convention: a row exists for every attempt including failures,
/// because a launch that silently didn't happen is the failure mode that matters.
model AdLaunch {
  id         String @id @default(cuid())
  accountKey String
  platform   String // "meta" | "google"

  // The creatives being launched (JSON string[] of AdCreative ids) and the
  // offer they advertise. The fingerprint is what makes the unique index below
  // meaningful: one launch per offer per platform per account.
  creativeIds      String  @db.Text
  offerFingerprint String?

  // queued | publishing | published | failed | cancelled
  status String @default("queued")

  // Frozen copy of the resolved preset + copy + creative URLs at launch time, so
  // "what exactly did we publish" survives later preset edits.
  payload String? @db.Text

  // Platform result. Populated as each object is created, so a partial failure
  // is diagnosable and cleanable rather than opaque.
  platformCampaignId String?
  platformAdSetId    String?
  platformAdId       String?
  platformImageHashes String? @db.Text // JSON — Meta adimages hashes / Google asset resource names

  // The pacer row created by the back-link, for round-tripping.
  pacerAdId String?

  requestedById   String?
  requestedByName String?
  startedAt       DateTime  @default(now())
  finishedAt      DateTime?
  error           String?   @db.Text

  @@unique([accountKey, platform, offerFingerprint])
  @@index([accountKey, status])
}
```

## API surface + worker

Publishing renders, uploads, and makes 5+ sequential platform calls. That's well
past a request timeout and must not be retried by a browser, so it goes through
pg-boss like the rest of the pipeline.

| Route | Method | Does |
|---|---|---|
| `/api/ad-generator/creatives/[id]/approve` | POST | Sets `status: ready` + approval attribution. Re-runs `preflight()` against the current co-op pack and refuses on `error`. |
| `/api/ad-generator/launch-presets/[accountKey]` | GET/PUT | Read/write the per-platform preset. |
| `/api/ad-generator/launch/meta-assets/[accountKey]` | GET | Discovery: lists Pages, IG accounts, pixels the token can see, for one-time confirmation into `Account`. |
| `/api/ad-generator/launch` | POST | Creates the `AdLaunch` row (`queued`) and enqueues. Returns the launch id — never blocks on the platform. |
| `/api/ad-generator/launch/[id]` | GET | Poll status for the UI. |
| `/api/ad-generator/launch/[id]/activate` | POST | The explicit un-pause. Separate route, separate permission, separate audit entry. |
| `/api/inventory/[accountKey]/search` | GET | Public, cached. Backs `inventory_grid` facets + pagination. Excludes `soldAt != null`. |
| `/api/inventory/[accountKey]/[vin]` | GET | Public, cached. Backs `vehicle_detail`. 404s on a sold VIN. |

New queue `loomi.adgen.publish`, **event-driven, not scheduled** — the existing
five adgen queues are cron'd (05:00–07:00 UTC chain); this one fires on demand,
the way form→CRM delivery already does.

## Phasing

| Phase | Scope | Platform writes | Rough effort |
|---|---|---|---|
| **A** | Approval state + attribution; reviewer inbox; generate + persist copy at generation time; launch presets; Page/pixel discovery; **Launch Kit export**; auto-create the pacer row | none | ~1–1.5 weeks |
| **B** | Meta one-click, paused: `adimages` → `adcreatives` → `campaign` → `adset` → `ad`; back-link to pacer; activate route | Meta | ~1–1.5 weeks |
| **C** | Google: assets into an existing Demand Gen / PMax asset group first; net-new campaign creation only if wanted after | Google | ~2–3 weeks |
| **D** | Loomi destination: offer LP auto-build, `inventory_grid` + `vehicle_detail` blocks, VDP child route, photo handling, dealer-site buttons | none | ~3–4 weeks |

Effort is rough and assumes the autonomy branch has landed on `main` first.

**Phase D is the largest item here — bigger than A and B combined.** An SRP with
facets, a VDP, photo handling, mobile layouts, and a compliant price display is a
product in its own right, not a flag on the launch flow. It also has **zero
platform-write risk**, so it parallelizes cleanly with B and C and can be worked
by whoever isn't in the Graph API. It does not block the launch feature: shipping
A + B with `destinationMode: dealer_site` is a complete, useful product, and D
upgrades the destination later without reopening any of it.

A cheaper intermediate exists if D looks too heavy: build the **offer LP only**
(hero + resolved disclaimer + form + dealer-site button, no inventory blocks).
That's ~1 week, gets the pixel and the ad/page disclaimer pairing, and defers the
whole SRP/VDP question.

**Phase A is worth shipping on its own merits.** The Launch Kit — correct-size
PNGs, copy pre-fitted to each platform's character limits, a targeting sheet from
the preset, and the UTM'd destination URL, as one download — removes most of the
manual time with **zero platform-write risk**. It is also an honest prerequisite
for B and C, so it is not throwaway scaffolding. If B slips or gets vetoed,
A still stands.

**Phase C starts with asset-injection deliberately.** For a monthly OEM offer
cadence, dropping fresh creative into an existing, proven Demand Gen campaign is
arguably *more* valuable than spinning up a cold campaign every month —
established account structures, no learning-phase reset, no budget fragmentation.
Net-new campaign creation is the optional follow-on, not the goal.

## Open questions

**1. Does Meta's `CREDIT` special ad category apply to lease/APR offer ads?**
Meta restricts targeting for ads promoting credit opportunities — no age/gender
targeting, and a minimum geo radius. Dealer APR and lease-payment ads plausibly
qualify. **This needs verifying against current Meta policy before Phase B, not
taken on faith**, because if it applies it constrains `AdLaunchPreset.geoRadiusMiles`
and `audienceSpec` and belongs in the compliance engine next to the co-op rules —
rather than being discovered when a campaign gets rejected. Resolve during Phase A.

**2. Which Google campaign type?** Demand Gen is the best creative fit for the
sizes already rendered. Display uploaded-ads would use the 300×250 / 728×90
family in the size catalog but performs poorly and is fiddly to assemble. PMax
asset-group injection is the lowest-risk entry. Needs a call on what the digital
team actually runs today.

**3. Who owns Page → sub-account mapping, and how is it verified?** 38 rooftops,
multi-brand groups, and a wrong Page means a store's ad published under another
store's brand. Discovery route plus explicit human confirmation per rooftop, with
the confirmation recorded — not a bulk auto-match.

**4. Does approval need to be two-party?** The pacer already models
`internalApproval` + `clientApproval` separately. If co-op reimbursement or a
dealer principal's sign-off matters, `AdCreative` needs the same split rather
than a single `approvedById`. Cheaper to decide now than to migrate.

The remaining three are Phase D only, and all three are load-bearing — none is a
detail to settle during implementation.

**5. Vehicle photos: hotlink or cache?** `InventoryVehicle.imageUrls` holds the
dealer's vendor CDN URLs. Hotlinking is free and works today, but vendors rotate
and expire URLs, some block off-domain referers, and a sold VIN's photos vanish —
so a page can silently degrade to broken images. Caching to S3 is robust and gives
proper `next/image` optimization, but adds storage, a sync job, and a cache-
invalidation problem across ~38 rooftops of inventory. Suggested: hotlink with a
placeholder fallback in v1, measure the breakage rate, cache only if it's real.

**6. Feed freshness is 24h — is that good enough for a public page?**
`sync-inventory` runs daily at 05:30 UTC, which is fine for *generating an ad* and
questionable for *serving a shopper*. A sold car showing as available is a bad
experience and, depending on how the price is presented, arguably an advertising
problem. Dealer websites refresh several times a day. Mitigations, cheapest first:
hide `soldAt` rows the instant sync sets them; add "call to confirm availability"
to the VDP; raise sync cadence (2–4×/day) for accounts with inventory pages
enabled. The cadence bump is the only real fix and it's cheap — the feeds are
small CSVs.

**7. Price display is a new compliance surface.** This is the one to take
seriously. A page showing `price` / `msrp` **is advertising**, and it's governed by
state advertising law and OEM guidelines — doc fees, "excludes tax, title, and
license", required disclosure language. Today the co-op engine governs the
*creative*; an inventory page displaying prices would be a second advertising
surface with none of that protection.

The right answer is to route it through the machinery that already exists rather
than inventing a parallel one: a **required disclaimer block** on any page with an
`inventory_grid` or `vehicle_detail`, populated from `AdDisclaimerTemplate` and
checked by `preflight()` before the LP can be published. That reuses the engine,
keeps one source of truth for disclosure language, and means the page can't go
live without it. **Phase D should not ship without this** — it would be the only
place in the product where Loomi publishes prices with no compliance gate.

## Not in scope

- **Video.** The generator renders PNGs. Meta Reels / YouTube need video assets
  and a different render pipeline entirely.
- **Ongoing optimization.** Loomi launches and paces; it does not bid-manage.
- **Editing live campaigns.** Beyond the existing budget push, launched campaigns
  are edited in Ads Manager. Two-way structural sync is a much larger project and
  a much larger blast radius.

## The direction beyond this

With Phase D in scope, the landing page stops being the far horizon and the
remaining gap is the container. `AdCreative.campaignId` is already reserved for a
`Campaign` link, and `Campaign` already aggregates `emailBlasts`, `smsBlasts`,
`landingPages`, `forms`, and `flows`.

So the end state is:

> regional offer arrives → ads generated → offer LP + inventory pages built →
> paid campaigns created against them → planner rows created → pacing live →
> email and SMS built from the same offer, pointed at the same page

all as one `Campaign` row, from one OEM programme, with one disclaimer resolved
once and used everywhere. A + B + D gets the paid half of that; the email/SMS half
is a matter of pointing the existing campaign generators at the same offer data.

Nothing in this proposal forecloses it, and the phasing deliberately builds toward
it rather than around it. But it is still a separate piece of work — so:
**direction, not next step.**
