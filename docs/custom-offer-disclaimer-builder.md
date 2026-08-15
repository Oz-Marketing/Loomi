# Custom Offer Disclaimer Builder

Status: **proposal** — not built. Written 2026-08-14 after reviewing a standalone
mock (`disclaimer-builder.zip`) against Loomi's existing disclaimer and co-op
machinery.

---

## 1. What this is

A guided flow for building a compliant disclaimer for a **custom dealer offer** —
an offer the dealer invented, not one backed by a national OEM incentive bulletin.

Loomi handles the OEM-backed case well: when a MarketCheck incentive is applied,
its own fine print is used verbatim and outranks everything we would compose
([disclaimer-resolve.ts](../src/lib/ad-generator/disclaimer-resolve.ts)). The
custom case falls through to a two-row template library and a code default.

Three concrete gaps:

1. **No MAAP capability anywhere.** Both transcribed co-op packs explicitly gave
   up on it — Mazda §1a–1h and Subaru Category 7 are marked *"not expressible"*
   because they need Dealer Invoice, which Loomi does not hold
   ([seed-coop-pack-mazda.ts:63](../scripts/seed-coop-pack-mazda.ts)).
2. **The automotive template library is two rows** — Kia APR and Volkswagen Lease
   ([seed-disclaimer-templates-odt.ts](../scripts/seed-disclaimer-templates-odt.ts)).
3. **No place to enter the fields OEM lease disclaimers actually require** —
   acquisition fee, disposition fee, overage rate, selling price, customer down.
   The token engine has no slug for any of them.

## 2. Provenance, and what we are and are not taking from the mock

The mock is a Vite + Express app: a form, deterministic math, and a Claude call
that assembles the disclaimer prose, decides MAAP status and co-op eligibility,
and emits Monday.com board values.

**Taken:**

- The form design and field list. It is the right shape and it is the part that
  took real domain knowledge.
- The **Audi** and **Volkswagen** template bodies. These are real full-length OEM
  language, and they parameterise fees that our seeded VW row hardcodes.
- The idea of **asking a human for Dealer Invoice Total**. This is the correct
  answer to the MAAP problem and the best idea in the package.
- The deterministic calculations (payments total, total miles) and the money
  parser.

**Not taken, with reasons:**

| Not taken | Why |
|---|---|
| The model writing the disclaimer | Loomi treats "the AI never writes legal text" as an invariant ([types.ts:36](../src/lib/ad-generator/types.ts)). Pre-computing the numbers does not fix it — the model still emits the sentence and can drop a required clause. The Co-op team signing off a model-authored string is a different liability from signing off a template. |
| `disclaimer-builder-rules.json` | Uncited, unversioned prose, and 17 of its 19 brands ship `...` placeholder bodies that would have the model invent the missing clauses. It would sit beside a guideline register that already holds the real PDFs, content-hashed. |
| The global 20% down-payment cap | See §6. The mock's own data contradicts it. |
| Substring prohibited-term matching | `indexOf` means Audi's banned "Sale" fires inside "wholesale". Our Subaru pack already documents the fix: transcribe phrases, not bare verbs ([seed-coop-pack-subaru.ts:227](../scripts/seed-coop-pack-subaru.ts)). |
| The standalone Express server | No auth, no persistence, no audit trail. `/api/generate` takes a caller-controlled system prompt — an open proxy for our API key. |

## 3. Locked decisions

1. **The disclaimer is composed deterministically.** Token substitution only. If
   a model is involved at all, it is confined to *suggesting replacement wording
   for a flagged prohibited term* — never the disclaimer body.
2. **Rules live in `AdCoopRulePack`**, versioned and cited, never in a new file
   format. Prohibited lists become `banned_phrase` rules, which means they also
   police AI ad copy for free ([generate-copy.ts:230](../src/lib/ad-generator/automation/generate-copy.ts)).
3. **The Oz Co-op team is the verifier.** This maps onto existing columns —
   `AdCoopRulePack.verified / verifiedBy / verifiedAt`. Unverified packs still
   evaluate but downgrade findings to warnings, so transcription can be
   incremental without freezing a brand's month.
4. **OEM keys use Loomi's canonical brand vocabulary** ([oems.ts](../src/lib/oems.ts)).
   No aliases, no composite pseudo-makes.
