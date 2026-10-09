# Email drafting from approved creative

Status: **in build** — slice 1. Written 2026-10-09.

Loomi reads a deliverable's approved design assets and its request on monday,
extracts what the creative says, drafts the email around it, enforces the house
compliance rules in code, renders it, and attaches the draft to the monday
subitem for a person to proof. **Nothing is sent or published automatically.**

---

## 1. Scope

**Slice 1 — building now:** monthly model / APR offer emails, any brand, started
by a person — on monday, by setting Assets Approved to "Approved". **There is no
drafting screen in Loomi** (decided 2026-10-09): the output is a Loomi email
template, and the subitem carries a link to it.

Chosen over Subaru service specials (the first pick) because the corpus exists
today: ~30 monthly-offer finals already sent from Loomi plus ~35 urgent-subject
follow-ups, with no external dependency. It also exercises the fact check hardest,
because these emails are all numbers — APR, term, payment, expiry — which is
exactly where the Young Mazda of Missoula blast failed (§7.3).

**Next:** service specials and Subaru, once the historical GoHighLevel finals
are exported (§9). Then texts. Landing pages last — Dealer.com builds carry their
own constraints (always strip DDC's default wrapper padding and use the page's
own spacing).

**Loomi is the only sending platform.** GoHighLevel is being retired (decided
2026-10-09). Drafts target Loomi's sender alone: one unsubscribe tag, no send
platform field, and no ongoing dependency on GHL anywhere in this pipeline.

---

## 2. Hard rules

These come from Connor and govern every stage.

1. **The extraction is the source of truth.** Copy may not state any offer term,
   price, rate, date or claim not present in the extracted creative or the
   written request. If the request and the graphic disagree, stop and report the
   conflict rather than choose one.
2. **Disclaimers are carried verbatim** from the creative — never regenerated,
   reworded or summarized. This is co-op and legal text.
3. **Compliance is enforced in code and fails the build**, never left to
   prompting (§7).
4. **Every draft ships with subject line options** (initial plus urgent
   variations) **and preview text options.**
5. **Nothing sends or publishes automatically.** A person proofs every draft.

---

## 3. monday — what Loomi reads and writes

Requests live on **Development Projects** (`18431636272`): one project per
request, one subitem per deliverable (`18431636469`). **One subitem, one client,
one template, one proof, one link** (decided 2026-10-09): monday's fan-out makes
one subitem per client per unit, so "YPS Euro & Ogden, 2 emails" is four
subitems — "Email Blast 1 - Young Powersports Euro" and so on — and each store's
proof moves on its own. Board contract in code: `src/lib/drafting/monday-board.ts`.

| Subitem column | id | Owner | Loomi |
|---|---|---|---|
| Design Assets | `file_mm7z1a42` | design team | **reads** — the approved creative, drafting's input |
| Assets Approved | `color_mm7zba2g` | design team | **reads** — "Approved" means ready to draft |
| Draft Files | `file_mm7z7hyz` | Loomi | **writes** — the rendered draft, PNG + HTML |
| Loomi Template | `link_mm7zjhj9` | Loomi | **writes** — link to the draft's template in Loomi |
| Proof Status | `color_mm79xe71` | PageProof sync | reads — "Approved" is final |
| Proof URL | `link_mm79djf1` | PageProof sync | reads |
| Proof Approval Date | `date_mm7z9v44` | PageProof sync | reads |

