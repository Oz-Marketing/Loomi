# Ad Generator — Archetypes

Status: **Prototype built, product not started** 2026-08-22. The layout engine is
proven against both real Young Subaru templates (§5) with 32 tests; nothing is
wired into the builder, the seed, or any UI. Both hand-built templates still
ship unchanged. Phases 1–5 in §8 are the remaining work.

⚠️ **Read §6 before changing any number in `vehicle-offer-archetype.ts`.** Four
of those constants are craft decisions recovered from the designer's hand-tuned
layouts, not arithmetic. They look arbitrary and they are not.

The ask, in Connor's words: *"I've been so focused on trying to make this ad gen
builder agnostic so any industry could work off 1, but automotive is so specific
— we just need to build this to be very specific to the offer types and
automotive as a whole."* Plus: setting up blocks per offer type is finicky,
layers don't translate, the Preview tabs aren't trustworthy, "Edits apply to"
confuses, Show For makes it worse, and building many ad sizes is cumbersome
manual labor.

---

## 1. The finding

The codebase already builds automotive ads correctly. Three mechanisms do the
hard parts, and none of them is reachable by a designer.

| Mechanism | Where | What it means |
|---|---|---|
| **Named slots** | [`templates/offer-docs.ts`](../src/lib/ad-generator/templates/offer-docs.ts) `singleOfferDoc` | Elements are `logo`, `dealer`, `tagline`, `offerLabel`, `offerValue`, `offerTerms`, `expiration`, `disclaimer`. The ad's anatomy is written down — just not where the builder can see it. |
| **One plate, four types** | same doc | A bare number plus a `$` shown for money types and a `%` for APR. One offer block already reformats across lease / APR / discount / sale price. |
| **Layout from the board** | [`vehicle-dual-offer.ts:45`](../src/lib/ad-generator/templates/vehicle-dual-offer.ts) | `const stacked = width / height < 0.9` plus a unit scale of `min(w,h)/30`. A real responsive rule for automotive ads, in ~15 lines. |

And a fourth, smaller tell. `assembleOffer`
([`offer-text.ts:205`](../src/lib/ad-generator/offer-text.ts)) returns six
ready-to-place pieces for **any** offer type — label, figure, bare value, `$`,
`%`, terms — and `enrichOfferFields` publishes them as `_offer*`. The code
templates bind the computed **label** directly. Only the builder withholds it:

```ts
// src/app/ad-generator/builder/page.tsx:321
// editorial text the designer types statically per offer type, NOT computed.
const OFFER_TOKENS = [ /* main, value, currency, percent, terms — no label */ ];
```

That one omission is why every template needs a hand-built label element per
offer type, gated by Show For. It is the first of the four copies.

## 2. What the agnostic ambition cost

Staying industry-agnostic forced one decision: the builder treats a template as
an arbitrary bag of positioned elements bound to arbitrary field keys. Nothing on
the canvas may know that a price is a price. Every symptom is downstream of that.

| Symptom | Cause |
|---|---|
| Blocks per offer type are finicky | Nothing knows an offer plate is a thing, so it's four hand-kept copies. A new element defaults to **every** type ([`ShowForControl`, builder:6075](../src/app/ad-generator/builder/page.tsx)), so forgetting is silent until an ad renders wrong. |
| Layers don't translate | The Layers list is `placed`, which is the board filtered by the current preview type ([builder:1528](../src/app/ad-generator/builder/page.tsx)). It was never the design's layer list. |
| Preview tabs aren't trustworthy | The canvas holds four types at once, so it shows a superposition or a slice — never the ad that ships. |
| "Edits apply to" confuses | With no layout rules, broadcasting is the only leverage over fifteen boards, so it has to be a mode ([builder:1086](../src/app/ad-generator/builder/page.tsx)) — and a mode you can't see is one you forget. |
| Many sizes is heavy labor | An arbitrary composition can't be re-laid-out automatically. A *known* one can. |

The labor is the product of two axes. Young Subaru is five channel sizes × four
offer types, doubled for the dual: **40 arrangements** to build and keep
consistent. [`young-subaru-offers.ts`](../src/lib/ad-generator/templates/young-subaru-offers.ts)
states them as `singleLayouts` (:78) and `dualLayouts` (:139) — ~200 lines of
`x/y/w/h` chosen by eye, none connected to any other.

