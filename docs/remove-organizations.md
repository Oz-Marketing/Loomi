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

1. **Nothing manual — the deploy does it.** `scripts/drop-organization-model.ts`
   runs inside `deploy:prepare`, before `prisma db push`.

   It has to run there rather than letting `db push` do it: the guarded push
   refuses to drop a populated column and aborts the whole deploy. Adding
   `--accept-data-loss` would "fix" that by disarming the guard for every
   future schema change, which is why it drops these objects explicitly
   instead. Idempotent, so it stays in the pipeline harmlessly.

   It **refuses to run** if any account was grouped by `organizationId` but has
   no place in the hierarchy — nothing above it and nothing below. That's a
   hard stop, not a warning: dropping then would lose the grouping for good.
   Fix by setting each named account's Organization, then re-deploy.

2. **Re-auth only if the script migrated grants.** Watch this line in the
   deploy log:

   ```
   [drop-organization-model] migrated org grants for N/M user(s)
   ```

   `N > 0` means someone's `accountKeys` changed and those users need to log
   out and back in — grants are computed at JWT build. `0/0` means no user
   actually held an org grant and no re-auth is needed.

   Staging reported `0/0`: the 22 non-null `orgKeys` values were all the `"[]"`
   column default, which is non-null (hence Prisma's warning) but grants
   nothing. Nobody's access depended on the org layer.

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
