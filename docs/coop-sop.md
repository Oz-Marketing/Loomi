# Co-op guidelines — standard operating procedure

Who this is for: whoever owns manufacturer relationships and co-op reimbursement.
It assumes no development involvement, because none is needed — everything below
happens in **Settings → Co-op Guidelines**.

What it is for: making sure that when Loomi generates a Mazda ad, somebody can
say *why* it satisfies Mazda, and point at the page of the document that says so.

---

## 1. What the system does and does not decide

The tool checks ads against rules **a person wrote down**. It does not read the
manufacturer's PDF and work out the rules itself.

That is a deliberate choice, and it is worth understanding before you start,
because it explains why step 3 below is unavoidable manual work. We built
automatic rule extraction earlier in the project and removed it: it produced 41
confident, plausible-sounding rules that matched **nothing real**. A wrong rule is
worse than a missing one — a missing rule lets an ad through that a human would
have caught, while a wrong rule blocks a month of correct ads for a reason nobody
can trace, and the team learns to ignore the warnings.

So the division of labour is:

| The system | A person |
|---|---|
| Watches each document for reissues, by content hash | Reads the document |
| Applies the rules exactly as written, to every ad and every template | Decides which requirements are mechanically checkable |
| Cites the section and page on every block, so a claim can be audited | Writes each rule down, with its citation |
| Reports when an approval or a check has gone out of date | Confirms the transcription is right |

**A clean check is not a compliance sign-off.** It means every rule anyone has
written down for that make passed. If nobody has written any, everything passes.
The proof sheet says so in as many words, and it is the reason the second column
matters.

---

## 2. Register the document

**Settings → Co-op Guidelines → pick the make → Guideline documents → Add.**

Upload the manufacturer's PDF and give it the edition it is — the quarter, the
program year, whatever the document calls itself.

The system stores a content hash. When the manufacturer reissues, the hash moves
and the document is flagged as changed, once, with the change kept as history.
This is the part you get for free, and it is the part teams usually get wrong by
hand: nobody notices the Q3 edition landed until an ad is rejected.

There is deliberately **no "mark as reviewed" button**. An earlier version demanded
that and turned a reference library into a to-do list nobody cleared. A document is
simply what it is; the system tells you when it changes.

Do this for every make, even the ones you are not going to transcribe rules for
yet. The register is useful on its own — it is where anyone in the agency goes to
find out what Ford currently requires, and it is what tells you a reissue happened.

---

## 3. Write down the rules

**Same make → Automated checks → Add rule.**

Read the document and transcribe only what is **mechanically checkable**. Most of a
co-op document is not: submission deadlines, reimbursement percentages,
pre-approval workflow, who to email. Those matter to you and mean nothing to a
renderer.

What is checkable, and what the editor offers:

| Rule kind | What it checks | Example |
|---|---|---|
| Required element | Something bound to this field must be visible | The brand mark must appear |
| Minimum font size | A field's text, in pixels or as a share of the short edge | The disclaimer at no less than 1.4% of the short edge |
| Minimum element size | A field's box, as a share of the canvas | The logo at no less than 8% of the width |
| Element zone | A field's box must sit inside a region | The brand mark in the lower third |
| Required phrase | Text that must appear | "Subject to credit approval" |
| Banned phrase | Text that must not | "lowest price in the state" |
| Numeric limit | A figure against a computed ceiling | Discount no more than 20% of MSRP |

Every rule takes a **severity** — blocking or warning — and a **citation**. Fill
the citation in. It is the whole reason the register exists: months later, in a
reimbursement dispute, "the system blocked it" is not an answer and "§7a, page 15
of the August 2025 edition" is.

Three things the editor does on purpose:

- **Fields are picked, never typed.** A field key with a typo produces a rule that
  matches nothing and reports nothing — which looks exactly like compliance.
- **Saving retracts verification.** The sign-off says a person checked *these*
  rules; changing them makes that false.
- **It refuses a rule it could not actually check.** Better an honest gap than a
  rule that quietly never fires.

