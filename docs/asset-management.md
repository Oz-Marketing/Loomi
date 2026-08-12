# Asset Management (DAM) Architecture

**Status:** Proposed (v3) — supersedes `dam-file-structure-design-v2.md` (2026-08-11)
**Date:** 2026-08-11
**Scope:** Turning Loomi's media library into a DAM that serves multi-OEM, multi-rooftop automotive clients.

v2 was a standards-grounded design written without reference to the codebase. Its
architecture is largely right and is carried forward here. What changes is that
every recommendation below is stated against what Loomi actually has, in the order
the code makes possible, and a few of v2's items are dropped with reasons.

---

## 1. Where Loomi actually is

The media library is real and in daily use. It is a **file drawer, not a DAM**.

| Capability | Today | Reference |
|---|---|---|
| S3 storage, thumbnails, crop, duplicate, archive, bulk actions | Working | [`api/media/route.ts`](../src/app/api/media/route.ts) |
| Folders, unlimited nesting | Working | [`MediaFolder`](../prisma/schema.prisma) |
| Alt text | Working — the only metadata field actually populated | `MediaAsset.altText` |
| `category` | Live, but only via the picker. [`media-picker-modal.tsx`](../src/components/media-picker-modal.tsx) writes and filters it against `MEDIA_CATEGORIES` (the ad builder's Textures tab depends on it). The media library page itself hard-codes `'general'` on every upload and offers no filter | [`media-categories.ts`](../src/lib/media-categories.ts) |
| `tags` | Column exists, commented "for future DAM filtering". **Zero reads or writes anywhere in the repo.** | `MediaAsset.tags` |
| Search | `filename contains` only | `api/media/route.ts` GET |
| Scope | Exactly two: admin-level (`accountKey = null`) or one sub-account. No OEM tier, no inheritance | `MediaAsset.accountKey` |
| Versioning / parent asset | None | — |
| Lifecycle state | `archivedAt` timestamp only | — |
| Rights, licensing, expiration | None | — |
| Duplicate detection | None — the same bytes uploaded twice create two records | — |
| Upload limits | 25 MB cap, no MIME restriction | `MAX_UPLOAD_SIZE` |

### 1.1 The one fact that drives everything else

**Media does not inherit down the account hierarchy.** Templates do —
`getEffectiveTemplatesForAccount` resolves "mine + my ancestors'" via
`getAncestorAccountKeys`, the pattern that replaced the Organization model (see
[`remove-organizations.md`](remove-organizations.md)). Media never got it: the GET
handler filters on one exact `accountKey`.

Consequence today: an Audi asset needed by six Audi rooftops is either copied six
times or parked in the admin library, which sub-account users cannot reach. Every
other gap in this document is cosmetic next to this one.

### 1.2 What Loomi already has that v2 assumed it would need to build

v2's §9 calls compliance pre-flight "genuine white space, not available in any
DAM." That half is built:

- [`AdCoopRulePack`](../prisma/schema.prisma) — versioned, date-scoped, citation-backed per-make co-op rules; unverified packs warn rather than block
- [`AdGuidelineDoc`](../prisma/schema.prisma) — source documents with sha256 content hashing and change detection
- `AdTemplateCoopApproval` / `AdTemplateCoopCheck` — design-time compliance approval
- `preflight.ts` — field-level and rule-level checks at generation

So the differentiated, hard-to-buy layer exists. What is missing is the boring
layer: scope, metadata, and search. That inverts v2's implicit build order.

### 1.3 Patterns to lift rather than invent

Each of these already works somewhere in the repo and should be reused, not
rewritten:

| Need | Existing implementation |
|---|---|
| Ancestor inheritance | `getAncestorAccountKeys` (`lib/services/accounts.ts`) |
| Faceted filtering, derived not hand-tagged | [`ad-facets.ts`](../src/lib/ad-generator/ad-facets.ts) |
| Content hashing for change/dupe detection | `AdGuidelineDoc.contentHash` |
| Date-windowed asset validity | `AdOemEventAsset.effectiveFrom` / `effectiveTo` |
| Category + tags taxonomy on a library object | `AdTemplateDoc.category` / `.tags` |
| Controlled OEM vocabulary | [`lib/oems.ts`](../src/lib/oems.ts) (`MAJOR_US_OEMS`, `POWERSPORTS_BRANDS`) |
| Expiration sweep with notification | [`automation/expire-ads.ts`](../src/lib/ad-generator/automation/expire-ads.ts), run from the worker |

---

## 2. What changes from v2

Carried forward unchanged: governance-first, shallow folders + faceted metadata,
controlled vocabularies, rights management with automated expiration, COPE
(reference don't copy), collections, build-don't-buy.

Changed:

**2.1 The scope axis is not folders — it is `accountKey`.** v2's storage tree
(`/assets/global`, `/oem-{slug}`, `/client-{group}-{rooftop}`, `/campaigns`)
describes a filesystem. Loomi does not organize by path; S3 keys are
`media/{accountKey|_admin}/{assetId}/{filename}` and are an implementation
detail. The equivalent of v2's tree is a **scope column plus a resolution rule**,
not a directory layout. §3 restates it that way.

**2.2 Four lifecycle states, not seven.** v2 proposes
DRAFT → IN_REVIEW → APPROVED → ACTIVE → EXPIRED → ARCHIVED → DISPOSED. The
codebase's own convention is a short `status` plus a separate `archivedAt`
timestamp, deliberately not merged — `AdCreative` documents why: folding archive
into status loses which state a record was in when it was put away, so restoring
has to guess. DISPOSED is a retention-policy concept with no owner and no legal
driver at Oz. See §5.

**2.3 XMP writeback is dropped.** v2 §5.4 is genuine enterprise practice, but it
buys nothing until something outside Loomi reads the embedded fields. Revisit if
and when assets are delivered to a system Oz does not control.

**2.4 Build order is inverted.** v2 leads with governance and lifecycle. Both are
correct and neither is actionable while assets can't be scoped or found. Scope and
metadata first; approval workflow last. See §8.

---

## 3. Scope model

Replaces v2 §4.2. Three scopes on `MediaAsset`, resolved as a union at read time:

| Scope | Stored as | Means |
|---|---|---|
| Global | `accountKey = null`, `oem = null` | Oz-wide, brand-agnostic (legal text, Oz brand) |
| OEM | `accountKey = null`, `oem = 'Audi'` | Manufacturer-supplied, shared by every rooftop carrying that brand |
| Account | `accountKey = '<key>'` | Owned by one account — which, given the hierarchy, may be a group account whose children inherit it |

**Resolution for a sub-account** = global ∪ (OEM assets for that account's brands)
∪ ancestors' assets ∪ its own. Brands come from `Account.oem` ∪ `Account.oems`
(the JSON array that exists for multi-brand dealers). Ancestors come from
`getAncestorAccountKeys`.

This deliberately keeps `accountKey = null` meaning "not owned by an account" and
adds `oem` as an orthogonal dimension, rather than encoding OEM into a magic
account key. A group account that carries three brands inherits all three without
any row being copied — which is v2's COPE principle expressed in a query instead
of a folder tree.

**Folders stay, and stay dumb.** They are a user convenience within a scope, not
the classification system. No business meaning is read out of a folder name, ever.
v2's warning about deep hierarchies applies: `MediaFolder` nests without limit
today and folders are currently the *only* organizing mechanism, which is exactly
how the anti-pattern takes hold. Facets are the fix, not a nesting cap.

---

## 4. Metadata schema

v2 §5's field list is sound. Grounded against the existing model, the fields split
into three groups.

**Already present:** `filename`, `mimeType`, `size`, `width`/`height`, `altText`,
`uploadedBy`, `createdAt`/`updatedAt`, `archivedAt`, `folderId`.

**Add in Phase 1 (§9):** `oem`, `assetSource`, `assetCategory`, `modelYear`,
`vehicleModel`, `rightsHolder`, `parentAssetId`, `contentHash`, and a real `tags`
payload.

**Defer:** `campaignId` (until Go-to-Market links assets), `territory`,
`channelRestrictions`, `complianceStatus`/`complianceFlags` (until §8 Phase 5
wires pre-flight to media), VIN (until inventory photography is actually stored in
Loomi rather than pulled from feeds).

### 4.1 Controlled vocabularies

v2 is right that these must be dropdowns, not free text. Sources:

| Field | Vocabulary source |
|---|---|
| OEM | `MAJOR_US_OEMS` + `POWERSPORTS_BRANDS` from `lib/oems.ts` — already the app's normalized list |
| Asset category | New constant: Display, Social, Video, Print, Email, Logo, Photography, Template, Document |
| Source | New constant: OEM-supplied, Oz-created, Stock, Dealer-supplied |
| Vehicle model | MarketCheck, via the same path the Ad Generator's YMM picker uses |
| Account / group | `Account` records |

Free text stays free only for filename, description, and keyword tags — and tags
should suggest-from-existing before allowing a new value, per v2 §5.3.

### 4.2 Facets, derived where possible

Follow [`ad-facets.ts`](../src/lib/ad-generator/ad-facets.ts): a facet that has to
be hand-maintained goes stale in the first busy week. MIME type, dimensions,
orientation, and file family are derivable and should never be asked for. OEM is
derivable on upload from the uploading account's brand when the asset is
account-scoped. Only genuinely editorial fields — category, source, rights,
model year — need a human.

---

## 5. Lifecycle

Four states on a `status` column, plus the existing `archivedAt` timestamp kept
separate:

```
draft → approved → expired
                 ↘ (archivedAt set at any point; orthogonal, restorable)
```

| State | Means | Set by |
|---|---|---|
| `draft` | Uploaded, not cleared for use | Default on upload |
| `approved` | Cleared for use in live creative | A reviewer, or automatically for OEM-supplied assets that arrive pre-approved |
| `expired` | Rights lapsed or effective window passed | The expiration sweep (§6), or manually |

`archivedAt` remains what it is now: hidden from the default view, restorable,
independent of status. Deletion stays a real delete, as today.

Approval is genuinely useful but is Phase 5 — it imposes process cost on every
upload and returns nothing until assets can be found in the first place.

---

## 6. Rights management

v2 §6 is the strongest section of the original and is adopted close to intact.
Fields: license type, license holder, license reference, usage scope, territory
scope, license start/end, exclusivity, talent release on file, derivatives
permitted, sublicensing permitted.

**Implementation note:** this is a second consumer of a pattern that already
runs. `AdOemEventAsset.effectiveFrom`/`effectiveTo` is a working date-windowed
asset validity check, and [`expire-ads.ts`](../src/lib/ad-generator/automation/expire-ads.ts)
already does scheduled demotion plus notification from the worker. The 30-day /
7-day / on-expiry cadence in v2 §6.2 should reuse that machinery rather than
introduce a second scheduler.

Two rights fields matter more than the rest for Oz specifically and should not be
cut for scope: **license expiration** (drives the sweep) and **derivatives
permitted** (an OEM asset that may not be composited is a compliance incident
waiting to happen once generation is unattended).

---

## 7. Naming convention

Adopt v2 §7 as written:

```
{oem}_{rooftop}_{model-or-offer}_{asset-category}_{dimensions}_{version}.{ext}
```

with `shared` in the rooftop slot for OEM-level assets and `global` in the OEM
slot for brand-agnostic ones.

**Treat it as advisory, not enforced.** Once §4's metadata exists, filename is a
human fallback rather than the classification system, and rejecting an upload on a
filename pattern will simply push people to upload elsewhere. Do not build
validation for it. Do not rename historical files.

---

## 8. Phase plan

Ordered by dependency, not by value.

**Phase 1 — Scope and metadata.** OEM tier, union resolution, the Phase 1 column
set, dedupe on content hash. Spec in §9. Nothing else in this document is possible
until this lands, and it alone solves the OEM-duplication problem.

**Phase 2 — Make the taxonomy real.** Wire `assetCategory` and `tags` into the
upload and edit UI, populate the controlled vocabularies, and add faceted search
over them. Replace `filename contains` with metadata search.

**Phase 3 — Rights and expiration.** §6, on the existing sweep.

**Phase 4 — Renditions and delivery.** Auto-generate platform sizes from a master;
bulk download; a read-only consumer view for clients. This is where the
OEM-portal experience clients actually ask for gets built. Raise the 25 MB cap
here — real masters (video, layered PSD, InDesign) do not fit under it, and the
cap should become per-MIME rather than global.

**Phase 5 — Approval and compliance.** §5's `approved` transition, with
pre-flight firing on submit. AI auto-tagging after this, never before — tagging
without a governed vocabulary produces high-volume inconsistent tags, per v2 §9.2.

---

## 9. Phase 1 specification

### 9.1 Schema

Additive columns on `MediaAsset`. All nullable, so they reach every environment
via `prisma db push` on deploy — the convention the Ad Generator follows and the
one the deploy scripts already run (`db:sync`, `deploy:prepare`).

```prisma
// Scope: null = not OEM-specific. Set with accountKey null = an OEM-shared
// asset, visible to every account carrying that brand.
oem            String?   // normalized against lib/oems.ts

// Editorial metadata.
// `assetSource`, not `source` — the API payload's `source` is already the
// storage discriminator ('esp' | 's3') the media UI reads.
assetSource    String?   // OEM-supplied | Oz-created | Stock | Dealer-supplied
assetCategory  String?   // Display | Social | Video | Print | Email | Logo |
                         // Photography | Template | Document
modelYear      String?   // JSON number[] — a package can span MY25 + MY26 and
                         // must not be collapsed to one value
vehicleModel   String?   // JSON string[]
rightsHolder   String?

// Derivative lineage — a resized/cropped output points at its master
parentAssetId  String?

// sha256 of the bytes. Dedupe on upload and the basis for "is this the same
// file we already hold", the same job contentHash does on AdGuidelineDoc.
contentHash    String?

@@index([oem, archivedAt])
@@index([contentHash])
```

**`category` is kept, not replaced.** It has a live consumer:
`media-picker-modal.tsx` writes it on upload and filters on it, and the ad
builder's Textures tab resolves `category = 'texture'`. The two fields answer
different questions and are deliberately separate:

- `category` (`MEDIA_CATEGORIES`) — *which picker tab does this appear under*. A Loomi-internal UI affordance.
- `assetCategory` — *what kind of asset is this* in DAM terms (v2 §5.2). The taxonomy facet.

Merging them would produce an incoherent vocabulary — `texture` is a purpose,
`oem` is a source, `Display` is a medium — and would break the builder. Revisit
only if Phase 2's facets make `category` redundant in practice.

`tags` needs no schema change; it needs the UI and the read path that were never
built.

**No unique constraint on `contentHash`.** Duplicates must be detectable and
warned about, not rejected — the same file legitimately exists under two scopes
(an OEM master and a rooftop's approved copy), and a hard constraint would also
fail `db push` on any environment already holding duplicates. This is the same
trap that forced `ensure-adcreative-offer-unique.ts` to exist; do not repeat it.

### 9.2 Read resolution

New helper alongside the existing account services, mirroring
`getEffectiveTemplatesForAccount`:

```ts
getEffectiveMediaForAccount(accountKey: string, opts): Promise<MediaAsset[]>
```

Where clause, as an `OR`:

1. `{ accountKey: null, oem: null }` — global
2. `{ accountKey: null, oem: { in: brandsOf(account) } }` — OEM-shared
3. `{ accountKey: { in: await getAncestorAccountKeys(accountKey) } }` — inherited
4. `{ accountKey }` — own

`brandsOf` = `Account.oem` ∪ `JSON.parse(Account.oems ?? '[]')`, normalized and
deduped. Existing behaviour is preserved exactly when an account has no brands and
no ancestors: the clause collapses to global ∪ own.

Admin-level reads (`accountKey = null` with no account context) keep the current
behaviour — everything unscoped — and gain an OEM filter.

### 9.3 Write path

- Upload accepts `oem`, `source`, `assetCategory`, `modelYear`, `vehicleModel`, `rightsHolder`, `tags`.
- `contentHash` computed server-side on every upload. If a match exists **in the same scope**, return the existing asset with a `duplicate: true` flag rather than creating a row; the UI offers "use existing" or "upload anyway".
- Writing an OEM-scoped asset (`accountKey = null`, `oem` set) requires admin rights — same check as admin-library upload today. An OEM asset is shared by every rooftop carrying the brand, so a single rooftop user must not be able to publish into it.
- Backfill: none required. Every new column is nullable and every existing asset stays exactly as visible as it is now.

### 9.4 UI

- Scope selector on upload: This account / OEM: {brand} / Global (admin only for the latter two).
- Metadata panel on the asset detail drawer, alongside the existing alt-text field.
- Source badge on the card so an OEM-supplied asset is visually distinct from a rooftop's own.

Filtering and search come in Phase 2 — Phase 1 stores the data and proves the
resolution rule.

---

## 10. Deliberately not doing

- **XMP embedded writeback** (v2 §5.4) — no external consumer.
- **DISPOSED / retention scheduling** (v2 §3) — no owner, no legal driver.
- **Filename validation** (§7) — advisory only.
- **Buying a DAM** — v2 §9.3's reasoning holds and is now stronger: the compliance layer no vendor provides is already built here (§1.2). Paying $20K–$90K/yr for storage and a browse UI, then building the automotive layer on top anyway, is the worst of both.
- **AI auto-tagging before Phase 5** — produces volume, not quality, without a governed vocabulary.

---

## 11. Worked example: the Audi batch

The 17 Audi packages in `audi-dam-upload.md` are a fair test of this design, and
the honest answer today is mixed.

**What the design handles.** They are OEM-level, not rooftop-level — exactly the
case §3's OEM scope exists for. Under Phase 1 they land once as
`accountKey = null, oem = 'Audi', source = 'OEM-supplied', assetCategory =
'Template'`, and every Audi rooftop sees them without a copy. The duplicate
upload the note opens with is caught by `contentHash` (§9.3). The MY25/MY26 span
is why `modelYear` is a JSON array and not an integer (§9.1) — the note is right
that collapsing it loses information.

**What the design does not handle, and should be said plainly.** These are Google
Web Designer template packages. Loomi stores a `.zip` as an opaque blob: no
thumbnail, no preview, no render. They cannot become `AdTemplateDoc` records, and
nothing in this document changes that. Filing them correctly buys *findability*,
not *capability* — a per-dealer Audi creative still gets built by hand or rebuilt
as a Loomi template. Anyone told "upload them to Loomi" will reasonably expect
more than they will get.

**Also true today:** the 17 packages are ~650 KB each and fit the 25 MB cap
comfortably. The cap becomes a problem in Phase 4, not now.

The note's advice to rename the files before upload is right, and right for the
reason §7 gives: until Phase 1 ships, the filename is the only metadata Loomi will
retain.

---

## 12. Governance

v2 §2 is correct and is the one item that is not a code task. Name a single owner
for asset taxonomy decisions before Phase 2 ships. Every controlled vocabulary in
§4.1 degrades into free text within two quarters without one, and no amount of
schema prevents that.

Loomi's existing roles (`developer | super_admin | admin | client`) map onto
v2's four DAM tiers closely enough that no new role model is needed:
admin/developer are Administrators, account-scoped admins are Contributors and
Reviewers, and `client` is the Consumer tier that Phase 4's read-only portal view
would serve.
