# Ad Generator — Offer Kinds

Status: **Complete** 2026-08-20 — the taxonomy is **two kinds, `vehicle` and
`custom`**, and Phase 4 closed it out by collapsing the planned `service` /
`parts` / `general` split. Co-op rule DATA is still owed by the Co-op team (§9).

⚠️ **This doc's §4 and §7 describe the four-kind plan that was BUILT and then
deliberately collapsed.** Read §7 Phase 4 first — it explains what the final
shape is and why. Everything before it is the reasoning that got there, kept
because the traps in §8 are all still live.

The ask: let a designer build ads for **service, parts, and anything else** —
not just vehicle offers.

---

## 1. The finding

The generator is vehicle-only because of **one line**:

```ts
// src/lib/ad-generator/system-fields.ts:20
export const SYSTEM_FIELDS: FieldSpec[] = vehicleOffer.fields;
```

`blankTemplateDoc` stamps `fields: SYSTEM_FIELDS` into **every** doc at creation,
and the builder's binding picker reads `SYSTEM_FIELDS` rather than `doc.fields`
([builder/page.tsx:1703](../src/app/ad-generator/builder/page.tsx)). So:

- Every template carries all ~50 vehicle-offer fields — including one started
  "From scratch" with the offer kit turned off.
- A designer **cannot create a field**. Authoring was deliberately retired in
  `ed1f826b` ("Phase 1 — fixed system-field schema, retire field authoring").

That retirement was the right call for the reason the file itself gives: a
designer-invented field was *inert*, because the offer engine, OEM compliance,
the disclaimer token engine and MarketCheck only understand those exact keys.

But that argument is about **the offer engine**, not about fields in general. A
Parts & Service ad does not need the offer engine to understand
`oilChangePrice` — it needs the value drawn on canvas, typed by the client,
length-capped, available to the disclaimer tokens and readable by the copy AI.
All four of those are already schema-driven and work with an arbitrary key.

**So the answer is not to reverse the fixed-schema decision. It is to stop having
exactly one schema.**

## 2. What is already generic (most of it)

Worth stating plainly, because it sizes the job. These need **no work**:

| Layer | Why it's already fine |
|---|---|
| Renderer (`doc-renderer.ts`) | Interprets elements + bindings. Knows nothing about vehicles. |
| Builder canvas, layers, sizes, cross-size geometry | Fully generic. |
| Copy AI (`copy-types.ts`, `generate-copy.ts`) | Driven by `FieldSpec.copy`. Already template-agnostic by contract. |
| Template taxonomy — category, tags, industries, schedule, sharing | Generic; `industries` is already a soft filter, not a gate. |
| Launch / Meta publish / launch presets | Generic. |
| Field prefs (`AdTemplateFieldPref`) | Per-rooftop field hiding, keyed on field key. Generic. |
| Preflight's placeholder + empty-binding checks | Derived from `SYSTEM_FIELD_DEFAULTS`; follows whatever the schema is. |

The creative page even has the **right seam already cut**:

```ts
// src/app/ad-generator/[id]/page.tsx:389
const isVehicleOffer = template.fields.some(
  (f) => f.key === 'offerType' || f.key === 'vehicleImageUrl',
);
const showAutomotiveTools = isVehicleOffer;
```

It gates the vehicle picker, EVOX and the colour swatches. It is simply always
`true`, because every doc gets `offerType` stamped into it.

## 3. What is genuinely vehicle-bound

Five places, and only five.

### 3.1 The field schema
One list, described above.

### 3.2 The offer math — a closed union and a closed switch
`OfferType = 'lease' | 'apr' | 'discount' | 'sales_price' | 'custom'`, and
`assembleOffer` is a `switch` over it ([offer-text.ts](../src/lib/ad-generator/offer-text.ts)).

`custom` looks like the escape hatch but does almost nothing: `assembleOffer`
returns `null` and the template falls back to free-text `price` / `terms`. That
means a service offer built today gets **no** `label` / `value` / `currency` /
`percent` split — so it cannot use the offer-block artwork, whose whole design is
a separately styled `$` and `%` as their own conditional elements. No derived
figures, no Offer Summary card, and the `expiration`/disclaimer plumbing hangs
off fields the form only shows for vehicle types.

