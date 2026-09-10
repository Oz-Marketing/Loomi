# Ad Generator — offer fan-out

Spec for reshaping autonomous generation from "one offer, one template, one ad"
into "every live offer × every published template, dealer picks."

Status: **engine + pick surface built on current `staging`, 2026-09-03.**
Decisions below are Connor's calls from the design conversation on that date.

`npm run verify` and `npm run test` (3,757) both green. Nothing pushed.

| Piece | Where |
| --- | --- |
| Variant planning — fan-out, offer dedupe, dual pairing, preview size, group key, expiry | `src/lib/ad-generator/automation/plan-variants.ts` + 32 tests |
| Generation builds every variant | `src/lib/ad-generator/automation/generate-ads.ts` |
| Per-variant skip reasons | `src/lib/ad-generator/automation/skip-reasons.ts` |
| One row per offer in the companion email | `src/lib/ad-generator/automation/generate-offer-email.ts` |
| `offerGroupKey` / `recommended` / `selectedAt`, `maxVehiclesPerRun`, `current_month`, `expandOfferTypes` on | `prisma/schema.prisma` |
| Move existing accounts onto both new defaults | `scripts/backfill-adgen-fanout-defaults.ts`, wired into `deploy:prepare` |
| Persisted dual mode | `TemplateDoc.dualVehicleMode` |
| Measure OEM publication lead times | `scripts/report-oem-lead-times.ts` |
| Fold the ad list into offer groups | `src/lib/ad-generator/variant-groups.ts` + 11 tests |
| Compare and pick a design | `src/components/ad-generator/variant-compare-modal.tsx` |
| Pick: mark, archive siblings, render deferred sizes | `src/app/api/ad-generator/creatives/[id]/select/route.ts` |
| Read one whole group, archived designs included | `?group=` on `/api/ad-generator/creatives` |
| Lifecycle stages and the waiting/settled split | `src/lib/ad-generator/ad-lifecycle.ts` + 11 tests |
| Tell the account's own users their offers are ready | `notifyClients` in `generate-ads.ts` |
| Mirror the run's offer email into the list | `/api/ad-generator/generated-emails` + `GeneratedEmailCard` |
| Record that a person changed the offer values | `src/lib/ad-generator/offer-edit.ts` + 14 tests, `AdCreative.offerEditedAt` |

Exercised end to end in the browser against seeded fan-out data: group folds to
one card, compare shows every design with the recommendation marked, picking
archives the siblings and reports the deferred render honestly, and undo restores
them. Three defects were found and fixed that way and would not have shown up in
tests — see "Found by looking" below.

**Still to build:** the generate-on-new-offers trigger from decision 5, and the
builder control that writes `dualVehicleMode`. Neither blocks the loop: without
the trigger the nightly job still runs, and `dualVehicleMode` defaults to `same`,
which is the common case.

## Who hears about a run, and what the list separates on

**Notifications.** `notifyReviewers` reaches Oz staff — `notifyUserIds`, else the
account rep, else admins. `notifyClients` (added 2026-09-03) reaches the client
users assigned to the account, so the people whose ads these are learn that the
month's offers were built instead of having to go looking. It counts OFFERS, not
ads: several designs for one offer are one decision, and "12 new ads" overstates
the ask.

**In-app only, deliberately.** `createNotification` emails only when
`sendEmailNow` is set, and it is not set here. This fires on every run that
produces anything, and turning that into dealer email unasked is how a useful
feature becomes a complaint. Per-user `NotificationPreference` still applies.
`accountScope: 'all'` is NOT treated as "notify about everything" — only an
explicit assignment in `accountKeys` counts, or one all-scope client would hear
about every account's offers.

**One pill per card.** The chip row had grown to five — status, offer kind,
stage, Auto, Edited — and at 9px uppercase they read as a wall rather than as
five facts. Stage is the only one that changes what you do next, so it keeps the
pill; the rest moved to the muted line beneath it. `status` went entirely:
`draft` is what "Needs approval" and "Needs a pick" already mean, so the card was
giving the same answer twice.