5. **Monday.com output is a copy-to-clipboard panel, not an API integration.**
   See §7.

## 4. Field and slug mapping

### 4.1 Offer types

The mock has three; Loomi has five ([offer-text.ts:15](../src/lib/ad-generator/offer-text.ts)).

| Mock | Loomi `offerType` |
|---|---|
| Lease | `lease` |
| Finance | `apr` |
| Cash | `sales_price` |
| — | `discount` (no mock counterpart; keep) |
| — | `custom` (free text; keep) |

### 4.2 Existing slugs — no change

Mock token → Loomi slug → `AdData` key.

| Mock token | Loomi slug | `AdData` key |
|---|---|---|
| `{EXPIRATION_DATE}` | `offer_end_date` | `expiration` |
| `{MODEL_YEAR} {MODEL} {TRIM}` | `vehicle` | `vehicleName` (combined) |
| `{MSRP}` | `msrp` | `msrp` |
| `{VIN}` | `vin` | `vin` |
| `{DEALER_DBA}` | `dealership_name` | `dealerName` (account branding) |
| `{APR}` | `apr_rate` | `aprRate` |
| `{MONTHLY_PAYMENT}` | `monthly_payment` | `monthlyPayment` |
| `{ADVERTISED_PRICE}` | `sale_price` | `salePrice` |
| `{FINANCIAL_INSTITUTION}` | `financial_institution` | `financialInstitution` |
| `{TERM}` | `lease_term` **or** `apr_term` | `leaseTerm` / `aprTerm` |

> `{TERM}`: the mock has one `term` input reused across lease and finance. Loomi
> keeps them separate and should continue to — a template that says "for {TERM}
> months" needs to resolve differently per offer type, and one shared key makes
> that ambiguous at substitution time.

Loomi slugs with no mock counterpart — `due_at_signing`, `security_deposit`,
`cost_per_thousand`, `discount_amount`, `discount_source`, `stock_number` — are
unaffected and stay.

### 4.3 New slugs (11)

Nine are new form inputs; two are **derived** and must never be typed.

| New slug | New `AdData` key | Type | Notes |
|---|---|---|---|
| `selling_price` | `sellingPrice` | input | Cap cost. Distinct from `msrp`. |
| `customer_down` | `customerDown` | input | **Not** `dueAtSigning`. Due at signing = first payment + acquisition fee + customer down. Conflating them is a compliance error. |
| `acquisition_fee` | `acquisitionFee` | input | |
| `disposition_fee` | `dispositionFee` | input | |
| `overage_rate` | `overageRate` | input | e.g. `$0.20` |
| `miles_per_year` | `milesPerYear` | input | |
| `amount_financed` | `amountFinanced` | input | APR offers |
| `states` | `states` | input | e.g. `ID; UT; WA; OR; CO` |
| `dealer_code` | `dealerCode` | input | |
| `total_miles` | — | **derived** | `milesPerYear × (leaseTerm ÷ 12)` |
| `monthly_payments_total` | — | **derived** | `monthlyPayment × term` |

Plus two MAAP-only inputs that are *not* slugs (they never appear in disclaimer
text — they feed the check):

| `AdData` key | Notes |
|---|---|
| `dealerInvoiceTotal` | |
| `maapAllowance` | |

New fields are added to `vehicleOffer.fields`, which is the single source for
`SYSTEM_FIELDS` ([system-fields.ts:20](../src/lib/ad-generator/system-fields.ts)) —
so they reach the form, the designer's binding picker, and OEM required-field
rules in one edit. All new offer fields should carry
`visibleWhen: { field: 'offerType', in: [...] }` so a Cash offer does not show a
disposition fee.

### 4.4 Two bugs to fix in the seeded VW template

Independently of this work, `seed-disclaimer-templates-odt.ts` has two
substitution errors in the Volkswagen Lease body (as seeded; the DB row may have
been edited since):

- `resulting in a Selling Price of {{msrp}}` — selling price renders as MSRP.
- `Monthly payments total {{monthly_payment}}` — renders the monthly payment, not
  payment × term.

Both are fixed by the new `selling_price` and `monthly_payments_total` slugs. The
mock's Audi/VW bodies already parameterise the `$699` / `$395` / `$0.20` /
`30,000` literals our row hardcodes, and should replace them.

### 4.5 OEM key mapping

15 of the mock's 19 keys map cleanly. Four do not.