### 3.3 Disclaimer — keyed `(make, offerType)`, slugs all finance
`AdDisclaimerTemplate` is `(make, offerType)`; every slug in `DISCLAIMER_SLUGS`
is a vehicle or lease/finance term. There is nowhere to express
*"$79.95 synthetic-blend oil change, up to 5 quarts, most vehicles, plus tax and
disposal fee. Not valid with other offers."*

### 3.4 Compliance — `BASELINE_REQUIRED` keyed by `OfferType`
And `AdOemOfferRule.make` is `@unique` on a vehicle make, so with no vehicle
there are **no rules at all** — silently, which is the exact failure mode
`vehicleFromData` was written to prevent.

### 3.5 Co-op — packs keyed by OEM brand
Note this is *not* out of scope for service: manufacturer service/parts co-op is
real money and has real prohibited language. It just has no route in today.

### 3.6 Automation (Phases 0–4) — vehicle-only, and should stay that way
Inventory feeds + MarketCheck. A service offer has no feed. Not proposed for
extension — but see the trap in §8.

## 4. The Offer Kind registry

Replace the single `SYSTEM_FIELDS` with a **registry of named schemas**, of which
`vehicle` is the first. Not one fixed schema; not free-for-all authoring.

```ts
export interface OfferKind {
  id: string;                 // 'vehicle' | 'service' | 'parts' | 'general'
  label: string;
  industries?: string[];      // which industries are offered this kind
  fields: FieldSpec[];        // was SYSTEM_FIELDS
  defaults: AdData;
  offerTypes: OfferTypeSpec[];
  slugs: Record<string, string>;   // disclaimer slugs this kind adds
  capabilities: {
    vehiclePicker: boolean;   // the YMM picker + `_veh*` stash
    evox: boolean;            // jellybean photography + paint colours
    oemRules: boolean;        // AdOemOfferRule required fields
    coop: boolean;            // AdCoopRulePack evaluation
    automation: boolean;      // eligible for unattended generation
  };
}
```

`TemplateDoc` gains `offerKind?: string`. **Undefined reads as `'vehicle'`** —
the same compatibility trick `usage` and `templateSync` already use, so nothing
migrates and no existing template changes behaviour.

`SYSTEM_FIELDS` stays exported as `offerKind('vehicle').fields` so existing call
sites keep working; the builder switches to `fieldsForKind(doc.offerKind)`.

The important gain: **four separate guesses at "is this a vehicle ad?" collapse
into one declared value.**

### 4.1 Data-driven offer types

The genuinely valuable thing in the current engine is
`assembleOffer → { label, main, value, currency, percent, terms }`. A service ad
needs exactly the same shape — `OIL CHANGE` / `$79.95` /
`Synthetic blend · up to 5 qts`. So don't add cases to the switch; make the
assembly declarative:

```ts
interface OfferTypeSpec {
  value: string;
  label: string;
  defaultLabel: string;
  /** The headline figure. */
  main: { field: string; format: 'money' | 'percent' | 'text'; suffix?: string };
  /** Supporting lines, in order, as {{token}} templates. Dropped when empty. */
  terms: string[];
}
```

`assembleOffer` becomes an interpreter over the spec. The five existing vehicle
types are then expressed **as data**, and characterization tests assert the
output is byte-identical to today. That equivalence is what makes this refactor
shippable rather than a rewrite.

New kinds bring their own types:

| Kind | Offer types |
|---|---|
| `custom` | ✅ `flat_price`, `percent_off`, `dollar_off`, `other_offer`, `no_offer` — service, parts and message-only ads, all in one kind. See Phase 4 in §7. |

A large share of real dealer advertising — hiring, events, CSR,
sell-us-your-car, finance-department, new-location — has **no offer at all**, and
before offer kinds the form forced an offer type on all of it. `general` solves
that by having no offer type rather than by adding a `no_offer` value.

⚠️ **Offer type values must be globally unique.** `assembleOffer` only ever
receives `AdData`, with no kind in scope, so it resolves a spec by value —
`service` reusing `custom` would silently assemble the vehicle one. So
`flat_price`, `percent_off` and `dollar_off` can be shared between `service` and
`parts` only if those two kinds are never distinguished by offer type alone;
otherwise they need distinct values. `offer-kinds.test.ts` enforces uniqueness.

### 4.2 Disclaimer

- Add `offerKind String @default("vehicle")` to `AdDisclaimerTemplate` and
  include it in the lookup + index. Additive and defaulted, so it is safe under
  `db push` with no backfill.
