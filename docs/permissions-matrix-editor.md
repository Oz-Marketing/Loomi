# Editable permission matrix

A UI for a super admin or developer to see and change exactly what each sector
role can do — and, crucially, to see whether that answer is actually being
enforced.

This is a spec. Nothing here is built yet except the audit in §1, which is a
statement of what the code does today.

---

## 1. Where things stand

The permission system is further along than it looks from the UI. What is
missing is not the model — it is the **matrix being data**, and the **UI telling
the truth about enforcement**.

### 1.1 Three layers, one of them editable

| Layer | Lives in | Editable today |
| --- | --- | --- |
| Which permissions exist (`PERMISSIONS`, 79 keys) | `permissions/registry.ts` | No — code |
| Which roles exist per sector (`SECTOR_ROLES`, 15 roles across 4 sectors) | `permissions/registry.ts` | No — code |
| **What each role can do (`ROLE_PERMISSIONS`)** | `permissions/registry.ts` | **No — code** |
| Which role a user holds per sector | `UserSectorRole` | Yes — Settings → Users |
| Per-user capability allow/deny, optionally per account | `UserCapabilityGrant` | Yes — Settings → Users |

So today you can say "Casey is a Studio Lead". You cannot say "Studio Leads may
publish campaigns" without a deploy.

### 1.2 Server enforcement is mostly wired; the flags are off

- **164 of 244** guarded API routes already call `requirePermission(...)`.
- `SECTOR_ENFORCEMENT` gates each sector behind `PERMISSIONS_ENFORCE_<SECTOR>`.
- **No flag is currently set in any environment.** Every sector therefore falls
  back to `legacyCan` — the old role buckets.

This is the single most important fact for planning. The matrix already governs
two-thirds of the API surface *the moment a flag flips*. Editing the matrix
before flipping anything changes nothing; editing it after flipping changes a
lot. The editor must make that distinction visible or it will mislead.

### 1.3 The UI is still on legacy role strings

**32 legacy checks across 25 components**, of the form:

```ts
userRole === 'developer' || userRole === 'super_admin' || userRole === 'admin'
```

`app/settings`, `components/sidebar.tsx`, `components/route-guard.tsx`,
`ad-generator/*`, `contacts/*`, `templates`, `flows`, `media`, `changelog`,
`accounts-list`, `users-tab`, and others.

This is the class of bug that prompted this work: `studio.lead` holds
`studio.templates.edit` in the matrix, but the ad-template page asked the legacy
string, so a Studio Lead was told they were not authorized for a page their role
grants.

### 1.4 A trap the UI must not fall into

`hasPermission` / `requirePermission` consult `SECTOR_ENFORCEMENT`, which reads
`process.env.PERMISSIONS_ENFORCE_*`. Those are **not** `NEXT_PUBLIC_`, so in the
browser they are all `undefined` → every sector reads as unenforced → the check
silently falls back to legacy buckets.

A UI gate built on the enforcement-aware helper would therefore keep hiding a
tab from the role that was just granted it. `permissions/client.ts` exists for
this reason and answers a deliberately narrower question — "does this user's
assigned role include this permission, per the matrix?" — with no enforcement
flag and no legacy fallback. It is for **widening** a gate only, never a sole
guard.

The permanent fix is §5.3: resolve on the server and hand the client the
answer, so one evaluation serves both.

### 1.5 Nine permissions have no teeth

Defined in the matrix, referenced by no guard anywhere:

```
agency.access                            projects.access
agency.contact_field_blueprints.manage   projects.task.assign_any
studio.assets.manage                     projects.pacing.view
studio.landing_pages.publish             projects.pacing.edit
                                         projects.teams.manage
```

`studio.access` and `reporting.access` *are* referenced, so the two unreferenced
`.access` keys are an inconsistency rather than a design choice. An editor that
lets someone toggle these would be offering a switch wired to nothing — §6 is
about not doing that.

### 1.6 What is already good and must be preserved

- **Deny always wins**, including over a sector role.
- **Account-scoped grants** stay separate from global ones, so a grant limited to
  one rooftop cannot silently widen.
- **`canTierHoldRole`** drops a role the tier may not hold, so a stale row from
  before a downgrade cannot keep conferring access.
- **`sectorRoles: undefined` ≠ `[]`** — the first is a pre-field token, the
  second is a deliberate revocation. Collapsing them would make "No access"
  grant the legacy default set.
- **Audit** already records `grant | revoke | role_change | use | bypass`.
- **`developer` is break-glass** and resolves to every permission, with the
  bypass audit-logged.

---

## 2. What "editable" must and must not mean

**In scope**

- Change which permissions a built-in role holds.
- Create custom roles within a sector.
- See, per permission, whether a guard enforces it and whether its sector is
  switched on.
- Preview the effect of a change before saving, and audit it after.

**Deliberately out of scope**

- **Inventing permissions in the UI.** A permission is a contract with a guard
  call site. A row nobody checks is worse than no row: it reads as protection
  that does not exist. `PERMISSIONS` stays in code.