Loomi also posts **updates** on the subitem: when a draft is ready (the template
link, the subject and preview options, what it read off the creative — offer
terms, dates and the disclaimer verbatim, low-confidence readings flagged — and
the draft's notes and warnings), or why it couldn't draft. Each notice is posted
once; the same news is never posted twice.

From the parent project Loomi reads Client, Co-op, Offer Disclaimer, Dev
Details, Complete by, Ad Run Dates, audience and Job Number. They are mirrors of
the rep's intake board, so the value is `display_value`; `text` is always null.
Client is read from the mirror's structured values, never by splitting its text:
"Young Caring For Our Young, Inc." is one store.

**The client moves to the subitem** (Connor, in progress on monday): a connect
column to **Oz Clients**, whose **Loomi Account Key** column (`text_mm7znnbh`)
names the account exactly. Until it lands, the client comes from the parent's
Client field — a request naming one client resolves by name; one naming several
waits at `needs_account` with a note.

**Proofing is not Loomi's.** A person starts the proof from the subitem by
uploading the files and submitting; the existing monday ↔ PageProof integration
writes Proof Status, Proof URL and Proof Approval Date back. Loomi builds no proof
page and calls no PageProof API.

**The write scope is enforced, not trusted:**

- Exactly three writes, each with its target fixed in the code: the Draft Files
  upload, the Loomi Template link, and an update. `monday-board.test.ts` reads the
  module source and fails if a fourth appears or a proof column turns up in one.
- Every write refuses an item on any other board.
- Outside production it refuses every subitem not listed in
  `DRAFTING_MONDAY_WRITE_SUBITEMS`. A local run touches only the subitem someone
  nominated.

Co-op flag labels: **Yes**, **No**, **Compliance Check**, or blank. Yes and
Compliance Check count as co-op (§7.2).

---

## 4. Pipeline

| # | Stage | Stops when |
|---|---|---|
| 0 | **Resolve** the monday Client to one Loomi account, its makes and its group | The Client names several stores (it can: "Young Powersports Ogden, Young Powersports Euro"), or no account matches |
| 1 | **Trigger** — Assets Approved turns "Approved" on the subitem; the intake pass (`loomi.drafting.intake`, every 5 minutes) starts it. A deliverable that already has Draft Files or a template link was built by hand and is left alone | — |
| 2 | **Fetch** the subitem, the project, and the Design Assets files | No approved assets, or a file over 40 MB (a layered PSD, not a flattened export) |
| 3 | **Extract + classify** — one vision pass, saved field by field | — |
| 4 | **Conflict check** — every number, date and disclaimer found in both the graphic and the request must agree | Any disagreement: both values are shown, nothing is chosen |
| 5 | **Confirm** — where a person checks the extraction, with no Loomi screen, is open (§10) | — |
| 6 | **Draft** — the model writes copy, subjects and previews; code assembles the email | — |
| 7 | **Validate** — the rule registry (§7) | Any error |
| 8 | **Publish** (`publish.ts`) — the draft becomes the account's Loomi template (`draft-…` slug, category `drafted`; later drafts update it and `TemplateVersion` keeps the earlier ones); the proof is rendered with Loomi's send-time footer and real account values; the PNG + HTML go to Draft Files, the Loomi Template column gets the link, and an update carries what was read | A monday write fails |
| 9 | **Watch** Proof Status | "Approved" freezes the version as final |

Steps 2–8 run as a pg-boss job. Vision plus drafting outlasts nginx's 60-second
cut, the same reason template sync went to the worker. The queue must be
`createQueue`'d, or the whole worker crash-loops (`queue-registration.test.ts`).

### What code owns and what the model owns

The model writes **only** the supporting copy, the subject lines and the preview
text. Code assembles everything else into a v2 `EmailTemplate`:

- the hero image (the approved creative);
- CTA URLs with their UTM tags;
- the disclaimer, pasted verbatim from the confirmed extraction;
- the footer (logo, camelCase site, unsubscribe token);
- fonts and colors.

The model never writes a disclaimer, a URL or a footer, so it cannot get them
wrong.

---

## 5. Extraction

**Persisted and correctable, field by field.** Each field records:

- the asset it came from;
- the model's value;
- the human-corrected value;
- who confirmed it.

The disclaimer cannot be drafted against until a person confirms it. Reading
6pt legal text off an image is the weakest step in the chain.

Monthly-offer fields:

- headline and subhead;
- vehicle (year, make, model, trim);
- offer type (lease / finance / cash / other);
- payment, term, APR, due at signing, MSRP and savings;
- expiration;
- CTA label;
- logos present;
- disclaimer text, verbatim.

Other request types (service special, sales event, event invite,
survey/announcement, conquest) share a common core and are out of slice 1.

---

## 6. Data model — built

- **`DraftRequest`** — one per monday deliverable. It holds:
  - the subitem and project ids, and the resolved account key;
  - status (`src/lib/drafting/status.ts`);
  - the approved creative, copied to Spaces with a content hash — a replaced
    file clears the extraction;
  - the extraction (proposed / confirmed, with edits);
  - the classification;
  - any conflicts.
- **`DraftVersion`** — immutable, one per draft attempt. It holds:
  - the v2 template;
  - the subject and preview options;
  - the rendered HTML snapshot and the PNG;
  - the rule evaluation;
  - the model and prompt hash;
  - the few-shot example ids used;
  - the parent version;
  - the monday asset ids written to Draft Files;
  - `finalAt`, set when Proof Status reads Approved.

Each draft also becomes an account-owned `Template` (the editor opens it at
`/templates/editor?design=<slug>`); `TemplateVersion` keeps its edit history,
and the `DraftVersion` keeps what the template's history can't — the rule
evaluation, the notes and the provenance of the copy.

**On Approved, freeze the version only. No `EmailBlast` is created.** This was
decided while GoHighLevel still carried most sends, to avoid a trail of drafts
that never send. With Loomi now the only sender that reason is gone, so it is
open for Connor to revisit.

---

## 7. Compliance rules — built

`src/lib/drafting/compliance/`. Every rule is a pure function of one
`DraftArtifact`, which holds:

- the assembled template and the rendered HTML;
- the subject and preview options;
- the account with its makes, groups and site name;
- the confirmed facts;
- the expected UTM campaign;
- the co-op pack.

How rules are organized and run:

- **Scoping is declarative.** A rule names the makes or groups it binds
  (`scope: { oems: ['Honda'] }`). It never branches on the brand inside.
- **One registry runs them all.** `registry.ts::evaluateDraft` runs every rule
  whose scope matches. Any error blocks the draft.
- **It fails closed.** A rule that throws counts as an error.
- **Each rule has fixture tests**, built on `__fixtures__/drafts.ts`: a compliant
  Young Chevrolet draft rendered through the real renderer. Each test breaks one
  thing.

### 7.1 The rules

| Rule | Scope | Severity |
|---|---|---|
| `copy.subject-and-preview-options` — at least one initial and one urgent subject and preview, none empty or duplicated | all | error |
| `claims.supported` — every number, date and make in the copy appears in the creative or request (§7.3) | all | error |
| `disclaimer.verbatim` — the disclaimer block equals the creative's text, whitespace aside, and renders | all | error |
| `footer.unsubscribe` — the footer links Loomi's `{{unsubscribe_link}}` | all | error |
| `links.utm` — every http link carries `utm_source=email`, `utm_medium=email`, `utm_campaign={slug}-{month}-{year}`, and a `utm_content` unique to it | all | error |
| `layout.multi-cta` — several CTAs sit in Columns (side by side), stack on mobile, full width | all | error |
| `fonts.no-serif` — no serif face anywhere, fallbacks included | all | error |
| `copy.dealer-name-in-full` — no CDJR, YAG, YPS… or the account's own short forms | all | error |
| `footer.site-url` — the footer shows the camelCase site name | all | error; warning if its domain differs from `Account.website` |
| `footer.dealer-logo` — the footer has the dealer logo | all except Hyundai, Audi, VW | error |
| `coop.banned-phrases` — the make's co-op banned phrases | all, when a pack exists | warning |
| `coop.pack-requirements` — dealer full name, year/make/model, VIN (last 8) in the disclaimer, "lease" beside the payment, where the make's pack requires them | co-op requests | warning |
| `fonts.yag-helvetica` — base font leads with Helvetica | Young Automotive Group | error |
| `oem.mazda.no-exclusivity` — "exclusive" in any form | Mazda | error; synonyms ("VIP", "only at", "invitation only"…) warn |
| `oem.kia.palette` — black and white only, no red | Kia | error; grays warn |
| `oem.honda.palette` — black, white and `#0079c0` only | Honda | error; grays warn |
| `oem.honda.no-uppercase-name` — never "HONDA", including subject, preview, alt text, footer, disclaimer, and CSS uppercase | Honda | error |
| `oem.vw.background` — every background `#eff1f5` | Volkswagen | error |
| `oem.vw.square-ctas` — button radius 0 (the default is 4px) | Volkswagen | error |
| `oem.no-footer-logo` — no logo in the footer | Hyundai, Audi, Volkswagen | error |

How the rules read the email:

- **Copy rules** read the template, so a finding names its block. They skip the
  verbatim disclaimer, which is legal text and not ours to change.
- **Rendered-output rules** (links, colors, fonts) read the HTML that goes into
  Draft Files, which includes every component's built-in styles.
- **One exception, deliberately:** react-email sets `color:#067df7` on the link
  around every image. No text takes that color, so the palettes ignore it.
- **A text link with no color of its own is an error for Kia and Honda.** Inboxes
  paint it their default blue.

### 7.2 Co-op never blocks

Co-op findings are warnings, read as notes on the draft. Nothing about co-op
can stop a draft reaching Draft Files. A person reviews every draft and adjusts
it; co-op claims, matching funds, evidence capture and eligibility rulings are
outside this project (decided 2026-10-09). The hard blocks stay where they are —
the fact check, the verbatim disclaimer and the house rules — because those are
about not sending something wrong, which is a different risk from co-op
reimbursement.

- **Banned phrases** use the ad engine's own matcher
  (`coop-rules.ts::bannedPhraseHit`) and warn on every request whose make has a
  pack.
- **Four cheap pack requirements** warn on co-op requests: the dealer's full
  name, year/make/model in the email body, the VIN's last 8 in the disclaimer,
  and "lease" beside a lease payment. The pack decides whether each applies to a
  make; the matching is written for email, because two transcribed matchers don't
  hold up: the Subaru VIN pattern `[A-Z0-9]{8}` is matched case-insensitively, so
  any eight-letter word satisfies it, and `phrase: 'lease'` is a substring test
  that "please" passes.
- A registry test asserts every `coop.*` finding is a warning, whatever the pack
  or the flag.

### 7.3 The fact check, and the incident it is built on

The Young Mazda of Missoula "CX-90 Monthly Offer" went out twice in September
2026, to 554 and then 513 people.

- **Its body:** 1.9% APR for 72 months on the 2026 CX-90.
- **Its subject and preview:** "$10,000 off MSRP ($65,515) on the new 2026 Jeep
  Gladiator Mojave X", copied from another store's blast.

It is the first fixture in `rules/claims.test.ts`. The check catches it three
ways: $10,000 and $65,515 appear in no source, and Jeep is a make Missoula
doesn't sell and no source mentions.

How claims are matched:

- **Money and rates match in kind.** "$3,500" needs a "$3,500" in a source; a
  "10%" or the month of "10/31" does not vouch for "$10".
- **Dates match however they're written.** "Oct 31" is the same claim as
  "10/31/2026".
- **A bare single digit is exempt.** "3 rows" makes no claim.
- **A unit is never exempt.** "0% APR" is the whole offer.
- **Makes match case-sensitively.** "ram", "ford" and "genesis" are words; a
  capitalized one opening a sentence does read as the brand.
- **A conquest email may name a competitor** when the request names it.

Sources are the confirmed extraction and the request. The footer and the
verbatim disclaimer aren't checked, because code assembles them from trusted data.

### 7.4 Interpretations to confirm

- **"Black and white only"** blocks any hue and warns on grays (e.g. `#3a3a3a`
  body text) rather than blocking them.
- **VW "#eff1f5 backgrounds"** is read as every surface: page, content,
  sections, columns and spacers. Buttons are not surfaces.
- **"Flag synonyms" (Mazda)** is read as warn, not block.
- **utm_campaign shape:** `{kebab-name}-{full month}-{year}`, e.g.
  `cx-90-monthly-offer-october-2026` (`utm.ts::campaignSlug`).
- **YAG membership** follows Loomi's account tree. Young Automotive Group has 26
  automotive stores plus Young Grand Teton Harley-Davidson, Young Grizzly
  Harley-Davidson and Young Honda Powerhouse. The Young Powersports stores sit
  under a separate group, `youngPowersports`, so the Helvetica rule doesn't reach
  them.
- **The approved creative's own pixels aren't checked.** "No red" binds the
  email around the graphic, not the design team's image.

### 7.5 Data the rules need that doesn't exist yet

- **`siteDisplay`** — the camelCase site, e.g. `YoungCDJRRiverdale.com`. It can't
  be derived: Riverdale's `Account.website` is
  `youngchryslerdodgejeepramriverdale.com`, a different domain from the display
  form. Proposed: a new `Account` field. Until set, every draft for that account
  is blocked by `footer.site-url`.
- **Per-account abbreviations** for `copy.dealer-name-in-full`, beyond the global
  CDJR / YAG / YPS / YUC / T&T list.

---

## 8. Co-op requests: the guideline documents as drafting input

The goal for a co-op-flagged request is a draft as close to co-op compliant as
it reasonably gets, so the person proofing has less to fix. The guideline
documents are **input to drafting, not a gate on it.**

**What Loomi holds.** 33 manufacturer guideline documents across 26 makes in
`AdGuidelineDoc`, with per-page text extracted and searchable for all but one
(Genesis Tier 3 R6 has no text), plus three hand-transcribed rule packs
(Chevrolet, Mazda, Subaru). Nissan, a current Toyota and several powersports
brands are missing; Connor is getting them in. A make without a document simply
drafts without co-op context.

**How drafting uses them, for a co-op request:**

1. Pick the make's document(s) from an explicit make → document map. A lookup
   by make finds the wrong document or none: Chrysler, Dodge, Jeep and Ram are
   filed as "CDJR", Honda's car and powersports guides are both filed as "Honda",
   and Buick and GMC fall under GM iMR, filed as Chevrolet.
2. Pull the relevant pages — offer, pricing, disclaimer, logo and trademark,
   email/digital — with the existing guideline search, and give them to the
   drafter as context alongside the confirmed extraction.
3. The drafter writes copy that satisfies them, and returns a list of what it
   couldn't satisfy, each with the page it comes from. A required disclosure
   missing from the creative is one of those: the disclaimer is verbatim and
   can't be changed, so it becomes a note and Connor decides whether to go back
   to design.
4. Those items are saved as notes on the draft version, beside the warnings from
   §7.2. Nothing blocks.

**Not in scope:** eligibility rulings, a signed-off requirements checklist,
growing per-brand rules from accepted items, claim evidence capture, and any
enforced route back to design.

**Worth knowing when reading notes** (from the documents, 2026-10-09; page
numbers as stored): Subaru lists direct mail and email as ineligible except
through CareConnect (p. 19); GM pays email sent by a non-approved vendor as a
No-Match claim (p. 21); Subaru requires an advertised price to show the official
TSRP, labeled "TSRP", and an itemized price calculation beside the offer (p. 44).

---

## 9. Few-shot corpus

**Built from finals.** The finals teach voice, structure and how an offer becomes
copy. Each approved email already contains its offer, headline and disclaimer,
so the extraction side of an example is derived from the final itself. No input
graphic is needed.

**Segmented by request type across all brands, not by OEM.** OEM is too thin
(Young Honda: no approved email on the old board; Kia: 2) and only governs compliance, which is code.

Sources:

| Source | What it gives | When |
|---|---|---|
| Loomi prod `EmailBlast` | 89 sent one-off blasts. Minus 6 tests that leaves ~45 unique campaigns, ~30 of them monthly model/APR offers, plus ~35 "(follow-up)" resends: real initial → urgent subject pairs | now |
| GoHighLevel | historical finals only: a one-time export into the corpus. GHL is retiring and is never read again | once, when Connor's export is ready |
| Old Email & Text Requests board (`18397071949`) | 136 approved email subitems, every proof on PageProof. Output files on monday for only 2, input graphics for 37 | the 37 with graphics become the **extraction evaluation set** |

Reading the input graphic is a vision task. About ten hand-built examples, plus
the human confirmation gate, will do more than a hundred few-shot pairs, so
extraction doesn't wait on the corpus.

Examples are shown as **extraction → final copy**. That teaches the mapping
rather than the old offers. Any stale price that leaks into a draft is caught by
`claims.supported`.

---

## 10. Build status

| Piece | State |
|---|---|
| monday transport (`src/lib/monday/client.ts`), shared with the help desk | **built** |
| Development Projects contract — reads, the three writes, the write guard (`src/lib/drafting/monday-board.ts`) | **built**; queries verified against the live board, API version 2024-10 |
| Local smoke script (`scripts/drafting-monday-smoke.ts`) | **built**; needs `MONDAY_API_TOKEN` |
| Compliance rule registry, 19 rules, fixture tests | **built** |
| Co-op warnings: banned phrases + the four cheap pack requirements | **built** |
| UTM slug and tagging (`src/lib/drafting/utm.ts`) | **built** |
| `DraftRequest` / `DraftVersion` models | **built** |
| Drafting job queue (`loomi.drafting.run`) — fetch stage: re-checks approval, copies the creative | **built**; DB-tested (`drafting.db.test.ts`) |
| Race-safe start (`requests.ts::startDraftRequest`) | **built** |
| monday Client → account resolver (`accounts.ts`) | **built**; calibrated on the real names |
| Proof Status watcher → freeze (`loomi.drafting.proof-status`, every 15 min) | **built**; read-only against monday |
| Intake: every 5 minutes, approved creative → request; holds + notices once; bounded quiet retries (`intake.ts`) | **built**; DB-tested |
| Publish: template in Loomi, proof PNG + HTML to Draft Files, Loomi Template link, update with what was read (`publish.ts`, `notes.ts`) | **built**; DB-tested |
| Client from the subitem (Oz Clients connect → Loomi Account Key) | waiting on monday |
| Extraction (vision) | next |
| Co-op documents as drafting context, notes on the draft (§8) | next, with the drafter |
| Corpus import from Loomi prod | next |
| Drafting + assembly (the step between fetch and publish) | next |
| Account → `siteDisplay`, abbreviations | next (needs the field) |

**Retries, without noise.** A request that can't start waits (`needs_account`
or `failed`) with one notice on the subitem. The intake retries it as soon as
what it's made from changes on monday — the design assets or the client, hashed
as `intakeFingerprint`; not the item's `updated_at`, which Loomi's own updates
may bump. A failure with nothing changed is retried quietly at most three times,
30 minutes apart, which rides out a monday or S3 hiccup without a fresh notice.

**Switched off until turned on.** The intake does nothing unless
`DRAFTING_INTAKE_ENABLED=true` on the droplet — `MONDAY_API_TOKEN` alone isn't
enough, because the help desk needs the token too. Turn it on once the drafter
can finish what the intake starts; until then a started request stops at
`awaiting_extraction`. No route or page uses any of this.

---

## 11. Operating notes

- `MONDAY_API_TOKEN` is unset in every environment. Until it is set, the help
  desk falls back to email, and drafting can't read the board.
- **Testing against the real board locally:**

  ```
  DRAFTING_MONDAY_WRITE_SUBITEMS=<nominated id> npx tsx --env-file=.env.local \
    scripts/drafting-monday-smoke.ts --subitem <id> --upload ./draft.png
  ```

  Reads (`--list`, `--subitem <id>`, `--download`) need no nomination.
- monday's asset `public_url` is a signed S3 link that expires in about an hour.
  It is fetched immediately and never stored.