**The Ad Generator list is staff-only** (2026-09-04). It renders one flat grid:
staff want the whole working list in one place, and banding it splits a working
set over a distinction they are not making.

**A client's home is Campaigns.** The list page redirects the client tier to
`/campaign-builder`. The reason is that a run's ads and its offer email are one
deliverable — same offers, same disclaimer, one `Campaign` row — and the Ad
Generator can only ever show the ad half. An earlier pass built the client a
stage-banded layout here (Waiting on you / Approved / Running, each run framed,
the offer email inside the frame) and it was replaced rather than kept: banding
by stage splits one campaign across up to three sections, so the email sat under
"Waiting on you" while the ads it shipped with sat under "Approved".

On Campaigns the client sees:

- the campaign list, filtered to `source = 'automation'` server-side by
  `listCampaigns({ automationOnly })` — never a UI filter, see CLAUDE.md;
- the detail's **Everything** tab, default whenever a campaign spans more than
  one medium, with the ads and the email in one scroll under their own headings;
- `CampaignOfferDesigns` in place of the flat ad tiles: one tile per OFFER rather
  than per design, with "Compare N designs" where the fan-out produced a choice.

Create, archive and delete are hidden from the tier, and `/campaign-builder/new`
stays `AdminOnly`. Picking a design there settles the email too — see below.

Stage also lives in the Filters panel as a multi-select, for both audiences —
multi-select rather than segmented because the stages are not alternatives:
"everything still waiting on me" is two of them at once.

**Four stages, one chip.** `ad-lifecycle.ts` places each offer group as
`running` → `approved` → `needs_pick` → `needs_approval`, in that precedence.
`running` outranks everything because it is a fact about the world, not a state
of ours; `needs_pick` outranks `needs_approval` because picking is the first
action and approving a design that may be discarded is wasted effort. The list
opens on **Waiting on you** — after the fan-out most of an account's list is
machine-made, and a wall of already-live ads buries the few asking for a
decision. It falls back to All when nothing is outstanding, so a caught-up
account doesn't open on a blank page reading as "you have no ads".

Note `running` comes from `AdLaunch.creativeIds`, a JSON array rather than a
relation — so it cannot be joined and is resolved with one extra query per list
request. A malformed row reads as not-live, which understates: the worst case is
an ad shown as needing attention when it doesn't.

## Ads and the offer email are one run, and the Campaign already says so

A generate run produces two things: the ad designs and the companion offer
email. `generateOfferEmail` **already creates a `Campaign` container and stamps
`campaignId` onto both** the blast and every `AdCreative` in the run — the link
`AdCreative.campaignId` was reserved for. Nothing surfaced it, so a client saw
the ads and had no idea an email was waiting on a page they may never open.

The fix is to mirror, not to move. The list shows the email as one more generated
item, in the same stage bands, with an envelope instead of a thumbnail — and
opening it goes to the real editor under Emails & SMS. The Ad Generator answers
"what did this month's run make for me"; Campaigns remains where the email is
actually worked on. Building a second campaign surface here would duplicate
ownership of a record that already has a home.

`EmailBlast.automationKey` is the filter — set only by the offer-email generator,
so it separates machine-made from hand-built without walking the campaign's
source. Note `EmailBlast.accountKeys` is a JSON array, so the account filter
happens in memory over a bounded `take`, not in the query.

### The container now actually knows about ads (2026-09-03)

Three things were wrong, and all three had the same root: `AdCreative.campaignId`
was a bare scalar commented "reserved — future Campaign channel link" long after
`generateOfferEmail` started writing real campaign ids to it.

1. **No relation.** Every other asset has `campaign Campaign? @relation(...)` and
   a back-reference on `Campaign`. Ads had neither, so Prisma could not include
   them and a run displayed as an email with no ads. Also no FK, so deleting a
   campaign stranded the id instead of nulling it. Now a real relation with
   `onDelete: SetNull`, plus `@@index([campaignId])` — Postgres indexes no FK on
   its own, and "which ads belong to this run" is the query the view is built on.