- **Editing the sector list.** Sectors are the surfaces of the product.
- **Per-user overrides.** That already exists as `UserCapabilityGrant`; a second
  mechanism would create two answers to the same question.
- **Editing `agency.owner`.** See §6.1.

---

## 3. Data model

`PERMISSIONS` and `SECTORS` stay in code. Roles and their contents move to the
database, seeded from today's `ROLE_PERMISSIONS`.

```prisma
model SectorRoleDef {
  id       String  @id @default(cuid())
  sector   String  // agency | studio | reporting | projects
  key      String  // lead | producer | designer | ...
  label    String
  // Registry order drives display order and "most privileged first".
  rank     Int
  // Built-ins cannot be deleted or renamed; their permissions can be edited
  // (except agency.owner — see §6.1). Custom roles are fully editable.
  builtIn  Boolean @default(false)
  // Soft delete: a role with assignments must not vanish out from under them.
  archived Boolean @default(false)

  permissions SectorRolePermission[]

  @@unique([sector, key])
  @@index([sector, archived])
}

model SectorRolePermission {
  id         String        @id @default(cuid())
  roleId     String
  role       SectorRoleDef @relation(fields: [roleId], references: [id], onDelete: Cascade)
  // A key from PERMISSIONS. Validated on write against the code catalog — an
  // unknown key is rejected, not stored, so the table can never drift ahead of
  // the guards.
  permission String

  @@unique([roleId, permission])
  @@index([permission])
}

// One row, bumped on every matrix write. The resolution cache keys on it, so a
// change propagates without a per-request read of the whole matrix (§5.2).
model PermissionMatrixVersion {
  id        Int      @id @default(1)
  version   Int      @default(1)
  updatedAt DateTime @updatedAt
}
```

`UserSectorRole.role` already stores a plain string, so custom roles need **no
change to assignment**. Its comment ("valid values depend on the sector — see
SECTOR_ROLES") becomes "see `SectorRoleDef`".

### 3.1 Validation on write

- `permission` ∈ `PERMISSIONS` (code catalog) or reject.
- `sector` ∈ `SECTORS` or reject.
- A custom role key must not collide with a built-in in the same sector.
- A role may only hold permissions whose `governingSector` matches its own
  sector, **or** a cross-sector sensitive capability (`finance.*`, `blast.send`,
  `contacts.pii.export`, `user.impersonate`). Without this rule a Studio role
  could be handed `agency.platform.configure`.

---

## 4. Resolution and caching

`resolvePermissions(subject)` currently reads the code literal. It becomes a
lookup against the DB-backed matrix.

**The constraint:** `subject.sectorRoles` rides the JWT and refreshes on a
five-minute cycle. Two options, and only one is honest:

- **Put resolved permissions on the JWT.** Fast, but a matrix edit takes up to
  five minutes to take effect and the token grows with every permission. Worse,
  revoking a permission would stay ineffective for five minutes — unacceptable
  for a security control.
- **Resolve per request from a cached matrix.** ✅ The matrix is small (15 roles ×
  79 permissions). Hold it in a module-level cache, revalidate against
  `PermissionMatrixVersion.version`. Role *assignments* keep riding the JWT as
  today; only the role → permission mapping is looked up.

With option 2 a revocation is effective on the next request. The cache check is
a single-row read, and can be skipped entirely within a short TTL (~10s) if that
read ever shows up in a profile.

**Fallback:** if the matrix table is empty or unreachable, fall back to the code
literal rather than to "no permissions". A database blip must not lock everyone
out of Loomi. Log loudly when this happens.

---

## 5. The UI

Agency Settings → **Permissions**, gated on `agency.platform.configure` plus
`super_admin`/`developer` tier.

### 5.1 The matrix view

Sector tabs. Rows are permissions grouped by resource; columns are that sector's
roles. A cell is a checkbox.

Each permission row also carries an **enforcement column**, which is the point
of the whole screen:

| State | Meaning |
| --- | --- |
| **Enforced** | A guard checks it and the sector flag is on. Editing takes effect. |
| **Wired, not switched on** | A guard checks it; the sector flag is off, so legacy buckets still decide. Editing has no effect yet. |
| **Not wired** | No guard anywhere (§1.5). The checkbox is inert — shown, disabled, labelled. |

Computing that honestly requires knowing the guard call sites. Do it as a
**build-time scan** that greps `requirePermission` / `hasPermission` /
`roleGrants` / `reports.ts` for permission literals and emits a generated map.
A test asserts the generated map is current, so a new guard cannot land without
the matrix screen knowing about it.

Without this column the screen is a lie: someone ticks a box, nothing changes,
and they conclude permissions are broken.

### 5.2 Editing

- Ticking a box stages a change; nothing writes until **Save**.
- Save shows a diff — role, permission, direction — and the **number of users
  affected** per change, since that is the blast radius.
- Removing a permission that is currently `Enforced` warns; removing one that is
  `Not wired` explains it changes nothing.
- Every write records an audit entry (new kind: `matrix_change`) with actor,
  role, permission, direction, and the version it produced.

### 5.3 Fixing the client gate properly

`permissions/client.ts` is a stopgap. The permanent shape:

- The server resolves the acting user's permission set once (it already does, per
  request) and exposes it to the client — a `permissions: string[]` on the
  session, or a small context provider fed by the layout.