- New slugs for service/parts: `service_name`, `service_price`, `regular_price`,
  `savings_amount`, `percent_off`, `vehicle_restrictions` ("most vehicles"),
  `fluid_capacity` ("up to 5 quarts"), `parts_excluded`, `coupon_code`,
  `redemption_limit`, `participating_locations`, `offer_start_date`.
- `make` stays, and stays meaningful — a Subaru service ad should carry Subaru
  service co-op language. It is already `String?`.

**Derived slugs matter more here than for vehicles.** `savings_amount` =
regular − sale, and `percent_off` = savings ÷ regular. Compute both in
`buildTokenValues` the way `total_miles` is, and never let anyone type them. A
coupon that advertises "SAVE $50" above "$99 (reg. $139)" is the textbook FTC
problem, and it happens precisely when a human retypes arithmetic into a legal
line.

### 4.3 Compliance — one less migration than expected

`BASELINE_REQUIRED` moves onto the `OfferKind` (mechanical).

`AdOemOfferRule` needs **no schema change**. Its `requiredFields` JSON is already
keyed by offer type, and service offer types have distinct values — so
`{"lease":[…],"flat_price":["regularPrice","vehicleRestrictions"]}` works with the
column exactly as it stands.

Co-op rules are already field-keyed, and `banned_phrase` is exactly the right
engine for service prohibited language ("free", "lifetime", "guaranteed"). Add
`offerKinds?: string[]` to the rule shape so a rule can be service-scoped,
defaulting to every kind. That is a JSON-shape change inside the pack, not a
migration.

### 4.4 Retire the sniffs

| Sniff | Becomes |
|---|---|
| `[id]/page.tsx:389` `isVehicleOffer` | `kind.capabilities.vehiclePicker` |
| `buildContentSources` `hasOffer = fields.some(f => f.key === 'offerType')` | the kind's `offerTypes` |
| `offer-card.tsx` vehicle block | already prop-gated on `allowVehiclePicker`; point it at the capability |
| `usableByAutomation(doc)` | **also** require `kind.capabilities.automation` — see §8 |

## 5. `AdCategoryStarter` — removed in Phase 1

There is already a table for per-category field sets, with a full CRUD API
([category-starters/route.ts](../src/app/api/ad-generator/category-starters/route.ts))
and a seed script for "Vehicle Offer". It has **zero readers**: the only
references anywhere are the route itself and `seed-vehicle-offer-category.ts`. No
UI calls it and no runtime code reads it.

✅ Deleted — model, route and seed script. The registry supersedes it and does
strictly more; a JSON field blob cannot carry capabilities or offer math, and
leaving both in place guarantees the next person wires the wrong one.
`AdTemplateFieldPref` already covers the real per-rooftop need.

Two things had to happen alongside the deletion, both easy to miss:

- `deploy:prepare` ran `seed-vehicle-offer-category.ts` on **every deploy**.
  Deleting the script without editing `package.json` breaks the deploy command.
- `prisma db push` runs unguarded (no `--accept-data-loss`), so it **refuses** to
  drop a non-empty table and aborts the whole deploy. The table is dropped
  explicitly first by `scripts/drop-ad-category-starter.ts`, wired into
  `deploy:prepare` and `db:sync` ahead of the push — the same pattern as
  `drop-media-folders.ts` and `drop-organization-model.ts`. It reports the row
  count before destroying it (expected: 1).

## 6. Locked decisions

1. **Kinds are code-owned, templates are designer-owned.** A kind carries offer
   math, capability flags and disclaimer slugs — all of which need code.
   Confirmed 2026-08-20; §10 is settled.
2. **Field authoring stays retired.** Designers pick a kind and bind to its
   fields. Nobody invents a key the engine has never heard of.
3. **`offerKind` undefined ⇒ `vehicle`.** No backfill, no behaviour change to any
   existing template.
4. **Phase 1 changes no output.** Characterization tests assert byte-identical
   renders for every template in the library before it ships.
5. **Automation stays vehicle-only**, enforced by a capability flag rather than
   by nobody having tried yet.
6. **Derived figures are never typed** — savings and percent-off are computed,
   same standing rule as `total_miles` and `monthly_payments_total`.

## 7. Phases

**Phase 1 — the registry, no new kinds. ✅ SHIPPED 2026-08-20.**