### How long this takes

Mazda took about a day of focused work and produced roughly 40 rules. **Budget half
a day to a day per make.** For 8–10 makes across the Young stores, that is on the
order of a week of one person's time — and it is the same shape of work each time,
so it gets faster.

Where AI genuinely helps is the *reading*: finding the candidate paragraphs in a
40-page PDF and drafting the rule shapes for a person to confirm or reject against
the page. That is assistance on the search, not on the judgment, and the judgment
is what has to be defensible.

**Do the makes in order of exposure**, not alphabetically. A make with three
rooftops running ads every month earns its day; a make with one store and no co-op
claim can wait.

---

## 4. Verify the pack

**Same make → Automated checks → Verify.**

Verification means a person has read the rules as written and agrees they say what
the document says.

Until then, the pack still runs — but every rule reports as a **warning instead of
blocking**. That is deliberate: an untranscribed or unverified pack should tell you
what it thinks without stopping the agency's work on the strength of a
transcription nobody has checked. It also means an unverified pack is safe to
build up incrementally.

Verification is retracted automatically whenever a rule changes.

---

## 5. Check the templates

**Same make → Automated checks** shows how every ad template stands against the
pack.

Geometry rules are properties of the design, so they are checked once per template
rather than per ad. A failure here is a **design** fault: it needs a designer, not
different data, and fixing it clears every future ad off that template.

The designer's own view of the same thing is the **proof sheet** — open a template
and choose *Proof sheet*. It draws every offer type on every ad size and lists
what fails, splitting what blocks an export from what is only worth looking at.
Design faults are listed once, with the offer types and boards they apply to, and
with the citation where a manufacturer's rule is the source.

Send designers there rather than describing the failures to them. It is faster and
it names the layer.

---

## 6. Record the manufacturer's approval

**Templates → the template's menu → Co-op approval.**

When a manufacturer's program approves a template, record it: which program, which
guideline edition, and the case number or email that granted it.

This is the sign-off that lets ads generated from that template launch **without a
per-ad reviewer**. The manufacturer approves a plate, not fifty ads, and an ad is
that plate with the month's numbers in it.

An approval goes out of date in exactly two ways, and the system watches both:

- **The design moved.** Someone edited the template after approval, so what the OEM
  saw is not what would ship.
- **The rules moved.** Guidelines were reissued; an approval granted against the
  2026-Q2 edition does not speak for Q3.

Neither makes the ad *wrong* — it makes the approval unable to vouch for it. Both
read as "needs re-confirming", never as silently still approved. When you see that,
re-confirm with the program and record it again.

---

## 7. Sales events

**Same make → Sales events.**

A campaign mark and the window it must appear in. Add these when the manufacturer
announces a campaign period, because the requirement is usually "the event logo
must appear, as its own element, and must not be altered" — a rule that is only
true for those dates.

---

## The routine, once it is set up

| When | What |
|---|---|
| A manufacturer reissues guidelines | The document is flagged. Re-read the changed sections, update the rules that moved, re-verify, and re-confirm any approval that cited the old edition. |
| A new make joins | Register the document. Transcribe rules when the make is worth a day. |
| A campaign period is announced | Add the sales event with its window. |
| A designer builds or edits a template | They read the proof sheet before publishing. Design faults come back to them, not to you. |
| Monthly | Scan the make roster for anything flagged and anything unverified. |

---

## Two things that are honestly not solved

**Most makes have no pack.** Mazda is transcribed; the rest are not. Every co-op
check for an unpacked make is a no-op, and the proof sheet says so on every sheet
rather than implying a pass.

**The house minimum covers the gap, partly.** Independent of any manufacturer,
every template is checked for the things no document has to tell us: a disclaimer
that exists, is on every board, and has room to be read; every offer type's
required figures having somewhere to appear; something identifying the dealer.
Those run for every make, pack or no pack. They are not a substitute for knowing
what Ford requires — they are the floor under it.
