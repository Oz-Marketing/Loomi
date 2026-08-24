# Ad Generator — Archetypes

Status: **Phases 1–3 shipped** 2026-08-23. The layout engine is proven against
both real Young Subaru templates (§5), and archetypes are now in the builder: a
designer picks a layout, gets every board, and edits the theme. Both hand-built
templates still ship unchanged and untouched — nothing has been migrated onto an
archetype, and nothing has to be. **Phases 4–6 in §8 are the remaining work**,
and they are the deletions: the three confusing controls, the `o2_` twins, and
compliance moving to design time.

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
| [`archetypes/types.ts`](../src/lib/ad-generator/archetypes/types.ts) | 158 | The contract + `buildArchetypeDoc` + `shedOrder`. `Theme` itself lives in `doc-types` now, because a produced doc stores the theme it wears. |
| [`archetypes/vehicle-offer-archetype.ts`](../src/lib/ad-generator/archetypes/vehicle-offer-archetype.ts) | 466 | The archetype family. Slots, floors, the shed rule, the two layout branches. |
| [`archetypes/young-subaru-archetype.ts`](../src/lib/ad-generator/archetypes/young-subaru-archetype.ts) | 80 | Young Subaru as a **theme**. Two colours and a fade angle is the whole of what a designer chose. |
| [`archetypes/registry.ts`](../src/lib/ad-generator/archetypes/registry.ts) | 156 | The starting points the builder offers, and `docFromStart`. An entry is an archetype + a theme + a channel set + a rooftop. |
| [`archetypes/theme.ts`](../src/lib/ad-generator/archetypes/theme.ts) | 89 | `applyTheme` — a retheme as a recolour, keeping every later edit. |
| [`archetypes/roles.ts`](../src/lib/ad-generator/archetypes/roles.ts) | 79 | What each role IS, in a designer's words. The copy behind the slot inspector. |
| [`archetypes/archetypes.test.ts`](../src/lib/ad-generator/archetypes/archetypes.test.ts) | 480 | The invariants the hand-authored layouts had no way to state. |
| [`archetypes/registry.test.ts`](../src/lib/ad-generator/archetypes/registry.test.ts) | 157 | Every starting point is complete, renders, and matches the archetype doc it names. |
| [`archetypes/theme.test.ts`](../src/lib/ad-generator/archetypes/theme.test.ts) | 111 | A recolour repaints the design and keeps the designer's work. |

76 tests across the five suites.

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

Known imperfections, re-measured 2026-08-24 across 26 boards (both archetypes,
both compositions, and both hand-built docs):

- **Nothing overflows its frame.** Zero elements exceed their box by the metric
  the renderer fits to — `inner.scrollWidth` against the available width and the
  *trimmed* ink box against the available height.

  An earlier version of this section claimed 6 overflows of 3–7px in the archetype
  and 15 in the hand-built docs. **That measurement was wrong**: it compared a
  `Range` rect against the box, and a Range over inline content returns the union
  of LINE BOXES, which includes the leading that `text-box: trim-both` removes from
  what is painted. Measuring line boxes against a frame the fitter sizes by ink
  will always report spill that is not there. Beware repeating it — the builder's
  own `measureGlyphs` uses a Range for a different purpose (hugging a text box to
  its content) where the leading is wanted.

- ~~**A two-offer board renders its two figures at different sizes.**~~ **FIXED.**
  Each figure fitted its own box, so a short string in a wide column grew until its
  WIDTH bound while a longer one was bound by HEIGHT first: 71px of ink against 134
  on the square, 152 against 285 on the story. A comparison implies the two offers
  are shown on equal terms, and the bigger number read as the better deal.

  `DocElement.fitGroup` groups elements that must settle on one size, and the dual
  archetype pairs each row. **Not the minimum of the individual sizes** — the
  smallest member may be small because it WRAPS, and a wrapping label at another
  member's size overflows ("PER MONTH LEASE" beside "APR" on a 600×400 dual, by
  18px). The group takes the largest size at which every member fits. Verified
  across 8 dual boards: every pair matches and nothing overflows.

  The hand-built dual still has the fault (79 vs 108 on Facebook); it declares no
  fit group. One more reason to re-cut it from the archetype rather than migrate it.