| Mock key | Loomi canonical | Action |
|---|---|---|
| Mazda, Subaru, Audi, Ford, Genesis, Yamaha, Arctic Cat, LS Tractor, Suzuki, Honda Powersports, Indian Motorcycle, Harley-Davidson, Kawasaki | same | none |
| `KIA` | `Kia` | store canonical (lookup is case-insensitive, so low risk) |
| `CFMOTO` | `CFMoto` | store canonical |
| `VW` | `Volkswagen` | ✅ alias map in `normalizeOems` |
| `CDJRF` | `Chrysler`, `Dodge`, `Jeep`, `Ram` (+`Fiat`) | ✅ group, via `expandBrandGroup`. Stellantis publishes one guideline set, but an ad keys off a single vehicle make, so it must become 4–5 pack rows — never one brand. |
| `BRP (Can-Am/Ski-Doo/Sea-Doo/Lynx)` | `Can-Am`, `Ski-Doo`, `Sea-Doo` | ✅ group. Lynx deliberately omitted — not in `oems.ts`; add only if Young sells it. |
| `New Holland` | `New Holland` | ✅ added to `POWERSPORTS_BRANDS`. See §8. |

Loomi powersports brands with **no** mock coverage: Ducati, Husqvarna, KTM,
Polaris, Royal Enfield, Sherco, Triumph.

## 5. MAAP

MAAP is the one capability that needs new engine work. `coop-rules.ts` has six
rule kinds and **none of them does arithmetic** — they match phrases, check
element presence, and compare geometry.

**Built** as a seventh kind, `numeric_limit` — one kind covering both floors and
ceilings, since the down-payment caps in §6 need the same machinery:

```ts
export interface NumericLimitRule extends CoopRuleBase {
  kind: 'numeric_limit';
  field: string;              // the advertised figure under test
  bound: 'min' | 'max';       // floor, or ceiling
  limits: LimitTerm[][];      // CANDIDATE limits, each a sum of terms
  select?: 'lowest' | 'highest';   // which candidate governs, when >1
}
```

`limits` is a list of candidates because at least one brand states its cap two
ways at once ("15% of MSRP or $3,500"). Deliberately not a general expression
language: sums of scaled terms cover every formula we've been shown, and anything
richer would produce rules nobody could read back against the guideline.

Three properties worth keeping when transcribing:

- **A blocked ad gets the arithmetic**, not a verdict — the finding reads
  `salePrice is $39,000; the floor is $40,200 (Dealer invoice − allowance = $40,200)`.
- **"Couldn't check" is never silence.** A missing figure produces a warning
  saying so, at warning severity regardless of the rule's own severity — so a
  number the dealer cannot supply can't block their month, but nobody mistakes
  the gap for a pass.
- **Ambiguity is a fault in the rule.** Several candidate limits with no `select`
  is reported as malformed rather than resolved by guessing.

Each OEM's formula is transcribed **from its own guideline document** — they
genuinely differ, and the mock's single `invoice − allowance` reference
calculation is wrong for most of the brands it ships:

- Mazda: Dealer Invoice + D&D − unrestricted consumer-facing incentives
- Subaru: Subaru Official Invoice Price (inclusive of D&D)
- Audi: MSRP − customer-facing incentives − marketing allowance − allowable dealer deduction
- Volkswagen: Dealer Invoice Total − monthly MAAP allowance

`price_floor` is `content`-scoped in `RULE_SCOPE` — it varies per ad, so it runs
in preflight, not at design time.

## 6. The down-payment cap

The mock applies `DOWN_CAP_RATE = 0.2` to every OEM as a hard FAIL, with the
comment `(VW/general rule)`. **The mock's own rules file contradicts this.** Only
two of its 18 entries state a cap:

- Volkswagen: *"Max customer down = MSRP × 20%"*
- Kia: *"Max lease amount due at signing: 15% of MSRP or $3500"*

So as written it blocks compliant Audi, Ford, Subaru and Genesis ads while
letting non-compliant Kia ads through. Kia's limit is also on **amount due at
signing**, a different quantity from **customer down** — see §4.3.

This becomes a per-make rule with a citation, one for VW and one for Kia, and
nothing for anyone else until the Co-op team says otherwise. It needs the same
`price_floor`-style arithmetic (a ceiling rather than a floor), so treat it as
part of the §5 work.