## 3. What an archetype is

**A function from (theme, sizes) to a `TemplateDoc`.** That is the whole design,
and it is what makes it safe: the output is an ordinary doc, so the renderer, the
builder canvas, preflight, OEM compliance, co-op checks, unattended generation
and every export path work unchanged and cannot tell the difference between a doc
a designer placed by hand and a doc an archetype produced.

```ts
// src/lib/ad-generator/archetypes/types.ts
buildArchetypeDoc(arch: Archetype, theme: Theme, sizes: AdSize[], meta) => TemplateDoc
```

- **`Archetype`** — `slots`, `fields`, `defaults`, `present(size, slots)`, `layout(size, present)`.
- **`ArchetypeSlot`** — `id`, `role`, `build(theme) => DocElement`, optional `shedAt`.
- **`Theme`** — the designer-owned surface: `base`, `brand`, `ink`, `muted`, `onBrand`, `fade`.
- **`SlotRole`** — `backdrop | logo | tagline | offer | vehicle | vehicleName | expiration | disclaimer`. **This list is the anatomy**, and it is the thing the generic builder had no way to express: a text element bound to `_offerMain` is not the same thing as THE OFFER, and only one of those can be laid out, checked or reasoned about.

### 3.1 Offers are a list

`vehicleOfferArchetype(1)` and `vehicleOfferArchetype(2)` are the same archetype
with a different offer count. One `offerPlate(i)` builds the slots for offer `i`
against the prefix the engine already assembles under — `_offerMain` for the
first, `_o2_offerMain` for the second. A third offer is `offerPlate(2)` and a
prefix, not a new template.

That is what the `o2_` twin fields were simulating. Retiring them in favour of an
indexed offer list is Phase 5.

## 4. Files

| File | Lines | What |
|---|---|---|
| [`archetypes/layout.ts`](../src/lib/ad-generator/archetypes/layout.ts) | 151 | `pad`, `splitH`, `column`, `isWide`, `floorFrac`. Pure arithmetic, no rendering. `column` pays pixel floors first and squeezes proportionally when they don't fit rather than overflowing. |
| [`archetypes/types.ts`](../src/lib/ad-generator/archetypes/types.ts) | 148 | The contract + `buildArchetypeDoc` + `shedOrder`. |
| [`archetypes/vehicle-offer-archetype.ts`](../src/lib/ad-generator/archetypes/vehicle-offer-archetype.ts) | 461 | The archetype family. Slots, floors, the shed rule, the two layout branches. |
| [`archetypes/young-subaru-archetype.ts`](../src/lib/ad-generator/archetypes/young-subaru-archetype.ts) | 77 | Young Subaru as a **theme**. Two colours and a fade angle is the whole of what a designer chose. |
| [`archetypes/archetypes.test.ts`](../src/lib/ad-generator/archetypes/archetypes.test.ts) | 439 | 32 tests. The invariants the hand-authored layouts had no way to state. |

## 5. Verification — it matches the designer on all ten boards

Both archetypes independently arrive at the same slot set the designer
hand-picked, on all five channels, for single and dual:

| board | single | dual |
|---|---|---|
| fb 1200×628 | identical | identical |
| email 600×400 | identical | identical |
| google 300×250 | identical | identical |
| ksl600 300×600 | identical | identical |
| ksl850 300×850 | identical | identical |

It also found a **live co-op defect**: the hand-built templates give the 300×250
disclaimer 11px of frame (single) and 13px (dual), and the 600×400 twenty. A
fraction is not a size — 4.5% of a 250px board is eleven pixels. The archetype
floors every board at 22px.

Known imperfections, measured across all 40 rendered ads:

- **6 glyph overflows of 3–7px** in the archetype (the hand-built templates have
  15). Not clipped — the renderer doesn't clip — so it's a hair of spill, but the
  box heights are a touch tight for fitted type at those sizes.
- **`1.9% APR` reads redundantly** against its own label, and wraps on 300-wide
  boards. The cause is in the offer specs, not the archetype:
  [`offer-types.ts`](../src/lib/ad-generator/offer-types.ts) sets
  `defaultLabel: 'APR'` **and** `main.suffix: '% APR'`. Fix one of the two. This
  affects the hand-built templates identically.