- UI gates read that set. One evaluation, one answer, enforcement flags included,
  no `NEXT_PUBLIC_` leak.
- The 32 legacy UI checks migrate to it.

This is what makes the matrix screen trustworthy: after it, the UI and the server
agree by construction rather than by two parallel implementations.

---

## 6. Safety invariants

### 6.1 You cannot lock yourself out

- **`agency.owner` is immutable.** Its permission set is fixed in code and the
  editor renders it read-only. It is the recovery path.
- A save is rejected if it would leave **zero non-archived roles holding
  `agency.platform.configure`**.
- A save is rejected if it would remove `agency.platform.configure` from the
  **acting user's own** effective set. Losing the ability to undo your last
  change is the one mistake with no in-app remedy.
- `developer` tier remains break-glass, bypassing the matrix with an audited
  bypass.

### 6.2 Widening is the dangerous direction

The existing code is careful about this and the editor must match: creating and
deleting users is elevated today, which is why `agency.admin` deliberately lacks
`users.manage`. An editor that lets someone tick `agency.users.manage` onto a
broad role should surface that it is a **sensitive capability** (the registry
already marks these) and require a typed confirmation.

### 6.3 Archiving, not deleting

A role with live assignments cannot be deleted. Archiving hides it from
assignment while existing holders keep resolving — and the screen shows the
holder count so the operator can reassign first.

### 6.4 Tier bounds still apply

`canTierHoldRole` runs after matrix resolution, unchanged. A custom Reporting
role is assignable to a client tier only if it is on the client-eligible list; a
custom Studio role never is.

---

## 7. Migration plan

Each phase is independently shippable and independently revertable.

**Phase 0 — read-only viewer.** The matrix screen from §5.1 without editing,
reading the code literal, including the enforcement column and the build-time
guard scan. Delivers the thing that was actually asked for — *"get into a page
and check whether that tab should be available for the role"* — with zero risk,
and surfaces the §1.3 and §1.5 mismatches as a work list.

**Phase 1 — client-side truth (§5.3).** Server-resolved permissions to the
client; migrate the 32 legacy UI guards. Behavior-neutral while flags are off,
because resolution falls back to legacy. This is what actually fixes the class of
bug you hit, rather than one page at a time.

**Phase 2 — matrix to the database.** Add the tables, seed from the code literal,
switch `resolvePermissions` to the cached DB read, keep the literal as fallback.
Still read-only in the UI. A test asserts the seeded matrix is byte-identical to
the code literal, so this phase provably changes nothing.

**Phase 3 — editing built-in roles.** The write path, diff-and-confirm, audit,
and the §6 invariants.

**Phase 4 — custom roles.** Role CRUD, archiving, holder counts.

**Phase 5 — flip enforcement, sector by sector.** Projects → Studio → Agency →
Reporting, the order already documented in `require.ts`. Reporting last: it is
the only sector clients enter, so it is the only one where a mistake is
externally visible.

Wire the §1.5 nine either to a guard or out of the matrix during Phase 0–1,
before anyone can toggle them.

---

## 8. Decisions needed

1. **Does Phase 0 alone answer the need?** A viewer with the enforcement column
   tells you whether a tab *should* be available and why it is not. If that is
   the actual day-to-day need, Phases 2–4 may not be worth the surface area.
2. **Custom roles — real requirement or nice-to-have?** They are most of the
   cost of Phase 4 (CRUD, archiving, reassignment). If the built-in 15 are
   adequate, skipping it removes a lot of edge cases.
3. **The nine unenforced permissions** — wire each to a guard, or delete it?
   `projects.pacing.*` and `projects.teams.manage` look like intended features;
   `agency.access` / `projects.access` look like oversights.
4. **Who may edit?** `super_admin` + `developer`, or `agency.owner` too? The
   answer decides whether the editor can be reached without a developer.
5. **When do the enforcement flags flip?** The matrix is inert until they do.
   Phase 5 could reasonably run before Phase 3 — enforcing the *current* matrix
   is a bigger win than being able to edit an unenforced one.

---

## 9. Risks

- **Editing an unenforced matrix.** The top risk, and the enforcement column is
  the whole mitigation. Without it, Phase 3 ships a screen that appears to
  control access and does not.
- **Two sources of truth during Phase 2.** Mitigated by the byte-identical seed
  test and the code-literal fallback.
- **Cache staleness on revocation.** Mitigated by versioning; do not let a TTL
  exceed ~10s for a security control.
- **Scan drift.** A new guard whose permission the generated map does not know
  shows as "not wired" and reads as a bug. Mitigated by the currency test.
- **Widening by accident.** Sensitive-capability confirmation, plus the audit
  trail, plus the diff showing affected user counts.