| Landed | Where |
|---|---|
| `OfferKind` registry, `vehicle` the only kind | [offer-kinds.ts](../src/lib/ad-generator/offer-kinds.ts) |
| Offer types as DATA; `assembleOffer` is now an interpreter | [offer-types.ts](../src/lib/ad-generator/offer-types.ts), [offer-text.ts](../src/lib/ad-generator/offer-text.ts) |
| `TemplateDoc.offerKind` (undefined ⇒ `vehicle`, no backfill) | [doc-types.ts](../src/lib/ad-generator/doc-types.ts) |
| `blankTemplateDoc` stamps the chosen kind's schema + records the kind | [doc-template.ts](../src/lib/ad-generator/doc-template.ts) |
| Builder binds to the doc's KIND, not one global schema | [builder/page.tsx](../src/app/ad-generator/builder/page.tsx) |
| `showAutomotiveTools` = capability ∧ the doc actually carries the fields | [\[id\]/page.tsx](../src/app/ad-generator/[id]/page.tsx) |
| `usableByAutomation` also gates on the kind (the §8 trap) | [offer-kinds.ts](../src/lib/ad-generator/offer-kinds.ts) |
| The backfill script is per-kind, not per-app (the §8 hazard) | [backfill-doc-system-fields.ts](../scripts/backfill-doc-system-fields.ts) |
| `AdCategoryStarter` deleted + explicit table drop | [drop-ad-category-starter.ts](../scripts/drop-ad-category-starter.ts) |

**Verified byte-identical.** The pre-refactor `ad-generator` tree was extracted
at `HEAD` and run side by side with the new one: **7,121 comparisons, 0
differences** — the offer engine over a permutation matrix (every offer type ×
edge-case values × the `o2_` dual path), ~2,900 fully rendered HTML documents
across all four vehicle templates × every size, and the exported vocabulary
(`OFFER_TYPES`, `SYSTEM_FIELDS`, `SYSTEM_FIELD_DEFAULTS`, …). `blankTemplateDoc`
differs by exactly one added key, `offerKind: 'vehicle'`.

That comparison was a throwaway. What guards Phases 2–4 is
[render-stability.test.ts](../src/lib/ad-generator/render-stability.test.ts),
which snapshots the offer blocks in full plus a byte-length + hash per
template/size/dataset. Nothing else in the suite covered these templates' HTML.

**One regression this caught, worth remembering:** the first cut of the registry
gave the vehicle kind `vehicleOffer.defaults`, but `blankTemplateDoc` had always
used `SYSTEM_FIELD_DEFAULTS` — which *overrides* the offer numbers with obvious
placeholders (`msrp: 'XX,XXX'`, not `'34000'`). Shipping it would have started
every new template on fake-real numbers that read as a configured offer and
walk straight past preflight's placeholder-leak guard. The placeholder overrides
now live on the kind, and `SYSTEM_FIELD_DEFAULTS` derives from it.

**Phase 2 — `general`. ✅ SHIPPED 2026-08-20.** 12 fields across Copy / Media /
Details / Legal ([general-ad.ts](../src/lib/ad-generator/templates/general-ad.ts)),
every capability off, and no offer concept at all.

**Deviation from this spec, deliberately.** The plan called for `no_offer` +
`custom` offer types. Built with **no `offerType` field and no offer types** —
a field whose only purpose is to hold a sentinel meaning "ignore me" is worse
than not having the field. Its absence is what makes everything downstream do
the right thing on its own: `BASELINE_REQUIRED` resolves to nothing required, the
`_offer*` tokens stay out of the builder's binding picker, and the offer block
never assembles. If a general ad turns out to need a real offer, that is the
signal it belongs to `service`, not that this kind should grow an offer engine.

Where the kind is chosen (it can't be changed later without orphaning every
binding, so it is a creation-time decision):

- **Ad Generator → New ad → From scratch** — the old "Vehicle offer fields"
  control became **Ad type**: Vehicle offer / Two vehicle offers / General ad.
- **Templates → New template** — one "Blank <kind>" entry per kind.

Both lists are derived from `OFFER_KINDS`, so `service` and `parts` appear in
them without either file being edited again.

**A latent bug this replaced:** the old control's "Blank" and "Single vehicle"
options produced **byte-identical docs** — every doc was stamped with the whole
vehicle schema regardless, so "Blank" never gave anyone a blank form.