## 6. The four numbers that are judgement, not arithmetic

Recovered by disagreeing with the tests and losing, twice. **Do not "simplify"
these without re-reading this section** — each reproduces a decision the designer
made by eye, and the hand-tuned layouts are the evidence.

| Constant | Value | Why |
|---|---|---|
| `DISCLAIMER_MIN_PX` | 22 | An ad without a legible disclaimer cannot run, so the disclaimer is the one slot with **no `shedAt`** at any size. Its strip is taken out of the content box *before* anything else is placed. |
| `OFFER_MIN_PX` | 34 | Below this the figure stops being the point of the ad. |
| `NARRATIVE_MIN_SHORT_EDGE_PX` | 280 | Below this short edge a board carries a price and a car, not a story. **Short edge, not area** — a 600×400 email has less area than a 300×850 KSL and comfortably carries everything, while a 300×250 does not. The hand-tuned Google layout dropped the tagline and vehicle name; the 300×600 KSL, same width with height to spare, kept both. |
| `DENSE_SHED_AT` | 4 | More offers on one board is a denser ad, so it sheds further. Two plates halve the width each gets, and an uppercase label with letter-spacing in a 130px column is noise even though its *frame* clears the height floor. The hand-tuned dual's 300×250 comment reads "Compact — two columns, no label (space)". |

And one shed rank that flips on offer count:

- **`vehicleName.shedAt` is 2 in a single and 6 in a dual.** In a single it's a
  caption under a product shot that already shows you the car, so it goes early.
  In a dual it is the **subject**: two prices with nothing saying which car each
  belongs to is a riddle, not a comparison — so it outranks even the expiration
  pill. The hand-tuned 300×250 dual kept both names and dropped the labels.

Shed order overall (lowest first): `tagline` 1 → `vehicleName` 2 *(single)* →
`vehicle` 3 → `offerLabel` 4 → `expiration` 5 → `vehicleName` 6 *(dual)*. Slots
sharing a rank shed **together** — dropping offer 1's label while offer 2 kept
its own would make two plates that exist to be compared disagree.

## 7. Locked decisions

1. **Automotive-specific, deliberately.** The `custom` kind stays for service /
   parts / hiring ads; it stops driving the builder's design. Powersports rides
   along free — same offer types.
2. **Archetypes are code-owned.** Same bar as offer kinds
   ([offer-kinds §10](./ad-generator-offer-kinds.md)) and for the same reason: an
   archetype carries layout rules and compliance expectations, so a
   half-configured one renders a silently broken or non-compliant ad. A designer
   owns the **theme** plus per-board overrides on the doc it produces, which are
   ordinary doc edits.
3. **An archetype outputs a `TemplateDoc`.** No new runtime, no new renderer, no
   migration for anything downstream. This is the property that keeps every phase
   below revertible.
4. **The disclaimer is never optional**, at any size, in any archetype.
5. **`from scratch` survives** as the escape hatch for one-off creative. It stops
   being how an OEM offer template gets made.

## 8. Phases

### Phase 1 — expose the computed offer label *(additive, hours)*

Add `_offerLabel` to `OFFER_TOKENS` (builder:322) with a per-type override on the
element. Removes one of the four hand-built copies from **every** template
immediately, including existing ones.

*Done when:* a designer can bind a text element to the offer label and it reads
"PER MONTH LEASE" on a lease and "APR" on an APR ad without a second element.

### Phase 2 — the offer plate element *(additive)*

Promote the plate to a first-class element with slots (label / symbol / figure /
suffix / terms) and per-type typography, so APR can be set larger than a lease
payment without a second copy. The `$`/`%` appear and disappear on their own —
the engine already returns them empty for the types that don't use them.

*Done when:* one element, placed once, renders correctly for all four types with
no `visibleWhen`; and the 16 `visibleWhen` references in the builder are only
about genuinely per-type *content*, not about switching plate copies.

### Phase 3 — archetypes in the builder *(the product)*

- A picker: "start from an archetype" listing Vehicle Offer, Two Vehicles, and
  per-store themed variants.
