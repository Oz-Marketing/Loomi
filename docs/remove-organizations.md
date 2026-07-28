# The Organization model has been removed

Organizations were superseded by the account hierarchy
(`Account.parentAccountKey`). A group like Young Automotive Group is now just an
Account with children: it sends its own marketing AND rolls up its rooftops.

This file was the removal runbook. The removal is **complete in code** — kept
here as a record of what changed and what still has to happen per environment.

---

## What replaced what

| Old (Organization) | New (Account hierarchy) |
|---|---|
| `Account.organizationId` | `Account.parentAccountKey` (self-relation) |
| Org-owned template/form/landing page (`accountKey` NULL + `organizationId`) | Owned by the **group Account**; children inherit via "mine + my ancestors'" |
| `User.orgKeys` | An `accountKeys` grant on the group account, expanded by `expandAccountKeysWithDescendants` |
| `resolveOrgAccountKeys` (auth) | `expandAccountKeysWithDescendants` (`services/accounts.ts`) |
| `getRelatedAccountKeys` (org ∪ hierarchy) | `getRelatedAccountKeys` (hierarchy only) — climbs to root, returns all descendants minus self |
| `/org/<slug>/…` routes, `useScopedHref` | `/subaccount/<slug>/…`, `useSubaccountHref` |
| Agency "Organizations" settings tab | Parent Account selector in **Settings → Account** |
| `{ mode: 'org' }`, `isOrg` | `isGroup` (an Account with children) |

Deleted: `services/organizations.ts`, `api/organizations/`, `app/org/`,
`settings/organizations/`, `organizations-tab.tsx`,
`organization-settings-tab.tsx`, `canAccessOrg`,
`scripts/promote-account-to-org.ts`,
`scripts/migrate-orgs-to-account-hierarchy.ts`.

The only survivor is `ORG_PREFIX` / `parseOrgValue` in
`src/lib/active-account.ts`. The shared `loomi-active-account` cookie used to
store `org:<id>`; `account-context.tsx` recognises that stale value and falls
back to the role default instead of reading it as an account key. Keep it until
the cookies have aged out.

---

## Per-environment steps (still required)

1. **`npx prisma db push`** — drops the `Organization` table, the
   `organizationId` columns on `Account`/`Template`/`Form`/`LandingPage`/
   `AdTemplateDoc`, and `User.orgKeys`.

   Run from the app directory, and strip `?uselibpqcompat`/`?schema=public`
   from `DATABASE_URL` if you also plan to hand the URL to `psql`.

2. **Everyone logs out and back in.** Account grants are computed when the JWT
   is built, so a session minted before the change still carries the old shape.

3. **Confirm `parentAccountKey` is populated** before trusting any roll-up —
   an empty hierarchy silently reads as "no children":

   ```sql
   SELECT "parentAccountKey", COUNT(*) FROM "Account" GROUP BY 1 ORDER BY 2 DESC;
   ```

   Production expects 40 rooftops under `youngAutomotiveGroup`.

---

## The one trap that outlived the model

Suppression is a **compliance** path, not a convenience. An opt-out on one
rooftop must cascade to every account grouped with it.

`getRelatedAccountKeys` (in `services/accounts.ts`) is what does that, and it is
consumed by `api/contacts/[contactId]/suppression`, `sending/sendgrid-events.ts`
and `sending/twilio-events.ts`. It now walks the hierarchy only — so if
`parentAccountKey` is not set, the cascade silently narrows to a single account.
That is the failure mode to watch for, and step 3 above is what rules it out.