## 7. Monday.com

**There is no Monday integration in Loomi.** No package, no `MONDAY_*` env var,
no API route — every "Monday" hit in the repo is a day-of-week in the pacer or
date picker.

Writing to a Monthly Offer board would mean building against Monday's GraphQL
API: a stored token, board and column IDs that break when someone renames a
column, and error handling for a system due to be retired inside a year
(Projects replaces Monday, committed 1 Apr 2027).

**Decision: ship the copy-to-clipboard panel, not the writer.** The mock already
has this — a "Monday board values" block with per-field and copy-all buttons. It
costs nothing, works on day one, and disappears cleanly when Monday does.

Worth noting: `AdDisclaimerTemplate` and `AdOemOfferRule` were both ported *from*
ODT's Monthly Offers system. The real destination for this output is Loomi's own
offer records; the Monday panel is a bridge.

## 8. Powersports and agriculture

Powersports is already a first-class industry — `VEHICLE_INDUSTRIES`,
`POWERSPORTS_BRANDS` (19 brands), and templates tagged
`industries: ['Automotive', 'Powersports']`.

Agriculture is not. `BEHAVIOR_INDUSTRIES` knows only automotive and powersports
([industries-tab.tsx:26](../src/components/settings/industries-tab.tsx)), and
LS Tractor is currently filed under powersports. New Holland is absent entirely.

Two options:

- **(a) File ag brands under powersports.** One-line change: add New Holland to
  `POWERSPORTS_BRANDS`. Consistent with how LS Tractor is already handled.
  Mislabels the industry but costs nothing.
- **(b) Add a real `agriculture` industry.** Cleaner, but touches
  `VEHICLE_INDUSTRIES`, and the EVOX/MarketCheck vehicle tooling has no tractor
  coverage — an ag account would get a vehicle picker that returns nothing.

**Recommend (a) for now**, revisit if ag becomes more than a couple of brands.
The disclaimer work does not depend on the answer.

## 9. Phased plan

Phases 1–2 deliver a working feature. Phases 3–5 deepen it and can be reordered
against whatever the Co-op team supplies first.

### Phase 0 — inputs (blocking, not engineering)

Nothing below is useful without these. See §10.

### Phase 1 — slugs and fields

- Add the 11 slugs to `DISCLAIMER_SLUGS` and the 11 inputs to
  `vehicleOffer.fields`, all `visibleWhen`-gated by offer type.
- Compute `total_miles` and `monthly_payments_total` in `buildTokenValues`.
- Replace the seeded Audi/VW template bodies with the mock's parameterised
  versions; fix the two substitution bugs in §4.4.
- Extend the token highlighter and the disclaimer editor's slug list.

No new UI. This alone upgrades every existing template and is independently
shippable.

### Phase 2 — the custom offer flow

**Scope corrected during implementation.** Three of the five items were already
built; only the summary was actually missing.

Already present, no work needed:

- **The explicit offer source.** `offerSource: 'oem' | 'manual'` already exists
  on the creative page as a tab pair — *OEM Incentive* / *Manual entry*
  ([offer-card.tsx:99](../src/components/ad-generator/client-form/offer-card.tsx)).
  The earlier claim that Loomi "has no name for" this distinction was wrong; it
  has the same name the mock uses.
- **The Programme section.** Phase 1's fields carry `group: 'Programme'`, and the
  form renders group sections generically, so the card appeared without any page
  change.
- **Missing required fields.** `missingRequired` already surfaces them and blocks
  export.

Built in this phase:

- **`deriveOfferFigures`** extracted in `disclaimer.ts` and shared, so the summary
  panel and the disclaimer cannot state different numbers.
- **`offer-summary.ts`** — the calculated rows and the board handoff, pure and
  tested.
- **`OfferSummaryCard`** — shows each derived figure with its arithmetic
  ("$389 × 36 mo"), then the Monthly Offer board values with per-row and
  copy-all buttons. Manual entry only: an applied OEM incentive uses the
  manufacturer's verbatim fine print, so there is no derivation of ours to check.

Deferred to Phase 3:

- **Co-op standing on the creative page.** It lives per TEMPLATE in
  [`AdTemplateCoopApproval`](../prisma/schema.prisma), needs a fetch this page
  doesn't currently make, and is deliberately ABSENT from the board handoff
  rather than guessed — see the note in `boardValues`.

