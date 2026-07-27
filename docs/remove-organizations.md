# Removing the Organization model

Organizations have been superseded by the account hierarchy
(`Account.parentAccountKey`). A group like Young Automotive Group is now just an
Account with children: it sends its own marketing AND rolls up its rooftops.
Everything user-facing already runs off the hierarchy. What remains is deleting
the dead layer.

**Do this in the order below.** Steps 1–2 are safe and independently
shippable; step 4 is destructive and must come last.

---

## ⚠️ Three traps — read before starting

### 1. Two service functions are load-bearing. Do NOT delete `organizations.ts` wholesale.

| Function | Used by | Why it matters |
|---|---|---|
| `getRelatedAccountKeys` | `api/contacts/[contactId]/suppression`, `sending/sendgrid-events.ts`, `sending/twilio-events.ts` | **Compliance.** Cascades an opt-out to every account grouped with this one. Already unions org membership + the hierarchy. |
| `resolveOrgAccountKeys` | `lib/auth.ts` (JWT build) | Expands org grants into `accountKeys`. Removing it before migrating `User.orgKeys` **revokes access** for anyone holding an org grant. |

Move `getRelatedAccountKeys` into `services/accounts.ts` (drop its org half once
`organizationId` is gone). Only delete `resolveOrgAccountKeys` after step 3.

### 2. Deleting an Organization row can DESTROY data.

`Template`, `Form`, and `LandingPage` declare `onDelete: Cascade` on the
organization relation (`Account` uses `SetNull`). Dropping org rows before
reassigning their owned records **deletes those records**.

`deleteOrganization()` already guards this — it reassigns to the group account
first and refuses when no account can inherit. **Any bulk cleanup must do the
same.** Verify `org-owned: none` via the migration script before dropping
anything.

### 3. The active-scope cookie is shared across surfaces.

`loomi-active-account` stores `org:<id>` and is read by studio/app/reporting.
`account-context.tsx` already falls back to admin when the org doesn't resolve —
keep that fallback until the cookie format is retired, or users land in a broken
scope with no `accountKey`.

---

## Step 1 — Remove the UI surfaces (safe, ship alone)

Stops anyone recreating an org. Nothing else depends on these.

- Delete `src/components/settings/organizations-tab.tsx`
- Delete `src/components/settings/organization-settings-tab.tsx`
- Delete `src/app/settings/organizations/` (whole dir)
- `src/components/settings/use-settings-tabs.ts` — drop the `'organizations'`
  and `'organization'` tab entries (~lines 23–24, 66, 73)
- `src/app/settings/page.tsx` — drop the two tab renders + imports (~lines 133–134)
- `src/components/accounts-list.tsx` — remove the org picker in the create-account
  modal and the "promote to organization" action; replace with a **parent account**
  picker (the selector in `AccountSettingsTab` is the reference implementation)
- `src/components/agency-dashboard.tsx` — the Organizations stat/grid; switch
  `standaloneCount` from `!a.organizationId` to `!a.parentAccountKey`

**Verify:** `npm run verify` + no route can reach an org form.

## Step 2 — Retire the `/org/*` routes

`src/app/org/[slug]/layout.tsx` is already a redirect to `/subaccount/<slug>/…`.
Keep it one release for old bookmarks, then delete `src/app/org/` entirely.

Also then-dead in `src/lib/account-slugs.ts`: `ORG_ROUTE_ROOTS`, `orgSlugFor`,
`orgSlugToId`, `orgPath`, `isOrgRoute`, `extractOrgSlug`.

`src/hooks/use-scoped-href.ts` exists only to keep roll-up links inside
`/org/<slug>` — once there's one URL scheme it collapses back into
`useSubaccountHref`.

## Step 3 — Migrate auth grants (do BEFORE step 4)

`User.orgKeys` grants access to an org's children. Convert each to the
equivalent **parent account key**, then:

- `src/lib/auth.ts` — drop the `resolveOrgAccountKeys` block. The
  `expandAccountKeysWithDescendants` call right below it already covers the
  hierarchy, so a parent-account grant keeps implying its rooftops.
- Remove `orgKeys` from the NextAuth `User`/`JWT`/`Session` type declarations,
  `src/app/api/impersonate/route.ts`, and `src/components/dev-impersonate.tsx`.
- `src/lib/api-auth.ts` — `canAccessOrg` + `getOrgChildKeys`; note the duplicate
  local implementation in `src/app/api/templates/route.ts`.

**Everyone must log out and back in** — grants are computed at JWT build.

## Step 4 — Drop the model (destructive, last)

Only once steps 1–3 are live and no org rows own anything.

1. Confirm nothing is owned:
   `npx tsx scripts/migrate-orgs-to-account-hierarchy.ts` → every org shows
   `org-owned: none`.
2. Delete rows via `deleteOrganization()` (which reassigns safely) — **not** a
   raw SQL `DELETE`, which would cascade.
3. Schema: remove `model Organization`; `Account.organizationId` + relation +
   index; `Template`/`Form`/`LandingPage`/`AdTemplateDoc.organizationId` +
   relations + indexes; `User.orgKeys`.
4. Delete `src/app/api/organizations/` and the remainder of
   `src/lib/services/organizations.ts`.
5. Drop the legacy `organizationId` branches in `services/templates.ts`,
   `forms.ts`, `landing-pages.ts` (each currently ORs it alongside the ancestor
   match), and the org brand-kit fallback in `api/accounts/route.ts`.
6. `src/lib/active-account.ts` — `ORG_PREFIX`, `encodeOrgValue`, `parseOrgValue`.
7. `account-context.tsx` — `isOrg`, `organizationId`, `organizationData`,
   `organizations`, `OrganizationData`, and the `{ mode: 'org' }` union member.

---

## Already migrated to the hierarchy (don't re-point these)

- Roll-ups (contacts/lists/segments/reporting) → `scopedAccountKeys`
- Brand-kit inheritance → walks the `parentAccountKey` chain
- Template / form / landing-page inheritance → "mine + my ancestors'"
- Suppression cascade + access grants → union of both (intentionally wider)
- Nav, switcher, `/org` redirects