- **`1.9% APR` reading redundantly is FIXED.** `offer-types.ts` set
  `defaultLabel: 'APR'` and `main.suffix: '% APR'`, so the figure repeated its own
  label. The suffix is `%` now, and a separate `proseSuffix: ' APR'` keeps the
  sentence form ("1.9% APR for 60 months") that `deterministicCopy` needs. The
  creative shows the figure; only sentences carry the words.

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

### Phase 1 — expose the computed offer label — **SHIPPED**

Add `_offerLabel` to `OFFER_TOKENS` (builder:322) with a per-type override on the
element. Removes one of the four hand-built copies from **every** template
immediately, including existing ones.

*Done when:* a designer can bind a text element to the offer label and it reads
"PER MONTH LEASE" on a lease and "APR" on an APR ad without a second element.

### Phase 2 — the offer plate element — **SHIPPED**

Promote the plate to a first-class element with slots (label / symbol / figure /
suffix / terms) and per-type typography, so APR can be set larger than a lease
payment without a second copy. The `$`/`%` appear and disappear on their own —
the engine already returns them empty for the types that don't use them.

*Done when:* one element, placed once, renders correctly for all four types with
no `visibleWhen`; and the 16 `visibleWhen` references in the builder are only
about genuinely per-type *content*, not about switching plate copies.

### Phase 3 — archetypes in the builder *(the product)* — **SHIPPED**

- ✅ A picker: **"Or start from a layout"** on the blank-canvas card, from
  `archetypes/registry.ts`. Four starting points: Vehicle Offer and Two Vehicles
  (which use `brand: 'brand'`, so they paint themselves from whichever account
  the ad is for), plus the two Young Subaru presets on their five channels.
  Picking one is a single `setDoc`, so it lands in undo.
- ✅ A theme editor, in Template settings, for any doc an archetype produced. The
  doc now RECORDS its theme (`doc.archetype`), which is what makes it editable
  after the fact.
- ✅ A slot inspector: elements carry their `role`, and the selection panel reads
  `archetypes/roles.ts` to say what the layer is *for* — with the rule the layout
  applies to it and the pixel floor it will not go under.
- ✅ Seeding: `scripts/seed-archetype-templates.ts`, per rooftop, drafts only.
  Deliberately **not** in the deploy chain — same rule as every other Ad
  Generator seed.

*Done:* one click produces the Young Subaru template on all five channels, and
`registry.test.ts` asserts the result is byte-comparable to
`youngSubaruSingleOffer()` / `youngSubaruDualOffer()` in everything but the
template's own id and name.

**A retheme is a recolour, not a rebuild.** `archetypes/theme.ts` re-runs the
slots against the new theme and copies across only the four keys a theme owns
(`color`, `fill`, `bg`, `gradientFill`), matching by element id. Geometry,
bindings, layer names, hand-placed layers and non-colour overrides all survive.
A per-size override that PINNED a colour is dropped — otherwise the retheme would
appear to fail on exactly the one board the designer was not looking at.

**Found while verifying, and fixed:** the expiration pill set `padding: 12`, and
an element's padding is emitted as literal pixels on every board. Comfortable
inside a 72px pill on Facebook; it ate 24 of the 30 pixels the same pill gets on
the Google 300×250 and shrank the date to **six pixels**. Dropping it lets the
renderer's board-relative inset do the work (6.4px → 15.8px, measured). A test
now refuses any archetype slot that states padding, or any layout box that states
a font size, for the same reason: a number in pixels is a number that only ever
suited one board.

### Phase 4a — the proof sheet — **SHIPPED**

The additive half of Phase 4, taken first because it stands on its own: the
scratch generator is now a route.

- ✅ `lib/ad-generator/proof-sheet.ts` — `buildProofSheet` is pure, and takes the
  doc, the OEM rule, the co-op pack and the replayed design verdict exactly as the
  preflight endpoint does. So the sheet and the generation pipeline cannot
  disagree about the same template.
- ✅ `POST /api/ad-generator/templates-doc/[id]/proof` — read-only, `persist:
  false` on the verdict, and it accepts an in-flight `doc` so a future in-builder
  panel needs no new endpoint.
- ✅ `/ad-generator/proof/[id]` — the grid, at **one shared scale** for every
  board. Reachable from the builder's cog and from the template row menu.

*Done:* the pre-publish read is one page. Verified against the local library —
the sheet draws every board, attributes each finding to the ad it happened in,
and states the six Mazda design rules that template fails once each, with
citations.