### Phase 3 — MAAP and caps

Engine done; the rule DATA is blocked on the Co-op team.

- ✅ The `numeric_limit` rule kind (§5), `content`-scoped.
- ✅ `numbers.ts` — one shared figure parser. The disclaimer engine states a
  figure and these rules decide whether it's permitted; parsing "$3,999" even
  slightly differently would let a rule block an ad the disclaimer renders fine,
  invisibly to whoever got blocked.
- ✅ Co-op standing surfaced on the creative page, read-only, from the approval
  record (deferred here from Phase 2).
- ⛔ **Per-OEM MAAP formulas and the VW/Kia caps.** Deliberately not written.
  The mechanism accepts them the moment the Co-op team confirms the formula, the
  quantity each cap applies to, and the section it comes from — §10 items 2 and 3.

### Phase 4 — prohibited language

The largest job, and the one that pays off most: transcribe each OEM's
prohibited list into `banned_phrase` rules with word boundaries and citations.
Existing packs (Mazda, Chevrolet, Subaru) show the standard — including the
distinctions a flat list cannot express, such as Subaru permitting "special
financing" while banning "special purchase".

These rules apply to ad copy automatically, so this phase improves the AI
copywriter at the same time.

### Phase 5 — powersports and ag coverage

Mechanical half done; the packs are blocked on the Co-op team.

- ✅ §8 resolved as option (a) — `New Holland` added to `POWERSPORTS_BRANDS`
  alongside `LS Tractor`. No `agriculture` industry.
- ✅ `VW` → `Volkswagen` via an alias map in `normalizeOems`, with the other
  shorthand in real use (`Chevy`, `Mercedes`, `Harley`, `Can Am`, …). This was
  the silent one: an account stored as `VW` matched no pack, no disclaimer
  template and no OEM rule, and looked exactly like a brand with none on file.
- ✅ `CDJRF` / `CDJR` / `BRP` encoded as GROUPS via `expandBrandGroup`, kept
  deliberately out of `normalizeOems` — callers that take the first result
  (media scoping) would otherwise pick Chrysler for a Jeep.
- ⚠️ `expandBrandGroup` has **no runtime caller yet**. Group acronyms reach
  neither brand lookup: `loadCoopPack` takes a vehicle's make from the feed, and
  `makesMissingCoopPack` reads makes off inventory rows. It exists so Phase 4's
  pack seeding doesn't have to re-derive which brands a Stellantis or BRP
  guideline covers.
- ⛔ Packs for the 12 powersports brands the mock covers (counting the BRP
  split), then the 7 it does not.

## 10. What we need from the Oz Co-op team

Ordered by how much they block.

1. **The missing template bodies — 17 brands, up to 51 bodies.** The mock ships
   real language for Audi and Volkswagen only; the other 17 brands are
   placeholders, at three offer types each. Nothing in Phase 1 is useful for
   those brands without them. Two questions reduce the number materially:
   - Does one Stellantis body serve Chrysler, Dodge, Jeep and Ram, or do they
     differ per make?
   - Do the powersports and ag brands advertise leases at all? If they only run
     finance and cash, the count drops by a third.
2. **Confirmation of down-payment caps.** Which OEMs actually impose one, on
   which quantity (customer down vs. amount due at signing), and at what
   threshold. Current evidence supports exactly two: VW and Kia.
3. **MAAP formulas per OEM**, with the section reference — the mock's prose
   summaries are a starting point, not a citation.
4. **Whether the guideline PDFs already registered in Loomi are the current
   editions** for these brands, and which brands have no document on file.

Every one of these lands in an existing model with a `citation` field. If the
Co-op team can point at the section, we can transcribe it; if they cannot, we
leave the rule out rather than approximating it — the standing rule in
[coop-rules.ts:16](../src/lib/ad-generator/coop-rules.ts).

## 11. Explicitly rejected

Recorded so they are not rebuilt:

- **AI extraction of rules from guideline PDFs.** Rejected previously and again
  here. The register detects that a document *changed*; a human decides what it
  means.
- **A second rules format alongside `AdCoopRulePack`.**
- **A Monday.com API writer** (§7).
- **A standalone service.** This is a Loomi feature; it inherits Loomi's auth,
  account scoping, and the ad-generator feature flag.