- A theme editor for the `Theme` surface (5 colours + fade).
- Seed the archetype docs (`scripts/seed-docs.ts` pattern) per rooftop.
- A **slot inspector**: selecting a slot shows what it is, not what it's bound to.

*Done when:* a designer can produce the Young Subaru single-offer template for
five channels without typing a coordinate, and the result is byte-comparable to
`youngSubaruSingleOffer()`.

### Phase 4 — retire the three controls *(mostly deletion)*

Once slots and archetype layout exist, Show For, "Edits apply to" and the
load-bearing Preview tabs have nothing left to do. Replace the preview tabs with
the **proof sheet** — every offer type × every board with its compliance check.
A throwaway generator for this already exists in this session's scratch; make it
a real route.

*Done when:* the builder has no edit-scope mode, the Layers panel is the design's
own layer list, and the proof sheet is the pre-publish check.

### Phase 5 — offers as a list

Replace the `o2_` twin fields with an indexed offer list. `offerPlate(i)` already
reads a prefix, so the archetype side is done; the field schema, the client form,
the disclaimer tokens and MarketCheck ingest are not.

*Done when:* a three-offer template needs no new fields and no new template.

### Phase 6 — compliance at design time

Named slots let the co-op engine check the **template** — disclaimer present and
legible at every size, OEM logo present, the fields this make requires actually
placed — instead of only checking rendered ads. This is the check that stops a
non-compliant template before it makes three hundred ads.

## 9. Traps

1. **`column` pays floors before weights.** A slot with a `minPx` can never come
   out under its floor *unless* the floors over-subscribe the rect, in which case
   everything squeezes proportionally. The shed rule (`crushed`) exists to detect
   exactly that squeeze. An earlier version tested "is the offer under 34px" and
   could never fail, because the floor guaranteed it wasn't.
2. **A pixel floor must survive 4dp rounding.** `floorFrac` ceilings it. Without
   that, a 22px minimum lands at 21.996px on a 90px-tall board.
3. **`present()` and `layout()` must agree.** `buildArchetypeDoc` filters boxes to
   present slots, so a slot the layout forgot is silently absent. The
   completeness test covers this; keep it.
4. **`presentFor` calls `layoutFor` in a loop.** It is O(shed ranks × layout), all
   pure arithmetic, and memoisation is not worth the staleness risk.
5. **Slot ids are the doc's element ids.** They must stay stable or per-board
   overrides on saved docs break. Offer 0 deliberately keeps the bare ids
   (`offerMain`, not `o1_offerMain`) so the single's docs never churn.
6. **Local rendering has no photos.** No media rows and no S3, so the vehicle
   slot and the logo are blank on every locally rendered board — the right half
   of a wide board looks empty and is not. See
   [asset-management](./asset-management.md).

## 10. Explicitly rejected

- **A general constraints / auto-layout engine** (anchors, stacks for arbitrary
  compositions). This was the plan until the automotive-specific decision.
  Archetype layout rules do the job for a known anatomy, cheaper and more
  correctly, and this is the single biggest saving in the whole rebuild.
- **Designer-authored archetypes.** See §7.2.
- **Variants as the default workflow.** An earlier draft made offer type a
  first-class variant axis. The offer plate covers the common case, so variants
  would be a per-type *layout override* — worth adding only if §11.1 says the
  compositions genuinely differ.
- **Reversing the fixed-schema decision.** Untouched, and correct — see
  [offer-kinds §1](./ad-generator-offer-kinds.md).

## 11. Open questions

1. **How much per-type layout difference is real?** If APR is the same plate with
   a different number, Phase 2 finishes the job. If APR is a genuinely different
   composition, the archetype needs a per-type layout override.
2. **Per-OEM archetypes, or one archetype themed per make?** The prototype
   assumes the latter (Young Subaru is a theme, not an archetype). Ford and the
   powersports stores will settle it.
3. **Can the existing published templates be rebuilt rather than migrated?** If
   they must survive untouched — co-op approvals are tied to a design — Phase 3
   is conservative and slower.
4. **Which numbers in §6 are wrong?** They reproduce the designer's decisions on
   ten boards, which is not the same as being right on the eleventh. The proof
   sheet is how to find out.