2. **`CampaignSource` was `'ai' | 'manual'`**, while generation writes
   `'automation'`. `toDetail` casts the column with `as CampaignSource`, so the
   type never objected, and a two-way `source === 'ai' ? 'AI' : 'Manual'` check
   labeled every OEM run **Manual**. The union now names the third value and
   `CAMPAIGN_SOURCE_LABEL` keeps the two display sites from disagreeing.
3. **`CampaignAssetKind` was an alias for `CampaignChannel`.** It is now a
   superset — `CampaignChannel | 'ad'`. Ads deliberately are NOT a channel: a
   channel is something the AI planner knows how to produce, and it does not plan
   ads. They arrive the other way round, from a run that creates the container
   itself, so they must stay out of `PHASE_1_CHANNELS`.

Archived designs are filtered out of the count in `collectAssets` — the fan-out
builds a design per template and archives the losers, so counting them would
report a run that yielded one usable ad as having produced six.

`scripts/ensure-adcreative-campaign-fk.ts` adds the constraint before the
deploy's guarded `db push` (which runs without `--accept-data-loss`), nulling any
orphaned `campaignId` first so the FK can validate. Idempotent; wired into both
`deploy:prepare` and `db:sync`.

**If this grows past the offer email** — more generated asset types, or a need to
act on the run as a unit — the Campaign container is the seam to build on, not a
third list. It already holds exactly the right membership.

## Clients adjusting an offer

A client may take the manufacturer's offer as generated or adjust it, without
touching the design. That capability already existed and needed no building:
`/ad-generator/[id]` is the form-and-preview editor while `/ad-generator/builder`
is the design tool, and the "Edit design" link between them is `isManager`-gated
— *"The builder is a design tool — managers only. Clients never leave the form +
preview."* Fields are shown by a designer-set `isClientField` marker, and the
offer inputs render inside the OEM Incentive / Manual entry panel, which is
exactly "use the manufacturer's offer or type your own".

**Preflight already re-runs on every edit** (`compliance-panel.tsx`, debounced
700ms) and feeds `coopBlocking`, which disables both export buttons while a
manufacturer rule is broken. Stronger than merely re-checking: the output is
blocked.

**What was missing was provenance.** Nothing recorded whether an ad's numbers
came from the manufacturer or from a person. `_oemApplied` looks like it answers
that and does not — written once at generation, read by nothing but its own
tests. So `AdCreative.offerEditedAt` is the data-side twin of `docEditedAt`:

- Set only when an offer-bearing field actually changes (`offer-edit.ts`), not on
  every autosave — the form posts the whole blob as you type, the same trap
  `docEditedAt` avoids by hashing the design.
- Only on generated ads. A hand-built ad never claimed to state OEM terms.
- **Demotes `ready` → `draft`.** Approval was granted against the manufacturer's
  numbers; riding it after they change is what `expire-ads` already refuses to do
  when an offer dies.
- Leaves a review note naming the changed fields, so the reason travels with the
  ad instead of a reviewer diffing two screens.

An EVENT rather than derived state, deliberately: edit a payment and change it
back, and a comparison against the OEM snapshot reports "unedited" while the
honest answer for compliance is that a person has been in here.

### Fixed in passing: the offer email lost all its OEM prose

`AdCreative.offerFingerprint` is a COMPOSITE (`vehicle-slug:print[+print]`);
`OemOfferSnapshot.fingerprint` is the bare hash. `generateOfferEmail` looked its
incentives up with the composite, matched nothing, and every offer email shipped
without the manufacturer's **program name, description, offer details and
eligibility text** — silently, since the disclaimer comes from elsewhere and the
email still sent.

This predates the fan-out: the old `creativeOfferKey(g, offerFingerprint(inc))`
produced the same composite shape. `GeneratedAd` now carries the bare prints in
`offerPrints`, which cannot drift the way parsing the composite string back apart
would.

## Found by looking, not by tests

Three things the type checker and 3,723 unit tests all passed, caught by opening
the page:

1. **Every design in the compare view read "Untitled ad".** The label came from
   the ad's own doc snapshot, and siblings share a name by design — they
   advertise the same offer. It has to come from the SOURCE template, which is
   the only thing that differs. Telling variants apart is the screen's entire
   job, so this made it useless.
