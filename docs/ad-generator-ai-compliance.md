# AI-drafted co-op rules and disclaimers

Status: **proposal** — not built. Written 2026-08-25.

This reverses a decision that was locked three times. §3 says which part is
reversed, which part is not, and why the earlier reasoning doesn't cover the case
we actually have.

---

## 1. What this is

Two jobs are being done by hand that shouldn't be:

1. **Co-op rule packs.** Somebody reads a manufacturer's advertising guidelines
   and types each machine-checkable rule with its citation. Three brands have
   been done in a year.
2. **Disclaimer bodies.** Somebody writes the legal fine print for each
   (make × offer type). Two automotive rows exist.

The proposal: **AI drafts both from the guideline documents already registered in
Loomi, and a human approves each item before it can affect an ad.** Where a brand
has no document on file, the drafter produces nothing at all.

**Approved 2026-08-25** (Connor): the per-make disclaimer addenda in §6.6; a
service / fixed-ops document slot per manufacturer (§6.4, §8.1); and the review
process in Loomi rather than Monday (§9), standalone now and wired into Projects
later (§9.4).

---

## 2. Where things actually stand

**Built and working:**

| Piece | State |
|---|---|
| `AdGuidelineDoc` register | 33 documents, 24 makes, on staging and production. Content-hashed, re-fetched daily, change-notified. |
| **Per-page plain text** (`pageText`) | Extracted at registration, stored as `string[]`. 160–230 KB per document. |
| Section headings (`sections`) | `{page,title}[]`, from the PDF outline where it has one. |
| In-app reader | Renders pages as images, client-side search, and **maps a text match to its boxes on the page** (`guideline-search.ts::matchBoxes`). |
| Rule engine | 7 rule kinds, versioned/date-scoped packs, `verified` gates blocking. |
| Rule authoring in-app | `coop-pack-editor.tsx` + `coop-rule-authoring.ts::validateRule` — the Co-op team can type rules without a deploy. |
| Disclaimer token engine | ~40 slugs across the vehicle and custom kinds; deterministic substitution. |

**The gap:**

- 3 rule packs (Chevrolet 8 rules, Mazda 16, Subaru 22) against 24 makes with
  documents on file.
- 2 seeded automotive disclaimer bodies, both with substitution bugs
  ([custom-offer-disclaimer-builder.md §4.4](custom-offer-disclaimer-builder.md)).
- Service/fixed-ops disclaimers: the code defaults say "See dealer for complete
  details." and the real per-brand wording was left to arrive from the Co-op
  team. It hasn't.

> Production counts above come from the deploy notes and seed scripts — a live
> query was blocked by the sandbox, so treat the pack/template counts as
> "3 and 2 unless someone has added rows since."

**The decisive fact:** `pageText` means the corpus is already a searchable,
page-numbered text body sitting in the database. Everything below is reading
text we have already extracted. No PDF parsing, no OCR, no vector store.

---

## 3. What is being reversed, and what is not

AI extraction was rejected in `guideline-docs.ts`, again in
`coop-rule-authoring.ts`, and again in
[custom-offer-disclaimer-builder.md §11](custom-offer-disclaimer-builder.md). The
three stated reasons:

| Stated reason | Does it still hold? |
|---|---|
| "It solves the wrong-sized problem — documents are reissued once or twice a year. That's a couple of notifications, not a pipeline." | **No — it answered the wrong question.** That's an argument about *keeping rules current*. The actual problem is *cold start*: 21 of 24 makes have no rules at all, and 22 of 24 have no disclaimer body. That's a one-time backlog of ~30 documents, which is exactly the shape a model is good at and a human is slow at. |
| "Extraction cannot be trusted unreviewed." | **Holds completely** — and the proposal doesn't ask for it. Nothing reaches an ad without a human accepting it. §4 additionally makes the *citation* mechanically verifiable, so review is checking an interpretation against a quote rather than re-reading the document. |
| "A wrong rule silently costs a brand its entire month of ads." | **Holds completely**, and drives the gating in §5.3: a drafted rule does not evaluate at all — not even as a warning — until accepted. |

So: **AI-drafted-and-auto-applied stays rejected. AI-drafted-and-human-approved
is what we build.** The architecture was already designed for it — `verified`
gating blocking, packs versioned and cited, findings carrying a citation — those
columns exist precisely so a half-trusted pack is safe to have.

**One narrower reversal:** *per-rule verification* was on the rejected list. It
comes back. When a person types a rule they have already read the section, so a
second per-rule attestation was ceremony. When a machine drafts the rule, the
per-rule accept **is** the transcription step — and it is far cheaper than typing.

---

## 4. The shared mechanism: drafting with verifiable citations

Both halves use one pipeline. The important property is that **the citation is
checked by code, not trusted.**

```
one chosen AdGuidelineDoc
  → pageText joined with page markers, prompt-cached
  → Claude returns strict JSON: each item carries { page, quote, ...payload }
  → [1] QUOTE CHECK   quote must literally appear in pageText[page-1]
  → [2] SCHEMA CHECK  rule → validateRule(); disclaimer → token checks
  → review queue, each item shown beside its quote
  → human: Accept / Edit / Reject
  → only accepted items are ever evaluated or rendered
```

**[1] The quote check is the load-bearing part.** The model must return the
verbatim source span it relied on. Normalize whitespace and matching punctuation,
then require the quote to be a substring of that page's stored text — the same
primitive `guideline-search.ts::findHits` already uses. Not found on the stated
page → look ±2 pages and correct the page number; not found anywhere → **drop the
item before a human ever sees it.** A fabricated section reference cannot survive
this, which removes the single worst failure mode: a confident, plausible,
uncheckable rule.