**A design fault is stated once.** The design-time co-op verdict is replayed into
every ad, so filing those findings per row printed the same six rules **105
times**. `PreflightIssue.scope: 'design'` marks them; the sheet hoists them into
one list keyed by rule, each line carrying the offer types it failed under. 105
warnings became 16, and they now point at the designer instead of at the data.
Rows still block on them: the fault being the template's does not make the ad
shippable.

**The offer-type palette is shared.** It lived in a table in the builder page, so
the sheet would have needed a second copy of the same claim of identity — violet
means APR. `lib/ad-generator/offer-type-style.ts` owns it now, with the short
labels the builder shipped with, and a test that every type any kind offers can
be drawn.

### Phase 4b — retire the three controls *(surveyed, and smaller than it looked)*

"Edits apply to" and the load-bearing Preview tabs have nothing left to do once a
design serves every offer type from one plate and the proof sheet is the
pre-publish check. **Show For is a different matter, and the survey changed the
plan.**

`scripts/survey-show-for.ts` classifies every template — code-defined always, and
saved ones wherever `DATABASE_URL` points — into three buckets. Against the code
library plus a dev database (15 templates):

| | |
|---|---|
| 11 | no offer-type gating at all — the deletion costs them nothing |
| 2 | mechanical: the only gated layers are a currency mark and a percent mark, which the plate renders on its own (`_offerCurrency` comes back empty for the types that don't use it) |
| 2 | carry content in the gate |

⚠️ **Run it against staging and prod before acting** — a dev database is not the
library. The number that matters is the third bucket's, wherever the real
templates live.

**What the third bucket actually contains matters more than its size.** Not plate
copies: `costPerThousand` shown only on an APR ad, `discountSource` only on a
discount, `msrp` only where a saving is claimed. Those are per-type DISCLOSURES,
and no plate renders them, because they are not part of the offer figure — they
are extra legal lines that one offer type requires and another does not.

**So the original plan was wrong.** Deleting Show For outright would delete the
only way to say "this line appears on APR ads". What Phase 2 removed was the
*need* to use Show For for plate switching; the residual use is legitimate and
should stay.

Where the three controls now stand:

- ✅ **Show For is narrowed.** On a layer that renders the offer itself — a plate,
  or anything bound to a computed `_offer*` token — the control is withheld and
  says why, because the engine already resolves the right words for every type and
  gating such a layer can only blank the ad for the excluded ones. That was the
  mechanism behind per-type plate copies and behind "the Show For labels make it
  extremely finicky". `bindsOfferToken` in `doc-types.ts` is the predicate; the
  tooltip now describes a per-type *disclosure*, which is what the control is for.
- ✅ **Preview tabs → the proof sheet** (Phase 4a).
- ⚖️ **"Edits apply to" DEFAULTS to All sizes** rather than being retired. The
  original plan was deletion; the honest read is that per-board work is legitimate
  (the deliberate exceptions in §5 of this doc), and what was wrong was the
  default. It shipped as this-size-only because broadcasting was unreliable —
  position travelled as a coordinate, z-order and hidden state didn't travel at
  all. Those are fixed, so broadcasting is the tested path, and the old default was
  producing the very drift it was meant to prevent. The control stays as a
  deliberate act, storage key bumped so a remembered `size` doesn't keep the old
  behaviour for exactly the people who complained.

**Left:** migrate the two mechanical templates the survey found (a currency mark
and a percent mark gated by type, which the plate renders on its own).

*Done when:* no template in the library uses Show For for anything but a per-type
disclosure.

### Phase 5 — offers as a list *(the engine half is done; the UI half is deferred)*

The plan was to replace the `o2_` twin fields with an indexed offer list. Half of
that turned out to be a **latent bug rather than a feature**, and that half is
done. The other half is a capability nobody has asked for, and it is deferred
deliberately.

**What the doc format already allowed.** Every consumer takes a *prefix*, and
`offerFieldPrefix` has always returned `o3_` for a plate with `offerIndex: 2`. So a
third offer was already expressible. What did not allow it was the ENGINE, which
iterated the literal pair `['', 'o2_']` in half a dozen places — `enrichOfferFields`,
`preflight`'s `baseKey` and its `_o2_offerTerms` exemption, `OFFER_TOKENS_O2`,
`OfferSlot`. A third offer therefore got no computed values, no placeholder guard
and no compliance check, while looking to a designer like any other offer.

✅ **Fixed.** `offerSlotPrefix` / `offerSlotPrefixes` / `offerSlotBaseKey` in
`doc-types.ts` are the one rule, the engine iterates the slots the data actually
carries, and `offerTokensForSlot(i)` replaces the hand-written second-offer twins.
`offer-slots.test.ts` holds it: a third offer is computed, guarded and checked
exactly like the first two.

✅ **And a live bug it uncovered, which matters more.** Preflight only inspected
elements whose `binding.kind === 'field'` — and an offer PLATE has no binding, it
renders three assembled values chosen by its `offerIndex`. So a plate-based
template, which is what the builder's Offer element creates, was **completely
unguarded**: a design whose figure would render `$X,XXX/mo` passed preflight clean,
and on the unattended pipeline that means publishing it. `elementBoundKeys` now
answers "what does this element read" for both shapes, and preflight uses it for
the placeholder guard and the empty-binding check.

⏸️ **Deferred, on purpose:** the field kit, the client form's offer cards, and the
MarketCheck slot mapping still assume two. Making them n-offer is maybe a day, and
it buys a three-offer template that nobody has asked for — in the highest-blast-radius
area of the generator, weeks before launch. The engine no longer stands in the way,
which was the part worth doing now.

*Done when:* somebody actually wants a three-offer ad. Then: `addFieldKit` takes a
count, `offer-card.tsx` renders per slot, and `ad-facets`' `SLOTS` grows if the
feed ever fills a third.

### Phase 6 — compliance at design time — **SHIPPED**

`lib/ad-generator/template-audit.ts` — the house minimum, checked on the
TEMPLATE. Pure, and pack-independent, which is the whole point: most makes have
no transcribed co-op pack, so for most templates every co-op check is a no-op and
a design with no disclaimer on the 300×250 passes for want of anything to check
it against.

What it holds a template to:

| Check | Severity | Rests on |
|---|---|---|
| `disclaimer_absent` | error | no element renders `disclaimer` |
| `disclaimer_off_board` | error | no box on some board, or hidden there |
| `disclaimer_illegible` | error under 10px, warning under 22px | declared font size, else box height |
| `required_field_unplaced` | error | the type's own required fields + the make's |
| `dealer_unidentified` | warning | no logo and no dealer name anywhere |
| `element_off_board` | warning | box outside 0..1 by >20% of its own extent |
| `text_illegible` | error | same ceiling rule as the disclaimer |

**An error means IMPOSSIBLE, not "probably bad."** There is no browser here, so
nothing measures a glyph. A declared font size is a fact, and a text box's height
in pixels is a hard ceiling on how tall one line inside it can be — every error
rests on one of those two. Anything softer is a warning, and anything needing real
measurement belongs to the proof sheet's eyes.

The findings surface in the proof sheet's fault list beside the co-op ones, tagged
`source: 'audit'` and drawn as **design check** rather than borrowing a
manufacturer's citation. A blocking design fault now fails the whole sheet even
when every row's data checks out — a template with no disclaimer makes nothing
shippable, and preflight would never say so, because no ad-level *value* is at
fault.

**One claim, one implementation.** `surfacedFields` and `elementFieldRefs` were a
`useMemo` and a helper inside the builder page, so nothing else could ask "does
this design actually show the field this make requires". They moved into the audit
module; the builder's compliance chip now calls the same function, and the answer
is available server-side, where a page component's helper could never go.

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

1. ~~**How much per-type layout difference is real?**~~ **ANSWERED: none, for the
   vehicle kind.** One plate serves lease, APR, discount and sale price with no
   conditional visibility anywhere in the composition, and the proof sheet draws
   all four on every board so the claim is checkable rather than asserted. The
   `visibleWhen` gating that remains in the library is per-type DISCLOSURES (cost
   per $1,000 on APR, the source of a discount) — extra lines one type requires,
   not a different layout. No per-type layout override is needed.
2. **Per-OEM archetypes, or one archetype themed per make?** The prototype
   assumes the latter (Young Subaru is a theme, not an archetype). Ford and the
   powersports stores will settle it.
3. **Can the existing published templates be rebuilt rather than migrated?** If
   they must survive untouched — co-op approvals are tied to a design — Phase 3
   is conservative and slower.
4. **Which numbers in §6 are wrong?** They reproduce the designer's decisions on
   ten boards, which is not the same as being right on the eleventh. The proof
   sheet is how to find out.