2. **Card content was clipped.** The compare grid is a flex child with a definite
   height, and each card sets `overflow-hidden` for its rounded thumbnail, which
   drops the card's min-content contribution to zero and lets the row compress.
   The design name and its button were cut off. Fixed with `auto-rows-min` +
   `content-start`.
3. **A picked group became unreviewable.** Picking archives the siblings, they
   drop out of the list query, the group collapses to one, and with it went the
   "In use" chip and any route back to undo. The chip now keys on `selectedAt`
   itself, the button becomes "Change design", and the modal re-fetches the whole
   group by key with archived designs included.

## How this composes with `expandOfferTypes`

`expandOfferTypes` (shipped 2026-08-17) already fans out across OFFERS: the best
offer of each type rather than only the best overall. This work fans out across
TEMPLATES. They are orthogonal axes and both are needed for the full grid.

It shipped **off** for one reason, stated in its own commit message: expansion
produced ~30 ads against an ad-counted `maxAdsPerRun` of 10, and the cap "would
truncate to an arbitrary subset." `maxVehiclesPerRun` removes that objection
exactly — the cap falls on a vehicle boundary, so expansion can never leave a
vehicle half-built. **The flag is kept and now defaults on**; `false` still means
something useful, namely recommended-offer-only as a lean mode.

Its dedupe rule is the one that survived. `offersToFanOut` takes the best offer of
each TYPE, not every eligible offer: a vehicle routinely carries several lease
programs differing only in term, and without the dedupe each would become its own
design through every template — the dealer choosing between near-identical ads
instead of real alternatives.

The work list it introduced is what made this integration small. `WorkItem` was
already one entry per AD, built up front "so the 450-line build below doesn't have
to know anything about it." Carrying a template and a second offer on that item
was most of the change.

## The change in one line

Today an OEM offer produces exactly one ad, because generation narrows twice —
`selectOffer` picks one offer per vehicle and `resolveAutomationTemplate` picks
one template per offer. Both narrowings become *rankings*: everything is
generated, the winner is flagged as recommended, and the dealer chooses.

## Why the schema already supports this

`AdCreative` is keyed `@@unique([accountKey, templateId, offerFingerprint])`.
`templateId` is already in the key, so N templates against one offer are N
legitimately distinct rows. **No migration is needed for the fan-out itself, and
idempotency is preserved** — a re-run still updates each variant in place.

This is worth stating plainly because it inverts the warning in
`resolve-automation-template.ts`. That file argues determinism is a correctness
requirement *because* a rotating template choice would miss the constraint and
mint duplicates. That argument holds only while resolution picks one template.
Once every candidate is generated, there is nothing left to rotate — the
constraint is satisfied by construction.

## Decisions settled 2026-09-02

**1. Template set: no change to `templatesForAccount`.** Published + active, in
scope for the account. Globals (unowned, unshared) are **included**; other
dealers' templates are excluded. No opt-in flag, no new config column. The
existing function already expresses exactly this rule and every surface already
agrees on it.

**2. Offers: all live offers get the full fan-out.** `selectOffer`'s winner is
marked as the recommended variant rather than being the only one built. The UI
leads with the recommendation and puts the rest one click away.

**3. `resolveAutomationTemplate` survives as a ranker.** Its six-rule precedence
chain (monthly pin → schedule window → offer-type default → all-types default →
brand fallback → refuse) now decides which variant carries the *recommended*
flag, not which variant exists. Rule 6 ("refuse") stops being a skip and becomes
"no recommendation" — the variants still generate.

**4. Picking a variant archives its siblings.** Uses the `archivedAt` soft delete
already on `AdCreative`. Recoverable, and the working list stays roughly the size
it is today once a dealer has chosen. Without this the list grows ~6x a month
with nothing clearing it — `expire-ads` only retires ads whose *offer* died and
has no concept of "a sibling won."