**Review is fast because the reader already exists.** Each queued item links to
its page with the quote highlighted via `matchBoxes`. The reviewer reads one
highlighted sentence and one plain-language rule, and presses a button. That is
the whole ask, and it's what makes 30 documents tractable.

**"Stated but not expressible" is a first-class output.** The hand-written seeds
already record these as comments — Mazda §7b (price height vs. vehicle height,
needs cross-element comparison), §1a–1h (MAAP, needs Dealer Invoice). The drafter
should return them as *notes*, not rules. That turns today's buried comments into
a ranked list of what engine work would actually buy coverage.

**Model and cost.** `claude-opus-5`, adaptive thinking, `effort: 'high'`, strict
JSON output. Prompt-cache the document text with a 1h TTL — each document is read
by ~3 passes (rules, vehicle disclaimers, custom/service disclaimers), so the
cache pays for itself immediately. A document is 40–60k tokens; the entire
37-document backlog is on the order of **$40, once**. Add a dedicated model
constant rather than changing `ANTHROPIC_MODEL`, which the ad copywriter shares.

---

## 5. Part A — co-op rule packs

### 5.1 Where drafts live

Reuse `AdCoopRulePack`. No new table, no second rules format. A drafted pack is
an ordinary row with `verified: false`, and each rule in the JSON blob carries
four extra fields:

```ts
origin: 'ai' | 'human'
sourcePage: number
sourceQuote: string          // verified to appear on that page
reviewState: 'proposed' | 'accepted' | 'rejected'
```

`verified` stays exactly what it is: read from the DB row, never the blob, so
nobody can self-certify by editing JSON.

### 5.2 Review surface