Also landed, and the subtlest part of the phase — **blocks may no longer widen a
doc's schema past its kind**
([blocks.ts](../src/lib/ad-generator/blocks.ts)). The seeded *Lease* / *APR
offer* / *Vehicle offer block* rows carry `offerKit: 'single'` plus vehicle
`requiredFields`, and `insertBlockIntoDoc` merged both unconditionally. Harmless
while every doc had the vehicle schema anyway; on a general template it would
graft the vehicle offer schema onto an ad that has no offer. Now the merge is
clamped to fields the kind declares, and `blockFitsKind` filters incompatible
blocks out of the builder's lists (including the two empty-state guards, which
still counted the unfiltered list).

**Verified in the running app**, not just in tests: created a general ad through
the real picker, confirmed the stored doc carries `offerKind: 'general'` and 12
general fields with zero vehicle keys, confirmed the builder's variable picker
offers exactly the general schema and no `_offer*` tokens, confirmed the offer
blocks are gone from the insert list, bound `{{headline}}` and saw it resolve on
canvas, and confirmed the client form renders Branding / Copy / Media / Details /
Legal with no offer card, no vehicle picker, no disclaimer template picker and no
Manufacturer compliance panel. The server-side Puppeteer render returned a 41 KB
PNG, and Download / Launch Kit / Launch to Meta are all present.

**Phase 3 — `service`. ✅ MECHANISM SHIPPED 2026-08-20. Rule DATA blocked on the
Co-op team (§9).** 21 fields across Copy / Offer / Media / Terms / Legal
([service-offer.ts](../src/lib/ad-generator/templates/service-offer.ts)).

**The capability split is the heart of it.** `vehiclePicker` used to mean two
things at once — "show the YMM picker" *and* "manufacturer rules apply". A service
offer has a **make but no vehicle**: fixed-ops co-op is real money keyed by brand,
so it needs the disclaimer template, OEM required-field rule and co-op pack lookup
*without* a year/model/trim picker. So `manufacturerRules` is now its own
capability. Collapsing them would have forced a choice between a service ad that
asks for a VIN and a service ad with no manufacturer checking at all. The make
comes from the account's OEM, which is what the creative page already fell back to.

**Four offer types, not the six sketched in §4.1.** `bogo` and `free_with` have
the same shape — the headline is a PHRASE, not a figure — so they are one
`service_offer` type with a `text`-format headline rather than two types that
assemble identically. A type exists to make the block assemble and to key required
fields, disclaimer bodies and co-op rules; two types that do all four the same way
are one type. `text` was added to `OfferFigureFormat` in this phase, i.e. in the
change that reads it.

**Savings are DERIVED, never typed.** A service coupon's characteristic failure is
a savings claim that doesn't subtract — "SAVE $50" over "$99 (reg. $139)". There is
no field for either figure; `deriveOfferFigures` computes `savings_amount` and
`savings_percent` from `regularPrice` and whichever figure the type advertises
(deriving the resulting price first for a dollars-off offer). Absent rather than
zero when `regular ≤ advertised`, because "SAVE $0" on an ad is worse than no
savings line. They surface in the **Calculated for the disclaimer** panel with the
arithmetic — that panel was gated on `showAutomotiveTools` and is now gated on
whether the kind composes a disclaimer at all, and `calculatedRows` had a
hardcoded row order that dropped the savings rows entirely.

**No `offerKind` column was added to `AdDisclaimerTemplate`**, contrary to §4.2.
Offer type values are globally unique, so `offerType` already identifies the kind
— a second column would be a second source of truth that could disagree with the
first. Instead the disclaimer-template editor's offer-type picker now lists every
kind's types grouped by kind, and its token chips are scoped to the selected
type's kind (offering `{{msrp}}` on a service body would put literal markup in a
legal line).

**Both Phase 2 notes are resolved.** `composesDisclaimer` stayed as
`offerTypes.length > 0` — the third state it supposedly needed turned out to
belong on the kind as `dealerFeeBoilerplate`, a per-kind sentence rather than a
boolean. And `PLACEHOLDER_GUARDED_KEYS` now derives from every kind's defaults,
not just the vehicle ones.