**5. Trigger: generate off the poll's diff.** When `pollAccountOffers` returns a
non-empty `diff.new` for an account, generation runs for that account
rather than waiting on the fixed 06:30 job. Debounced to one notification per
account per day — OEM feeds trickle in over several days and each arrival would
otherwise be its own alert.

**6. Run window changes to `current_month`. Measured, not assumed.** The default
is `next_month` today, and `fitToWindow` marks an offer `expired` when its end
date precedes the window *start*.

Measured against production on 2026-09-02 (`scripts/report-oem-lead-times.ts`,
2,613 snapshot rows, 19 accounts, 26 distinct poll days, 14 makes):

| Window | Live dated offers eligible |
| --- | --- |
| `current_month` | **1,194 of 1,266 (94%)** |
| `next_month` (today's default) | **73 of 1,266 (5.8%)** |

So the shipping default rejects ~94% of live offers, and has been doing so
silently for most of every month — zero eligible offers is indistinguishable from
zero offers in the run log. This is a **live defect**, not a tuning preference.

Median publication lead, in days between first sighting and offer end: Audi 28,
Buick 27, Chevrolet 27, Chrysler 27, Dodge 27, Ford 29, Mazda 28, Subaru 28,
Toyota 27, Volkswagen 28. That cluster is the signature of "published at the
start of a month, for that month" — an offer has roughly four weeks left when
first seen, covering the current month and stopping at its edge.

Note the 73 that *do* reach into next month (Ford and Volkswagen both show a
154-day maximum, so some programs run five months out). `next_month` is not
useless — it is wrong as a *default*. The month turn is handled by the trigger in
decision 5, not by planning a month ahead.

**7. One square preview at generation; full sizes rendered lazily on pick.**
Roughly a 4x cut in render cost, which is what makes "generate everything"
affordable. `AdCreative` stores its own `doc` and `data` and is fully
re-renderable, so the deferred sizes cost nothing to postpone.

Size selection: exact square if the template defines one, else the size closest
to 1:1. **Never skip an ad over a missing square** — `TemplateDoc.sizes` is
whatever the designer put there, and plenty of templates are all 728×90 and
160×600.

`sizeIds` on `AdAutomationConfig` stops governing generation and starts governing
what gets rendered when a variant is picked.

**8. `maxAdsPerRun` becomes `maxVehiclesPerRun`, default 25.** New column via an
`ensure-*` script, not a rename — `db push` won't rename cleanly, same reason
`ensure-adcreative-offer-unique.ts` exists.

**9. Automation fills dual-offer templates, same-model only.** Two-model duals
stay manual-build. See the section below.

## Three things the fan-out breaks

These are not optional; they are defects the change introduces.

**The cap counts the wrong unit.** `maxAdsPerRun` counts finished ads (default
10) and `continue`s past everything after. Under fan-out that completes vehicle
#1, half-finishes #2, and skips the rest as `cap_reached`. A vehicle showing 3 of
its 6 designs is worse than an absent vehicle — the dealer reads it as "that's
all I get" and never learns otherwise. **The cap must fall on a vehicle boundary
and never truncate a vehicle mid-fan-out.**

**Cap ordering starves the tail.** Vehicles iterate as
`[...groups.entries()].sort()` — alphabetical on `year|make|model`. Harmless
while the cap never bites; under fan-out it will, and then the same
alphabetically-early models win *every month* and the tail never gets ads.

Sort by on-lot stock descending, name as tiebreak. Still fully deterministic (so
retries remain safe — rotation would break that), and when the cap bites it drops
the vehicles with the least inventory, which is defensible to a dealer in a way
that "your Traverse lost to your Colorado on the alphabet" is not.

**Skips must go per-variant.** Today a preflight failure, a missing
`eventLogoUrl` slot, or a stale co-op verdict skips the *whole vehicle*. Under
fan-out that means one broken template in the library silently takes out a
vehicle five other templates could have rendered fine. `SkippedVehicle` needs a
template dimension, and the run-history UI needs to distinguish "this vehicle
produced nothing" from "this vehicle produced 5 of 6."

## Dual-offer templates

Some templates carry two offers on one plate — a lease headline with an APR
supporting it. This is **not new machinery**: `incentive-apply.ts` defines
`OfferSlot = '' | 'o2_'`, `preflight` already judges the second offer by its own
`o2_offerType`, and `offer-text` and `ad-facets` both read the prefix. There is a
`vehicle-dual-offer` field kit. A template is dual when any field key starts with
`o2_`, which is readable straight off the doc — no new config.

What is missing is only the automation half. `generate-ads.ts` calls
`incentiveToFieldPatch` without a `slot`, so it always fills offer 1 and leaves
offer 2 empty. A dual template reaching the nightly job today fails preflight on
the missing required fields and is skipped, which is why dual templates work by
hand and are invisible to automation.

**Pairing rule: the top two distinct offer types, in the account's existing
priority order** (lease → apr → cash), slot 1 then slot 2. Do NOT generate every
combination — three live offers make six ordered pairs, and that multiplies
against every dual template. Two-by-priority is deterministic, needs no new
config, and matches how these plates are actually built: lead with the lease,
support with the APR.

A vehicle with only one live offer cannot fill a dual template. That variant
reports unavailable with the reason, which is the same per-variant skip path
everything else uses.

### Three traps

**The fingerprint must cover both offers, in order.** Lease-in-slot-1 +
APR-in-slot-2 is a different ad from the reverse. Composite the two fingerprints
in slot order. `offerFingerprint` is a string column, so **no schema change**.

**Expiry is the EARLIER of the two end dates.** The code takes the single
offer's `endDate` today. A dual ad dies when its *first* offer dies; taking the
later date leaves an ad running with one dead payment on it, which is exactly
the exposure `expire-ads` exists to prevent.

**`expiration` and the disclaimer are shared keys, not per-slot.**
`incentiveToFieldPatch` deliberately writes `_oemDisclaimer`,
`_oemDisclaimerText` and `expiration` unprefixed, so filling slot 2 overwrites
slot 1's fine print. A person building the ad by hand sees that and fixes it;
unattended generation does not. The generator must compose both offers'
disclosures and take `min()` of the dates.

### Two-model duals stay manual — settled 2026-09-02

`dualVehicleMode` (`'same'` = two offers on one model, `'two'` = two different
models on one ad) is **`useState` in the editor page and is never persisted**.
Automation therefore cannot tell the two kinds apart.

Persist the mode as an explicit flag on the template doc. Automation handles
`'same'` only; a `'two'` template is skipped with a clear reason and remains a
manual-build template. The two cases are different jobs — a same-model dual fits
the existing per-vehicle loop, while a two-model dual has to select two
*vehicles*, which inverts the grouping the whole generator is built around.

Do not infer the mode from whether an element binds `o2_vehicleImageUrl`. It is a
plausible heuristic and the wrong place for one: it decides what a compliance
check runs against.

## The paired email (2026-09-04) — superseded 2026-09-08

This section described `AdTemplateDoc.emailTemplateSlug`: a per-design pairing
between an ad template and an email shell, with `restyleOfferEmail` re-splicing
the run's email through the winning design's shell whenever a client picked a
design. **That mechanism is gone.** It violated the documented invariant that
config columns describe what runs — the email shell became a consequence of
which ad won, which nothing could predict or configure — and in practice it
clobbered the shell template itself once.

What holds now:

- **The email shell is the account's automation setting.** The playbook presets
  `emailTemplateSlug`; the Config tab writes it to `AdAutomationConfig`; the run
  reads the config. One source of truth, the same as every other creative step.
- **Picking a design is about the ads only.** The select route marks one design
  as chosen and archives its siblings. It does not touch the offer email, and
  the campaign's compare control says so ("Select a design" / "Change design").
- **The run's `OfferEmailInput` is still persisted on the blast metadata**, but
  for a different reason: a later run for the same cycle merges its offers with
  the draft's and refreshes it in place, instead of filing a second draft.
- `metadata.shellSlug` (the shell spliced into) and `metadata.templateSlug`
  (the rendered artifact) stay distinct, for the reason recorded before: conflating
  them made the no-op check never match.

## Cost

Per account, per run, roughly: vehicles × (live offers × single templates + 1 ×
dual templates) × **1** render. A dual template contributes one variant per
vehicle, not one per offer, because it consumes two offers at once. Local has 4
published+active templates; the prod count is what actually sets the bill and
should be checked before rollout.

Copy generation should be hoisted to one draft per (vehicle, offer) and shared
across that offer's variants. `copyForCreative` takes the doc, so this trades a
little per-design accuracy for not paying Anthropic once per variant — copy is
overwhelmingly offer-shaped, and the existing code already declines to re-draft
copy on re-runs for the same reason.

**Do not cap templates per offer.** A hidden template cap re-creates the "is that
all I get?" problem the vehicle-boundary rule exists to prevent. If the shared
library grows past a sane variant count, that is library curation, not a runtime
limit. Watch it; don't pre-solve it.

## Weakened invariant, accepted

The render currently doubles as proof the template can actually produce the ad —
"actually rasterizing the ad is what proves it," per the comment in
`generate-ads.ts`. One size is weaker proof: a template that renders clean at
1080×1080 can still break at 160×600, and that now surfaces when the dealer picks
rather than at generation.

Accepted, with one requirement: **the lazy render must fail loudly and visibly to
the dealer.** A silent failure at pick time is worse than the generation-time
skip it replaces.

## Investigated 2026-09-02 — short OEM windows, and one pre-existing defect

The 2026-09-02 measurement showed three Hyundai Motor Group brands with
publication leads far below the 27–29 day pack: Hyundai 19, Genesis 13, Kia 0.

**Fingerprint churn was suspected and is RULED OUT.** Daily re-minting of
fingerprints would show new rows on ~25 of the 25 post-baseline poll days. The
actual figures are 3–11 active days per make, arriving in lumps that match OEM
program cycles. The fingerprint is stable. Nothing here blocks the fan-out.

**Hyundai and Genesis are explained and are not a defect.** Pulled live from the
feed on 2026-09-02, a Hyundai Tucson program carries `valid_from 08/14/2026`
and `valid_through 09/08/2026` — a ~3½ week rolling window, against Ford's
`07/07/2026 → 09/30/2026`. HMG runs short rolling programs rather than
calendar-month ones. A median lead of 13–19 days is simply what that looks like.

Two consequences worth carrying forward:

- It reinforces decision 6. A window ending 09/08 is `partial` against a
  `current_month` window (usable) and `expired` against `next_month` (rejected).
- Ads for these makes will often generate with only days of life left. That is
  correct behavior, and `expiresAt` plus the `expire-ads` sweep is what handles
  it — but it means HMG ads turn over much faster than the rest.

### Open: Kia end dates equal to the day the offer was first seen

Sampling 12 Kia rows, **every one carried `endDate` identical to its
`firstSeenAt` date** (all 2026-08-03, all retired by 08-06), while the Ford
control returned proper future dates (09/30, 08/31, even 2027-01-04). The
underlying offers are genuinely distinct programs (24mo $429, 36mo $399, $750
cash), so this is not a fingerprint problem — it is the date field.

**Unresolved because the feed currently returns zero Kia programs**, so there
is no live payload to inspect. `transform()` reads
`valid_through ?? end_date ?? expiration_date ?? expire_date ?? expiry_date`;
which of those Kia populated, and with what, cannot be determined retroactively.
Re-inspect when Kia programs reappear.

**The consequence is the same under either explanation, and is actionable now.**
An offer whose end date is not after the day it was first seen can never pass
`fitToWindow` — it is `expired` against every window, current or next. Those
offers are dead on arrival, and if the date is a feed artifact then real Kia
programs are being dropped silently.

Recommended safety net, independent of root cause: **treat `endDate` <= the date
first seen as UNDATED rather than expired.** `fitToWindow` already classifies
`undated` as usable and `evaluateOfferCycle` reports it as its own state, so the
offer becomes usable while the oddity stays visible in the run log instead of
vanishing into a zero.

This is a **pre-existing defect, not one the fan-out introduces.** It should not
block this work.