Extend `coop-pack-editor.tsx` with a queue. Each row shows the rule in the
plain-language register `RULE_KIND_META` already provides ("Must not say", "Text
that may not be smaller than a set size") next to its highlighted quote, with
Accept / Edit / Reject / Not expressible. Editing a drafted rule flips `origin`
to `human` — an edited rule is the reviewer's rule.

### 5.3 Gating — stricter than the existing rule

**A `proposed` rule does not evaluate. Not as an error, not as a warning.**

This is deliberately stricter than the `verified` flag's downgrade-to-warning
behavior, because of the number in the notes: 41 blocking rules produced **zero**
hits on real compliant ads. A drafting pass that adds 300 unaccepted rules across
24 brands would bury the co-op step in warnings nobody can act on, and the
predictable result is that people stop reading it. Accepted rules behave exactly
as rules do today, including the `verified` downgrade.

Two consequences worth stating plainly:
- `makesMissingCoopPack()` must count **accepted rules**, not rows. A pack full of
  proposals is not coverage, and unattended generation must not treat it as such.
- A drafting run changes nothing about live ads until someone reviews it. That is
  the point: the run is safe to fire at all 24 makes on day one.

### 5.4 Group documents

One CDJR document governs Chrysler, Dodge, Jeep and Ram; one BRP document governs
Can-Am, Ski-Doo and Sea-Doo. `expandBrandGroup` was built for exactly this and
**has no runtime caller yet**. Drafting is where it gets one: one document pass
fans out to one pack per make, each citing the same source. Four packs, one
review — the biggest single coverage win available.

---

## 6. Part B — disclaimers

### 6.1 What stays untouched

**OEM-verbatim precedence is not negotiable.** When MarketCheck sends the
manufacturer's own fine print, it is used verbatim and outranks everything
(`disclaimer-resolve.ts`). AI never touches that path. This proposal is entirely
about the *fallback* — the custom, service, and no-incentive cases, which is
exactly the boundary drawn in the request.

**Per-ad composition stays deterministic.** No model runs at ad time. This is the
key move: **AI drafts the reusable template body once; token substitution renders
every ad.**

That satisfies both the request and the "AI never writes legal text" invariant in
substance rather than by letter — no machine-written sentence reaches a live ad
without a human having read it, and the same reviewed sentence then renders
identically a thousand times. Calling a model per ad would give up idempotency,
auditability, and the `source: 'db_template'` trail, and buy nothing.

### 6.2 The drafting pass

Scoped to one **document × offer kind**. One pass covers every offer type in the
kind, so the vehicle pass returns lease / apr / discount / sales_price bodies
together, and the custom pass returns flat_price / percent_off / dollar_off /
other_offer. Output per offer type:

- a **body** using `{{token}}` slugs,
- a **clause coverage table** — each required disclosure found in the document,
  the sentence in the body that satisfies it, and the page + quote it came from,
- **gaps**: disclosures the document requires that no available slug can express.

The coverage table is what makes review possible. The reviewer checks a list of
"the document requires X → this sentence says X → here is the quote", instead of
reading a paragraph of legal prose and trying to recall what should be in it.

### 6.3 Three mechanical checks before a human sees it

1. **Tokens must exist for the kind.** Validate against
   `offerKind(offerType).slugs`. An invented `{{trade_in_bonus}}` is rejected, not
   reviewed — a slug with no case in `buildTokenValues` renders as literal
   `{{trade_in_bonus}}` in a legal line.
2. **Tokens must be guaranteed.** Every token must be a *required* field for that
   offer type, or it gets flagged. This is a live bug class, not a hypothetical:
   the code default for `lease` already references `due_at_signing`, which is not
   baseline-required, and `disclaimer.ts` documents the risk.
3. **The brand's own accepted rules must pass on the draft.** Run the make's
   accepted `banned_phrase` / `required_phrase` rules against the drafted body.
   A pleasing closure: Part A polices Part B automatically.

### 6.4 Service and fixed-ops

The request singles this out, and it's the case with the least existing support —
the code defaults deliberately say nothing brand-specific.

Reading the actual source library: **there is no dedicated service co-op document
in it.** Fixed-ops advertising is covered by sections inside the general programs
(GM's iMR guidelines, Honda's DMA overview, and so on). So the custom-kind pass
must search for the fixed-ops/parts/service sections within the general document,
and **where it finds none, produce nothing for that brand** — which is the rule in
§7, arrived at from the other direction.

Expect uneven coverage here, and expect it to be honest about which brands are
uncovered rather than filling gaps with plausible service language. That gap list
is itself the useful output: it tells the Co-op team exactly which brands need a
document requested from the manufacturer.

### 6.5 Storage and activation

Drafts are `AdDisclaimerTemplate` rows written `isActive: false, isDefault: false`.
An inactive row is invisible to `resolveDisclaimerText`, so a drafted body cannot
reach an ad by any path until a human activates it. Add `origin`, `sourceDocId`
and the coverage table (as JSON) so an approved body can be audited back to its
source years later.

Also fold in the two known substitution bugs in the seeded VW row while we are
here — `selling_price` and `monthly_payments_total` now have slugs.

### 6.6 Required appends to an OEM-verbatim disclaimer

Some manufacturers require a clause that MarketCheck's fine print doesn't carry —
Subaru requiring a VIN is the known case. So "verbatim" is right but not
sufficient: the body is authoritative, and the brand may still require something
added to it.

**Part of this already works, by accident rather than by rule.**
`composeDisclaimer` already appends `VIN: <vin>` and `Stock#: <n>` to a verbatim
OEM body when the value is present and the body doesn't already contain it —
tested on the substituted *value*, so a body that writes the VIN mid-sentence
doesn't get a second copy. Three gaps:

1. It is **global and unconditional**. It fires because the VIN field happens to
   be populated, not because Subaru requires it. A Subaru ad with an empty VIN
   field renders with no VIN and nothing objects.
2. It covers **VIN and stock number only**. There is nowhere to put any other
   required clause.
3. Nothing **requires** it. (The existing lever for that is
   `AdOemOfferRule.requiredFields` — listing `vin` under Subaru's offer types makes
   preflight block an ad with no VIN. That should be set regardless of this work.)

**Proposal: per-make disclaimer addenda.** Generalize the two hardcoded appends
into an ordered, data-driven list per make: each addendum a short clause with its
own citation, token-substituted like any body, appended only when the disclaimer
doesn't already say it. The existing VIN/stock behavior becomes the first two
entries rather than a special case.

Three properties are non-negotiable, because this is the one place we modify
manufacturer legal text:

- **Append-only.** Never edit, reorder, or remove anything in the OEM body.
- **Idempotent.** Skip when the clause is already present — the same
  match-on-value test the VIN append already uses. Appending a duplicate
  requirement reads as a mistake in a legal line.
- **Cited.** Each addendum records the document, page and quote that demands it,
  so a dealer or a co-op auditor can be shown why we added to the manufacturer's
  own text.

Addenda must also be **hand-authorable from day one**, not only AI-proposed
(Connor, 2026-08-25): the known list is incomplete, so the Co-op team needs a
place to enter one the moment they learn of it, without waiting for a drafting
pass to notice it. So the editor comes with the mechanism, and AI proposals arrive
into the same table.

Beyond that it is a natural output of the drafting pass: "which clauses does this
brand require that an offer's own fine print may not carry" is the same question,
asked of the same document, and it lands in a review queue like everything else. And
the two halves check each other — an addendum supplies the clause, and a
`required_phrase` rule proves it ended up on the ad.

---

## 7. No source, no output

Stated as a hard precondition because it was asked for explicitly, and because it
matches a principle the engine already follows ("a missing pack reports as
`skipped`, never `ok`").

- **The unit of drafting is a document, never a make.** You cannot run a pass for
  "Honda"; you run it against a named document. No document selected → no run.
- A make with no `AdGuidelineDoc` shows the action disabled with the reason:
  *"No guidelines on file for Honda — upload the co-op document first."*
- A document with no `pageText` (see §8.2) is equally unusable and says so.
- Within a run, a rule or clause with no verifiable quote is dropped (§4).
- If a document contains no fixed-ops section, the custom-kind pass returns
  nothing for that brand — not a generic body.

The failure mode this exists to prevent is the one the codebase already warns
about in three headers: inventing a plausible threshold or a plausible legal
sentence manufactures false confidence, and nobody goes looking for it afterwards.

---

## 8. Traps found while investigating

Each of these will bite whoever builds this if it isn't handled up front.

### 8.1 Which document governs — mostly resolved by inspection

Several brands have two documents on file. Extracting the text and comparing them
settled most of it; the point stands regardless of the answers, which is why the
unit of drafting must be a **document**, never a make.

**Superseded editions — the newer one governs, no judgement needed:**

| Brand | Older | Current |
|---|---|---|
| Hyundai | `2026 Hyundai Guidelines.pdf` — **Q1**, 32 pp | `...2026 Q2 Hyundai Dealer Advertising Co-op...v1.pdf` — **Q2**, 32 pp |
| CDJR | `2026 CDJR Dealer Accelerate Co-Op Program.pdf` — accrual dates Nov 30 / Dec 1 2025 | `CDJR 2026 Guidelines.pdf` — Dec 31 / Jan 1 2026 |
| Kawasaki | `.docx`, 17,688 words | `.pdf`, 17,724 words — **the same document**, two formats |

**Complementary, not competing — both are useful, for different rule kinds:**

| Brand | Co-op program rules | Brand identity |
|---|---|---|
| Kia | `KIA 2025 Guidelines.pdf` — *Advertising Standards & DAS-FORMF Support Guidelines*, rev #10, Jun 2025 | `KiaDealerAdvertisingGuidelines Ver 2.0`, Apr 2025 — brand expression |
| Audi | `Audi Tier 3 Guidelines 2026.pdf` — *Tier 3 Marketing Program Fund Reimbursement*, eff. Apr 2026 | `Audi Marketing Compliance Program`, rev Nov 2024 — philosophy and non-compliance consequences |
| Genesis | **none on file** | `Genesis 2.docx` = *Tier 3 Retail Brand Guidelines* R6 Jun 2024; `Genesis Brand Guidelines_April2026.pdf` |

That second table is the more interesting finding, and it changes the design.
A brand-identity document is not a worse co-op document — it is **the** source for
logo, clear-space and typography requirements, which is exactly where the
`design`-scoped rule kinds (`required_element`, `element_zone`, `min_font_size`)
come from. A reimbursement document is where prohibited language and pricing
rules live. They feed different halves of the same pack.

**So `AdGuidelineDoc` needs a document TYPE, not a supersession flag:**

```
coop_program    reimbursement + advertising rules → content-scope rules, disclaimers
brand_identity  logo, clear space, typography     → design-scope rules
service_program fixed-ops / parts co-op           → service disclaimers (§6.4)
reference       claim-status definitions, etc.    → never drafted from
```

One field earns four things: the drafter picks the right document for the rule
kind and offer kind it's drafting, §6.4's service upload has a home, the
non-guideline files in the library (§8.3) become explicitly undraftable, and
Genesis correctly yields design rules only. `@@unique([make, title])` already
permits several documents per make, so this is additive.

### 8.2 Not every registered document has usable text

Two `.docx` files went through a pipeline built for PDFs — the deploy notes record "covers 32" of 33 because the
Genesis file isn't a PDF. No `pageText` means no quote verification and therefore
no drafting. The Kawasaki one is redundant (§8.1) and can simply be dropped; the Genesis one
is the only copy of its content and needs converting. `textutil -convert txt`
handles .docx on macOS, so a converter is cheap — but do not let a text-less
document fail silently into an empty run.

### 8.3 The library contains things that are not guidelines

`Young_Credit_Education_Portal_Proposal.md.pdf` (an internal proposal) and
`11185944_HMAClaimStatusDefinitions...pdf` (a claim-status reference) sit in the
same folder as the real programs. Another reason the drafter takes a document, not
a make.

### 8.4 A stale source produces stale rules, confidently

`TDMCJune2022Covenant-Final.pdf` is four years old. The citation makes the age
visible, but only if someone looks — the reviewer must see the document's date
next to the proposal. Worth surfacing "this document is N years old" in the queue.

### 8.5 Inherited limitation: declared vs. rendered font size

`min_font_size` checks the *declared* `fontSize`, but shrink-mode text can
auto-shrink smaller at render time. AI-drafted font rules inherit this exactly.
Unchanged by this work — noted so nobody reads an accepted font rule as a
guarantee about rendered output.

---

## 9. The review queue — replacing the Monday board

Today an ad or template that needs co-op sign-off becomes a ticket on a Monday
board, where the Co-op team reviews it, submits it to the manufacturer, and
records the approval or rejection. Monday is going away, and
[custom-offer-disclaimer-builder.md §7](custom-offer-disclaimer-builder.md) locked
"nothing writes to Monday, in any form" — so this needs a Loomi home. It should be
an in-app process, and most of the model for it already exists.

### 9.1 One inbox, three item types

The important observation: this work has now produced **three** things that need a
human decision, and they are the same shape — an item, its source evidence, and
Accept / Reject / Send back.

| Item | Reviewer decides | Evidence shown |
|---|---|---|
| A drafted co-op rule (§5) | Is this what the guideline says? | The verified quote, highlighted on its page |
| A drafted disclaimer body (§6) | Is this complete and correct? | The clause coverage table, each row cited |
| A template submitted for co-op pre-approval | Will the manufacturer accept this design? | The rendered template + its automated findings |

Build one queue with three item types, not three queues. The reviewer is the same
small group, the actions are the same, the audit trail is the same, and a single
inbox is the difference between a process someone works through and three places
they forget to look.

### 9.2 The states, and the one step Loomi cannot do

Approval of a *template* is already decided architecture, and the decision matters
here: **there is no per-ad approver.** Co-op pre-approves the template and every
ad generated from it inherits that approval
([ad-generator-campaign-launch.md](ad-generator-campaign-launch.md); per-ad
`preflight()` still gates the data). So the queue's unit is a template, not an ad
— which is what makes the volume manageable and is why this replaces the Monday
board rather than becoming a busier version of it.

```
requested  →  in_review  →  submitted_to_oem  →  approved
                    ↘ changes_requested          ↘ rejected
```

`submitted_to_oem` is the honest part. Loomi cannot submit to a manufacturer's
co-op portal, so that transition is a human recording that they did it, and the
approval that comes back is captured as evidence — which is exactly what
`AdTemplateCoopApproval.reference` already stores ("the co-op portal case number,
or the email that granted it"). Don't model it as an integration.

### 9.3 What already exists

Most of the pieces are there, which is the argument for doing it in Loomi:

- **`AdTemplateCoopApproval`** — per (template, make), pinned to a `docHash` so a
  design change invalidates the approval, and to a `packVersion` so a guideline
  reissue makes it *stale* rather than wrong. Has `reference`, `note`,
  `approvedByName`, `revokedAt`.
- **`AdTemplateCoopCheck`** — the automated verdict per template × make. The
  reviewer opens an item with the machine's findings already attached, so they are
  adjudicating a short list rather than inspecting a design from scratch.
- **The notification service** — with per-channel in-app/email preferences via
  `resolveChannels`. Notify the Co-op team on submit and the requester on decision.
- **The guideline reader** — for citation evidence (§4).

Missing: the queue itself (status + assignment + a decision note), the states in
§9.2, and a `changes_requested` path back to the requester. That is the real build,
and it is a workflow feature rather than a compliance one — so it is the largest
of the four items here and should not be bundled with the drafting work.

### 9.4 Standalone now, Projects later — and the seam already exists

The Co-op team keeps using Monday for everything that isn't a Loomi ad, and moves
to Projects when Projects reaches their department. So this ships standalone. The
question that matters is whether "standalone now" costs a migration later, and the
answer is no — **provided one distinction is held from the start.**

**Two different objects are easy to conflate here:**

| | The approval record | The work item |
|---|---|---|
| What it is | Compliance evidence: this design, approved by this person, against this guideline edition | "Somebody needs to look at this" |
| Lives in | `AdTemplateCoopApproval` — pinned to `docHash` and `packVersion` | `Task` |
| Lifetime | Permanent. Auditable years later | Transient. Gets done, then archived |
| Owned by | The Ad Generator | Projects |

**Build the approval record as the source of truth and the queue as a thin view
over it.** Then Projects doesn't replace anything — it adds a second, richer view.

`Task` is already built for this: `linkedAssetType` / `linkedAssetId` is a
polymorphic soft link to a domain record (`campaign | landing_page | flow |
meta_pacer_plan | media_asset` today). Adding `coop_review` is a new value, not a
new mechanism. When Projects reaches Co-op, a task points at the approval record
and brings routing, assignment, due dates, `TaskComment` threads and
`TaskActivity` history with it — and teams are DB-managed, so a "Co-op" team is a
row, not a deploy.

**The rule that makes this work: never put the approval decision inside a Task.**
A task is archived when the work is done; an approval must be explicable years
later, and it must invalidate itself when the design or the guideline edition
changes — which is why it is pinned to a hash and a pack version. If the decision
lives in the task, archiving destroys compliance evidence and Projects becomes
load-bearing for a co-op audit. **The record is the truth; the task is the nudge.**

Practical consequence for Phase 5: build the states in §9.2 on the compliance
tables, and treat the queue UI as disposable. It is the part Projects will
eventually replace, and it should be cheap enough that replacing it is welcome.

### 9.5 The interim risk worth naming

For a while the Co-op team works in two tools — Loomi for ad review, Monday for
everything else. The predictable failure isn't confusion, it's **omission**: their
habit and home base is Monday, so a Loomi queue is a place they have to remember
to visit, and items age quietly in it.

So the queue must **come to them, not wait for them.** Email notification on
assignment plus a periodic digest of what's outstanding, using the existing
per-channel notification preferences. Email is the bridge that needs no
integration: it lands in the inbox they already watch, and the locked "nothing
writes to Monday" decision stays intact.

This is the same lesson as the "Mark reviewed" button that was removed from the
guideline register — a surface that turns into a to-do list nobody asked to visit
gets ignored. The difference is that these items genuinely need a decision, so the
answer is to push them rather than to drop them.

### 9.6 One caution

Everything above is worth building **because template pre-approval is low-volume
and long-lived**. If it ever grows a per-ad path, the queue becomes a job nobody
can keep up with and people will start rubber-stamping — which is worse than
Monday, because it would carry Loomi's authority. The no-per-ad-approver decision
is what keeps this humane; hold it.

---

## 10. Phasing

Each phase is independently shippable and none of them can affect a live ad until
its review step is used.

**Phase 1 — the grounded drafting core.** `pageText` → prompt → strict JSON →
quote verification → schema validation. Pure and testable with no UI: a script
that takes a document id and prints verified proposals. This is where the risk
lives, so it ships first and alone.

**Phase 1 — ✅ DONE 2026-08-25, and validated.** `guideline-quotes.ts` (quote
verification), `coop-draft.ts` (the acceptance pipeline), `coop-rule-draft.ts` (the
model call), and `scripts/draft-coop-rules.ts`. 53 unit tests, `tsc` clean, nothing
writes to the database. **The Mazda recovery test passed: 16 of 16 hand-written
rules, 0 drops, nothing invented** — §12.

**Phase 2 — co-op rules end to end.** The four per-rule fields, the review queue
in `coop-pack-editor.tsx`, `proposed` excluded from evaluation, and
`makesMissingCoopPack()` counting accepted rules. Then run it against the three
brands that already have hand-transcribed packs — **the existing packs are the
test set.** If a pass over the Mazda document doesn't recover most of the 16
hand-typed rules with matching citations, the prompt isn't ready and we find that
out against a known answer rather than in production.

**Phase 3 — disclaimers.** The drafting pass per document × offer kind, the three
mechanical checks, the coverage table, and activation in `ad-disclaimers-tab.tsx`.
Fix the seeded VW body's two bugs.

**Phase 4 — the backlog run.** 24 makes with documents, group documents fanned
out. Review is the Co-op team's work, and it can be done a brand at a time
without blocking anything.

**Phase 5 — the review queue (§9).** Independent of the drafting work and
sequenced by when Monday actually has to be off. Worth starting from the template
pre-approval type alone, since that's the flow being replaced; the two drafted
types fold into the same inbox once it exists.

**Phase 6 — reuse the mechanism for change.** Once a drafting pass exists, the
existing "this document changed" notification gains an obvious follow-on: draft
the *diff* as proposals against the current pack. Deliberately last — it's the
thing the original rejection was actually about, and it's only worth building once
the review loop has been shown to work on the backlog.

---

## 11. What we still need from you

The document questions in §8.1 were answered by inspection; §6.6, §6.4 and §9 are
approved. What's left:

1. ~~Kia and Audi~~ — **answered: both documents are in play** for each brand.
2. ~~Genesis~~ — **answered: a co-op document exists and needs uploading.**
3. **The documents themselves, uploaded.** Genesis's co-op program document, and a
   service / fixed-ops document per manufacturer. §6.4 produces nothing for service
   offers until those land.
4. ~~The list of required addenda~~ — **answered: unknown for now**, so §6.6 ships
   with a hand-authoring editor and the drafting pass proposes into it.
5. ~~Who reviews~~ — **answered: there is a team, and bulk-accept is in scope** (§5.2).
6. **When Monday has to be off for Co-op specifically** — this can ship well before
   the Apr 2027 Projects cutover, and §9.4 means shipping early costs nothing later.

## 12. What Phase 1 measured, and what it changed

### 12.1 Exact quote matching does not survive real documents

The first implementation required the quote to be a contiguous span of the stored
text. Running it against the real Mazda document killed that design in one pass.
Extracted text follows glyph positions, not reading order, so a pull-quote lands
*inside* a sentence — §5a comes out as:

```
...must be used once and should be(top placed prominently in the ad.
```

where `(top` and `priority)` belong to a callout beside the paragraph. The
sentence a person reads is not a contiguous span of the text we store, so exact
matching rejects a *true* quote — and a check that rejects true quotes teaches
whoever runs it to stop believing it.

Matching is now a **bounded subsequence**: every word of the quote must appear on
the page, in order, inside a window no more than 1.6× the quote's own word count.
That tolerates interleaving and line-break hyphenation while still being something
a fabricated sentence cannot satisfy. The stretch factor is reported, so a loose
match is visible to the reviewer instead of silent.

Two further floors guard it: at least 6 words and 24 characters. A short run of
common words can align with ordinary prose by chance.

### 12.2 Measured on four real documents

Sampling body sentences from the extracted text of Mazda (51 pp), Subaru (62 pp),
Kia (47 pp) and GM (27 pp) and feeding each back as if it were a drafter's quote:

| | Result |
|---|---|
| **True positives** | 565 of 592 sampled sentences verified (93–100% per document) |
| **Every miss** | a repeated footer or legal boilerplate, correctly refused as `not_evidence` — the sampler picked them up, the verifier was right to reject them |
| **False positives** | **0 of 83** fabricated quotes (halves of two different real sentences spliced together) |
| **Page corrections** | 0 — page attribution from the markers is reliable |

So on genuine body text the verifier finds effectively everything, and it did not
accept a single fabrication.

**What this does NOT show:** whether the *model's* quotes verify. Every sentence
above was sampled from the extracted text, so all 565 matched exactly and the
tolerant path was never exercised by the measurement — it is proven only by a unit
test built from the real §5a interleaving. Confirming the loose path end to end
needs a live drafting run.

### 12.3 The field-existence check earns its keep

`knownAdDataKeys()` is derived from the schema at runtime — the offer kinds' field
schemas, the branding values a design check supplies, and the synthetic `_offer*`
values the offer engine computes: 77 keys. Cross-checked against all three
hand-transcribed packs, every field they reference is known and nothing is falsely
flagged, so the check can be trusted to mean what it says.

It catches what `validateRule` structurally cannot: `AdData` is
`Record<string, string>`, so a rule against `brandLogo` (the real key is `logoUrl`)
is perfectly well-formed and silently inert. A drafter typing keys out of prose
will make that mistake, and it is invisible on inspection.

### 12.4 The live Mazda run — the recovery test passed

Run 2026-08-25 against `MCAP_Interactive_Guidelines_Aug_2025.pdf` (51 pp, 12,135
words). 152 seconds, ~$0.50, `claude-opus-5` at effort high.

| | |
|---|---|
| Proposed | 58 rules + 46 unexpressible notes |
| **Accepted** | **58 rules, 0 dropped** · 45 notes kept, 1 dropped |
| **Recovery of the hand-written pack** | **16 of 16** |
| Invented sizes, zones or numeric limits | **none** |
| Duplicate ids | none |

**Recovery.** All 16 hand-transcribed Mazda rules came back. One differs in
binding — the "must include a valid offer" rule bound `_offerMain` where the human
chose `_offerValue`. Both are real keys and `_offerMain` is arguably the better
choice, so that is a reviewer's judgement rather than a miss. It also produced 42
rules the human transcription does not have, mostly per-term entries from the
prohibited-language list, which the hand pack had compressed into groups.

**It declined to invent.** Zero `min_font_size`, `element_zone` or
`min_element_size` rules — the document states no numeric sizes, and the drafter
said so instead of supplying a plausible one. That was the single largest risk in
the whole design.

**The notes are the surprise.** They independently reproduce the limitations the
hand-written seed records as source comments, with the same reasoning. §7b came
back as *"compares the height of two elements to each other; min_element_size only
compares to the ad dimensions"* — which is verbatim the gap the seed's author noted
by hand. Others found: strikethrough pricing (typographic styling, unexpressible),
non-palette highlight colors (element-level color inspection), itemized price
build-ups (arithmetic across fields), and MAAP itself (correctly routed to a note
rather than guessed).

**The tolerant matcher earned its place.** Of 58 accepted rules, 20 matched
exactly, **10 matched loosely** (interleaved text — these would all have been
discarded by the original exact matcher), and 28 were list entries. §12.2's caveat
is now closed: the loose path is exercised by real model output, not only by a
unit test.

### 12.5 All three answer keys, and what the extra two changed

Mazda alone proved the approach; Chevrolet and Subaru were run because two more
documents of different shapes are the cheapest way to know it generalises. They
paid for themselves by exposing two defects Mazda never triggered.

| Make | Document | Proposed | Accepted | Dropped | Hand-written recovered | Notes |
|---|---|---|---|---|---|---|
| Mazda | MCAP, 51 pp | 58 | **58** | 0 | **16 / 16** | 45 |
| Chevrolet | GM iMR, 42 pp | 25 | **25** | 0 | **8 / 8** | 21 |
| Subaru | SAF 2026, 62 pp | 76 | **75** | 1 | **22 / 22** | 57 |

**46 of 46 hand-transcribed rules recovered across all three brands**, alongside
158 drafted rules and 123 unexpressible notes. Two rules came back bound to
`_offerMain` where the human chose `_offerValue` / `_offerTerms` — real keys either
way, a reviewer's adjustment rather than a miss. Subaru's single drop was
`quote_not_found`, the load-bearing check refusing an unlocatable quote.

Both defects the extra runs found were OURS, and both discarded correct rules:

**Evidence matching was substring, and is now word-subset.** GM's prohibited list
carries combined entries — `» "The GM store/outlet"`, one bullet covering two
forbidden descriptions. A rule about "GM outlet" is properly supported by it, but
"gm outlet" is not a contiguous run of "the gm store outlet", so the
`evidence_mismatch` check dropped a correct rule. Requiring every *word* of the
phrase to appear still refuses what the check exists for: a rule about "Employee
Pricing" quoting "Clearance" shares no words at all.

**The context pairing was framed as list-only.** The mechanism always accepted any
short quote backed by a context quote, but the prompt only asked for one on list
entries. So *"Dealer name must appear."* — a real GM requirement stated in five
words — was read correctly and then discarded by the six-word floor with nothing to
save it. A floor that silently drops true rules is the same failure as a matcher
that rejects true quotes (§12.1), one level up. The instruction now covers any
short quote, with the list entry and the short standalone sentence as its two
cases, and says explicitly not to pad a quote with words the document lacks.

**What this says about cost.** The three passes averaged ~$0.65, not the ~$0.45
Mazda suggested — Subaru's 62 pages cost about $1. So the full backlog of roughly
30 documents is nearer **$18–20** than $15, which is more than a $20 balance
comfortably covers once validation spend is deducted. Budget for it deliberately
rather than discovering it two-thirds through.

### 12.6 Three defects the first live run exposed

Each was a flaw in our code, not in the model's reading.

**1. The evidence floor discarded every prohibited-term rule.** First run: 45
proposed, 18 accepted, and *all 27 drops* were `quote_too_short`. Mazda lists
banned wording in bulk — "Clearance", "Blowout", "E-Plan" — and for a
`banned_phrase` rule the term IS the evidence; there is no longer sentence to
quote. A 6-word floor threw away the highest-value rules in the document.

Fixed with **two-part evidence**: a short entry is admissible only alongside a
full-length `context` quote establishing what the list is, and **both must verify
on the same page**. A fabricated term cannot satisfy that, and neither can a real
term paired with an invented heading. Paired with it is an `evidence_mismatch`
check — a rule banning one term while quoting another is refused, which is the
specific hazard of working down a forty-term list.

**2. The reply was silently truncated.** At `max_tokens: 24000` the second run
died on `Unterminated string in JSON at position 14825`. Adaptive thinking is
billed against the same ceiling, so a longer rule list simply ran out. Raised to
64,000, and `stop_reason` is now checked **before** parsing — a truncated or
refused reply says so plainly instead of surfacing as a JSON error 14,000
characters in.

**3. `"Schema is too complex."` is intermittent.** A 400 on a payload that had
just been accepted, then accepted again on retry, then refused. It tracks API load
rather than the request. Two responses: the output schema lost its heaviest node
(§5.5), and `withSchemaRetry` retries this one error specifically — the SDK does
not retry 4xx, correctly, and this is the exception. A minutes-long pass over a
50-page document should not be thrown away by a transient refusal.

### 12.7 `numeric_limit` is not drafted

Dropped from the drafting schema, for two reasons pointing the same way. **Policy:**
pricing floors and caps are transcribed by the Co-op team from a confirmed formula
(§10 of the disclaimer doc) — the formulas differ per manufacturer and a guessed one
blocks real ads for a reason nobody can defend. **Practical:** `limits` was the
heaviest node in the schema, which the API intermittently refused.

Nothing is lost. A stated pricing rule still comes back as a note carrying the
formula and its quote — which is exactly what someone needs in order to type it.

---

## 13. Boundary with the Co-op specialist agent

Parallel work on `claude/loomi-specialist-agents-97efa8` builds a conversational
**Co-op specialist**. Both read the same tables, so the line matters. Their doc's
"Two grades of AI" section draws it correctly and this section only makes it
operational.

**Different grades, deliberately.** This document's engine is GATING: its output
blocks ads, so it is cite-or-fail. The specialist is ADVISORY: one person asks, gets
an answer with its provenance labelled, and weighs it. It must NOT inherit the
floors in §12 — gate-grade conservatism in a chat window answers "that isn't in the
guidelines" to everything, which is useless.

**Ownership.**

| Theirs | Ours |
|---|---|
| `agent-runtime.ts`, the tool catalog, `AgentProfile`, the roster UI | `AdCoopRulePack` schema, `guideline-quotes.ts`, the drafting pipeline, the review queue |

They consume two things from here rather than rebuilding them:

1. **`loadAcceptedCoopPack(make)`** — returns accepted rules only, `verified` read
   from the DB row, plus `proposedCount`. **A specialist must never read the raw
   `rules` blob.** Their principle is "advisory output must never silently become
   gating input"; the mirror is equally important — **unreviewed gating drafts must
   never become advisory truth.** A specialist stating "Chevrolet requires X" from
   an unaccepted AI proposal launders a draft into an authoritative answer. An
   accessor makes that impossible rather than a rule someone must remember.
2. **The quote matcher** for their `search_guidelines` tool. The existing
   `guideline-search.ts::findHits` is plain substring matching and will silently miss
   real passages for the interleaving reason in §12.1.

**Two things that must not be merged by a well-meaning UI.** Their *curated notes*
(rep guidance, verbal exceptions, "this program ended in March regardless of what
the doc says") are advisory prose. Our *disclaimer addenda* (§6.6) are cited clauses
appended to published ad copy. The same team writes both and both live in co-op
settings; a combined "co-op notes" box would put unreviewed prose into legal text.

**Also corrected for them:** attaching each make's PDFs as `document` blocks with
native API citations is not the same mechanism as §4's verification, and cannot work
for Kia — that document is 35.4 MB raw, ~48 MB base64, against a 32 MB request cap.
API citations are also incompatible with `output_config.format`. Reading the stored
`pageText` avoids all of it.

**Shared file:** `src/lib/anthropic.ts`. Their pin pass has landed on their branch
(`ANTHROPIC_MODEL` and `ANTHROPIC_FLOW_MODEL` both `claude-opus-5`, plus a
`lastTextBlock()` helper); our addition is the single `ANTHROPIC_COMPLIANCE_MODEL`
constant. Rebase onto theirs.

**Built for them, 2026-08-25:** `loadAcceptedCoopPack(make, at?)` in
`coop-pack-store.ts` — `packId` (so it is a drop-in for the `AdTemplateCoopCheck`
caller and there is one loader rather than two that drift), accepted rules only,
`verified` from the row, `version`, a derived `sourceDocId`, and `proposedCount`.
Plus `splitByReviewState(pack)`, pure and tested, for any caller holding a pack it
didn't load through the accessor. Per-rule provenance went on `CoopRuleBase` rather
than the return value, because a pack drafted from two documents — Kia and Audi each
have two in play — has rules from both, and a pack-level id would send half of them
to the wrong reader.

**`AdCoopRulePack` has no `sourceDocId` column.** It stores `sourceAssetId` (a
MediaAsset) and `sourceUrl`, neither of which is an `AdGuidelineDoc` id. The
accessor's `sourceDocId` is therefore derived — the single distinct doc id across the
accepted rules, else null (null for all three hand-transcribed packs). A real column
belongs in the same change that first writes a drafted pack, not in a migration
bolted on ahead of it.

**Search, for their `search_guidelines` tool:** `searchPages(pages, query, {limit, pad})`
returning page, offsets into the ORIGINAL page text, `matchType`/`stretch`, and a
snippet with the match located inside it. Deliberately NOT the internal
`findMatches`, which returns at most one hit per page — right for verification, and
silently wrong for search, where a term appearing three times on a page would report
once. **Search shares the matcher but none of the evidence floors**: a person typing
"brandmark" makes no claim, so the six-word minimum has no business there. Loose
matching is gated at three words and used only as a per-page fallback, which also
keeps `$1,000` and `APR (24 mo.)` matching literally on the exact path.

**A bug they found that applies here too:** they had computed pending rules as
`total − accepted`, which folds *rejected* rules into "awaiting review" — overstating
the queue and implying a declined rule might return. A rejected rule has been
reviewed. `proposedCount` and `rejectedCount` were already separate, but nothing
stopped a caller subtracting, so the field now carries a warning and a test asserts
the wrong derivation against the right count.

**Corrected by them, and worth recording because it cut code here.** §12.5 first
claimed `output_config` was available only on `client.beta.messages` in SDK 0.78.
That was wrong — `output_config`, including `format`, is on the non-beta
`MessageCreateParamsBase`. The error came from generalising a `grep … | head -5`
whose output was truncated to beta paths. Chasing the correction surfaced
`client.messages.stream()` with `.finalMessage()`, which replaced a hand-rolled
event loop that only existed because of the mistaken belief; the drafter no longer
touches the beta namespace at all.

## 14. Explicitly still rejected

- **Auto-applying a drafted rule or body.** Every path requires a human accept.
- **A model in the per-ad path.** Composition stays token substitution (§6.1).
- **Touching OEM-verbatim disclaimers.** MarketCheck's fine print wins outright.
- **A second rules format.** Drafts are `AdCoopRulePack` rows.
- **Inventing a threshold or a clause with no source.** Unchanged, and now
  enforced mechanically by the quote check rather than by discipline.