**Five hand-maintained vehicle-only tables became derived** in this phase, each of
which would otherwise have silently excluded service: `BASELINE_REQUIRED` (now
`OfferTypeSpec.required`), `FIELD_LABELS` (derived from every kind's schema, with
the short forms kept as an override layer — these read in a sentence, so "Lease
term", not "Lease term (months)"), `OFFER_TOKEN_FIELDS` and `PRIMARY_OFFER_FIELD`
in the builder (now `offerTokenFields` / `primaryOfferField`, derived from the
specs), and `PLACEHOLDER_GUARDED_KEYS`.

**Verified in the running app:** created a service ad through the real picker
(which listed "Service offer" without that file being touched, as designed);
confirmed the stored doc carries `offerKind: 'service'`, 21 fields, zero vehicle
keys and the four service offer types; confirmed the client form shows Branding /
Copy / Offer / Media / Terms / Legal **plus Manufacturer compliance** and **no**
vehicle picker or vehicle field anywhere; confirmed the disclaimer composed to
"Synthetic Blend Oil Change for $79.95. See dealer for complete details." with no
fee boilerplate; and confirmed the savings panel reads
`You save · $109 − $79.95 · $29.05` and `Savings · $29.05 ÷ $109 · 27%`. All four
offer types were then rendered through `renderDoc` with no raw tokens in the HTML.

**Phase 4 — ✅ SHIPPED 2026-08-20, and it DELETED a kind instead of adding one.**

**The decision.** Building `service` (Phase 3) and sizing up `parts` showed the
four-kind plan was wrong. Parts shares **100%** of service's offer math and all
but three of its fields; a hiring ad is a service offer with no offer. Three
kinds meant three copies of the same arithmetic, three parallel slug maps, and a
user having to know which bucket an ad belonged in before they could start it.

What actually varied between them was the **offer type** and **which restrictions
apply** — both already per-ad choices *inside* a kind. So `service`, `parts` and
`general` collapsed into one **`custom`** kind, on the owner's call: *"let's just
do Vehicle Offer and Custom Offer only."*

The bar for a kind is now explicit: its own schema, its own offer math, its own
slug map, its own capability row, and a choice the user must make before they can
start. `vehicle` clears it (a VIN, a make, an EVOX jellybean, unattended
generation from a feed). Nothing else has.

| | |
|---|---|
| Kinds | `vehicle`, `custom` |
| Custom offer types | `flat_price`, `percent_off`, `dollar_off`, `other_offer` (BOGO / bundle / free-with), `no_offer` |
| Custom fields | 29, across Copy / Offer / Media / Terms / Details / Legal ([custom-offer.ts](../src/lib/ad-generator/templates/custom-offer.ts)) |

**`no_offer` is the reversal of a Phase 2 decision, and the reasoning changed
with it.** Phase 2 rejected a `no_offer` sentinel — correctly, when "no offer"
was its own KIND and the field could simply be absent. Once one kind serves both
an oil-change coupon and a job posting, the user needs a way to *say* there is no
offer. It hides every offer and restriction input, assembles no offer block,
requires nothing, and suppresses the manufacturer checks — that last one being a
per-AD fact, which is exactly why one kind can carry both.

**Field keys were renamed to stop lying.** `serviceName` → `offerName`,
`servicePrice` → `offerPrice`, `fluidCapacity` → `includedAllowance`,
`partsExcluded` → `exclusions`, plus new `partNumber` and `availabilityNote`. The
same field holds "Synthetic Blend Oil Change" and "Genuine Subaru Floor Mats"; a
key named after one of its uses is how a schema starts lying about itself. Slugs
followed (`offer_price`, `included_allowance`, …).

**Two naming collisions on the word "Custom", both resolved.** The owner spotted
the first: the ad card's grey **"Custom"** chip actually means *"this ad keeps its
own design, so template updates skip it"* — a template-SYNC state that read like
an answer to "what kind of ad is this". It is now **"Edited"**, which is what its
own tooltip always said. The second: the vehicle kind's free-text offer TYPE was
labelled "Custom (free text)" and is now **"Free text"** (the stored value stays
`custom` — it is in ad data and disclaimer-template rows).

**Per-kind co-op scoping — no new field needed.** `CoopScope` already had
`offerTypes`, and because type values are globally unique, ticking the custom
kind's types *is* scoping a rule to custom offers. So the planned
`offerKinds?: string[]` was **not added** (it would be a second source of truth
able to disagree with the first). What was actually broken is that the co-op pack
editor's rule chips and field dropdown were still **vehicle-only** — nothing
errored, there was simply no way to name a custom offer's price or its
exclusions, so no service or parts co-op rule could be authored at all. Both are
now grouped by kind.

**Also shipped: the offer-kind badge** on ad and template cards
([offer-kind-badge.tsx](../src/components/ad-generator/offer-kind-badge.tsx)) —
requested because nothing on a card said what kind of ad it was. Tinted per kind
(`vehicle` blue, `custom` amber) with the tone chosen by the kind and the classes
living with the component. A slate tone was tried first and read as just another
grey next to the neutral chips, which defeats the point of tinting.

**Two live bugs found by verifying in the app, not by tests:**

1. **A brand-new custom ad composed VEHICLE legal text.** A from-scratch ad's
   `data` starts empty, so `data.offerType` was unset; `composeDisclaimer`
   defaults an unset type to `custom`, and `custom` belongs to the *vehicle*
   kind — so the autosaved disclaimer ended "Advertised price includes all
   dealer-imposed fees. Excludes tax, title, and registration." on an oil-change
   coupon. Fixed by keeping the RAW offer type separate from the defaulted one:
   the owning kind is only consulted when a type was actually chosen, and
   `TokenOptions.offerKind` supplies the fallback otherwise. Both the boilerplate
   and the default body were leaking.
2. **A whole form section vanished.** Same root cause: every field gated on
   `offerType` was hidden while the select already *displayed* a default, so the
   Terms section rendered empty and was dropped. Visibility is now evaluated
   against the template's defaults under the ad's own values — deliberately NOT
   merged into `renderData`, because that feeds `missingRequired`, and folding
   `offerPrice: 'XX.XX'` in there would satisfy a required-field check with
   scaffolding and let a placeholder reach an export.

**Verified in the app:** created a custom ad through the real picker (Ad type is
now Vehicle offer / Two vehicle offers / Custom offer); confirmed
`offerKind: 'custom'`, 29 fields, six groups, five offer types, zero vehicle
keys; on `flat_price` the disclaimer composed to "Synthetic Blend Oil Change for
$79.95. See dealer for complete details." with no fee boilerplate and the savings
panel read `You save · $109 − $79.95 · $29.05`; switching to `no_offer` collapsed
Terms, every offer input, the compliance panel and the savings panel while
leaving the message, media and detail fields intact.

Not blocking, but noticed while verifying Phase 2: `/api/ad-generator/field-prefs`
404s for every from-scratch ad, because `createBlank` posts `templateId: 'blank'`
and no prefs row exists for it. Pre-dates offer kinds and is benign (the client
falls back to no preferences), but it is noise in the console on every such ad.

## 8. Traps

**The doc snapshot freezes the schema.** `blankTemplateDoc` stamps `fields` at
CREATION and `adTemplateFromDoc` reads `doc.fields` back, so a template's schema
is frozen when it is made — and creatives carry their own snapshot too, picking
changes up only via **Apply update**. For offer kinds this is the *desired*
behaviour: an existing vehicle template should stay one. But it means changing a
published template's kind has to be an explicit, warned action, because it swaps
the field schema out from under every existing binding.

**`scripts/backfill-doc-system-fields.ts` was a live hazard.** ✅ Fixed in Phase 1.
It appended every missing `SYSTEM_FIELDS` entry — the VEHICLE kind's fields — to
every `AdTemplateDoc`, and it is run per environment. The moment a second kind
existed it would have appended the whole ~50-field vehicle schema to every
service and general template it touched, and its output looks like success. It
now tops each doc up from its OWN kind.

**Automation's brand fallback.** ✅ Gated in Phase 1. Its last resort is any
published template whose `make` matches the vehicle. `usage` was added precisely
to stop a custom plate being picked for an unattended OEM ad; without a kind gate
a service template becomes a candidate for a Mazda lease ad — the same bug
through a new door. `usableByAutomation` now requires both, which is why it moved
out of `doc-types.ts` (it needs the registry, and the registry reads
`templateUsage` from there — the other direction would be a cycle).

**`money()` rounded cents away.** ✅ Fixed in Phase 3. Both the offer engine's and
the disclaimer engine's money formatters used `maximumFractionDigits: 0`, so a
$79.95 oil change advertised as **$80** — a price the dealer does not charge. Both
now preserve cents when present (`$79.95`, `$79.90`, `$299`) and had to be changed
*together*: if only one rounded, the on-image price and the fine print would state
different numbers, which is worse than both rounding. No existing vehicle output
moved, because every vehicle figure in the snapshots is a whole dollar amount.

**Default disclaimer bodies can print raw markup into a legal line.** ⚠️ FOUND,
NOT FIXED. `substituteTokens` leaves an unresolved token as a literal
`{{token}}`, and three of the four vehicle default bodies reference a field the
type does not require:

| type | token | required |
|---|---|---|
| `lease` | `{{due_at_signing}}` | monthlyPayment, leaseTerm |
| `discount` | `{{msrp}}` | discountAmount |
| `sales_price` | `{{msrp}}` | salePrice |

Only reachable on a DEFAULT body — but the default is exactly what a dealer with
no brand template on file gets. Both fixes are user-facing calls outside this
phase: adding the field to `required` BLOCKS EXPORT on every existing ad that
omits it, and rewording the bodies is a change to legal text. Recorded as
`KNOWN_RAW_TOKEN_TYPES` in `disclaimer.test.ts`, which asserts the list is exactly
these three so whoever fixes one is told to remove it.

**A block can carry a schema, not just elements.** ✅ Fixed in Phase 2 — see §7.
Worth remembering as a shape: `offerKit` and `requiredFields` on a block payload
both mutate the target doc's `fields`. Any new "insert this saved thing" path
needs the same clamp, or it becomes a second way to corrupt a doc's schema.

**`SYSTEM_FIELDS` is no longer "the schema".** It is the VEHICLE kind's schema
that happens to be the default, and it stays exported because plenty of callers
legitimately mean exactly that (the code vehicle templates, the co-op rule
editor's field list). Anything that needs the schema for a PARTICULAR template
must read `fieldsForKind(docOfferKind(doc))` — reaching for `SYSTEM_FIELDS`
silently applies vehicle fields to every other kind, which is the bug this whole
feature exists to fix.

**`AdOemOfferRule.make` is `@unique`.** One row per brand covering every offer
kind. Fine as long as required fields stay keyed by offer type (§4.3) — but it
means a service-only rule change edits the same row as the lease rules, so it
needs the same review path.

## 9. What we need from the Oz Co-op team

Phase 3 shipped the MECHANISM for all of this. Every item below is data the engine
accepts the moment it arrives — nothing is blocked on more engineering, and
nothing here was invented in code in the meantime.

Bundles with the outstanding asks in
[custom-offer-disclaimer-builder.md §10](./custom-offer-disclaimer-builder.md) —
worth collecting in one pass.

1. **Service and parts disclaimer bodies** per brand, or confirmation that a
   single generic body plus a brand line is acceptable.
2. **Service/parts co-op prohibited language** — whether it differs from the
   vehicle lists already being transcribed.
3. **Whether service co-op claims require the same design-time checks** (logo
   zone, minimum font size) as vehicle ads, or a different set.

## 10. Settled: kinds are code-owned

Confirmed 2026-08-20. Every kind carries offer math, capability flags and
disclaimer slugs, so a new kind needs a code change regardless — an admin UI over
the registry would only let someone create a half-configured kind whose offer
block silently renders nothing. Designers get all the freedom that matters at the
*template* level, which is where they actually work.

Two consequences worth keeping in mind while adding kinds:

- **Capability flags are added in the change that READS them, never ahead of it.**
  `OfferKindCapabilities` deliberately carries only `vehiclePicker` and
  `automation` today. An unenforced flag is worse than no flag: whoever adds
  `service` would set `coop: false`, see it in the type, and reasonably assume
  co-op evaluation was skipped when it wasn't.
- **Offer type values must be globally unique across kinds.** `assembleOffer`
  only ever receives `AdData`, with no kind in scope, so it looks a spec up by
  value — a `service` kind reusing `lease` would silently assemble the vehicle
  one. `offer-kinds.test.ts` asserts this.

## 11. Explicitly rejected

- **Reopening designer field authoring.** The original reasoning
  ([system-fields.ts](../src/lib/ad-generator/system-fields.ts)) still holds: an
  invented key is inert in the offer engine, compliance and the disclaimer.
- **A second field-set mechanism alongside the registry** — including keeping
  `AdCategoryStarter` (§5).
- **Extending unattended automation past `vehicle`.** Service offers have no
  feed to poll.
- **Adding cases to the `assembleOffer` switch per new kind.** Four kinds × five
  types is twenty branches nobody can read back against a spec.
