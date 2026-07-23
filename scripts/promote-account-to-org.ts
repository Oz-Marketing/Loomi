/**
 * Phase 3 — promote a sub-account into an Organization.
 *
 * Built for the Young Automotive Group case: YAG is modelled today as a single
 * sub-account, but it's really the parent of ~20 rooftops. This script creates
 * (or reuses) an Organization, attaches the rooftop sub-accounts to it, lifts
 * the source account's org-worthy resources UP to the org (templates → org-owned
 * so every rooftop inherits them; logos/branding → org brand kit), and grants
 * the source account's users org-level access.
 *
 * SAFETY:
 *   - DRY RUN by default. Nothing is written until you pass --apply.
 *   - Idempotent: re-running applies only the still-missing changes.
 *   - The source account is NOT deleted unless you pass --delete-source.
 *     Deleting an Account cascades to its contacts / campaigns / forms / etc.,
 *     so retirement defaults to "detach + leave in place". Prefer promoting the
 *     org-worthy data up (which this does) and retiring the shell manually once
 *     you've confirmed nothing rooftop-level is lost.
 *
 * Usage:
 *   npx tsx scripts/promote-account-to-org.ts \
 *     --source=youngAutomotive \
 *     --org-name="Young Automotive Group" \
 *     --org-key=youngAutomotiveGroup \
 *     --children=youngHondaOgden,youngFordSlc,youngKiaLayton \
 *     [--apply] [--delete-source] [--strip-source-grant]
 */
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0]);

// ── arg parsing ──
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : 'true';
}
const APPLY = Boolean(arg('apply'));
const DELETE_SOURCE = Boolean(arg('delete-source'));
const STRIP_SOURCE_GRANT = Boolean(arg('strip-source-grant'));
const tag = APPLY ? '[apply]' : '[dry-run]';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function camelKey(s: string): string {
  const w = s.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  return w.map((x, i) => (i === 0 ? x.toLowerCase() : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())).join('');
}
function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

async function uniqueOrgSlug(base: string): Promise<string> {
  let candidate = base || 'organization';
  let n = 2;
  while (await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

async function main() {
  const sourceKey = arg('source');
  if (!sourceKey) throw new Error('Missing --source=<accountKey>');

  const source = await prisma.account.findUnique({
    where: { key: sourceKey },
    select: { key: true, dealer: true, logos: true, branding: true, organizationId: true },
  });
  if (!source) throw new Error(`Source account "${sourceKey}" not found`);

  const orgName = arg('org-name') || source.dealer;
  const orgKey = arg('org-key') || camelKey(orgName) || `${sourceKey}Org`;
  const childKeys = (arg('children') || '').split(',').map((s) => s.trim()).filter(Boolean);

  console.log(`\n${tag} Promote "${sourceKey}" (${source.dealer}) → org "${orgName}" [${orgKey}]`);
  console.log(`${tag} Rooftops to attach: ${childKeys.length ? childKeys.join(', ') : '(none)'}\n`);

  // ── 1. Create or reuse the organization ──
  let org = await prisma.organization.findUnique({ where: { key: orgKey } });
  if (org) {
    console.log(`  • Org "${orgKey}" already exists (${org.id}) — reusing.`);
  } else if (APPLY) {
    const slug = await uniqueOrgSlug(slugify(orgName));
    org = await prisma.organization.create({
      data: {
        key: orgKey,
        name: orgName,
        slug,
        logos: source.logos ?? undefined,
        branding: source.branding ?? undefined,
      },
    });
    console.log(`  • Created org ${org.id} (slug=${slug}) with source branding.`);
  } else {
    console.log(`  • Would CREATE org "${orgKey}" (name="${orgName}") with source logos/branding.`);
  }

  // ── 2. Attach rooftops ──
  if (childKeys.length) {
    const existing = await prisma.account.findMany({
      where: { key: { in: childKeys } },
      select: { key: true, organizationId: true },
    });
    const found = new Set(existing.map((a) => a.key));
    const missing = childKeys.filter((k) => !found.has(k));
    if (missing.length) console.log(`  ! Skipping unknown rooftop keys: ${missing.join(', ')}`);
    const toAttach = existing.filter((a) => a.organizationId !== org?.id);
    console.log(`  • Attach ${toAttach.length}/${existing.length} rooftops (rest already attached).`);
    if (APPLY && org && toAttach.length) {
      await prisma.account.updateMany({
        where: { key: { in: toAttach.map((a) => a.key) } },
        data: { organizationId: org.id },
      });
    }
  }

  // ── 3. Promote source templates to org-owned (inherited by all rooftops) ──
  const srcTemplates = await prisma.template.findMany({
    where: { accountKey: sourceKey },
    select: { id: true, slug: true },
  });
  console.log(`  • Promote ${srcTemplates.length} source template(s) → org-owned.`);
  if (APPLY && org && srcTemplates.length) {
    await prisma.template.updateMany({
      where: { accountKey: sourceKey },
      data: { accountKey: null, organizationId: org.id },
    });
  }

  // ── 4. Org brand kit from source (only if org lacks it) ──
  if (org && APPLY) {
    const patch: { logos?: string; branding?: string } = {};
    if (!org.logos && source.logos) patch.logos = source.logos;
    if (!org.branding && source.branding) patch.branding = source.branding;
    if (Object.keys(patch).length) {
      await prisma.organization.update({ where: { id: org.id }, data: patch });
      console.log(`  • Copied ${Object.keys(patch).join(' + ')} to org brand kit.`);
    }
  } else if (!org) {
    console.log(`  • Would copy source logos/branding to org brand kit.`);
  }

  // ── 5. Grant org access to the source account's users ──
  const users = await prisma.user.findMany({ select: { id: true, email: true, accountKeys: true, orgKeys: true } });
  let granted = 0;
  for (const u of users) {
    const accountKeys = parseJsonArray(u.accountKeys);
    if (!accountKeys.includes(sourceKey)) continue;
    const orgKeys = parseJsonArray(u.orgKeys);
    const nextOrgKeys = orgKeys.includes(orgKey) ? orgKeys : [...orgKeys, orgKey];
    const nextAccountKeys = STRIP_SOURCE_GRANT ? accountKeys.filter((k) => k !== sourceKey) : accountKeys;
    const changed = nextOrgKeys.length !== orgKeys.length || nextAccountKeys.length !== accountKeys.length;
    if (!changed) continue;
    granted++;
    if (APPLY) {
      await prisma.user.update({
        where: { id: u.id },
        data: { orgKeys: JSON.stringify(nextOrgKeys), accountKeys: JSON.stringify(nextAccountKeys) },
      });
    }
    console.log(`  • Grant ${u.email} org "${orgKey}"${STRIP_SOURCE_GRANT ? ' (and strip source grant)' : ''}.`);
  }
  if (!granted) console.log(`  • No users needed an org grant.`);

  // ── 6. Retire the source account ──
  if (DELETE_SOURCE) {
    console.log(`\n  ⚠️  --delete-source: this HARD-DELETES "${sourceKey}" and CASCADES to its`);
    console.log(`     contacts / campaigns / forms / suppressions. Ensure org-worthy data is`);
    console.log(`     promoted (above) and nothing rooftop-level lives on the source first.`);
    if (APPLY) {
      await prisma.account.delete({ where: { key: sourceKey } });
      console.log(`     Deleted source account "${sourceKey}".`);
    } else {
      console.log(`     Would DELETE source account "${sourceKey}".`);
    }
  } else {
    console.log(`\n  • Source account "${sourceKey}" left in place (pass --delete-source to retire it).`);
    if (source.organizationId && APPLY) {
      await prisma.account.update({ where: { key: sourceKey }, data: { organizationId: null } });
      console.log(`     Detached source from any org (it should not be its own child).`);
    }
  }

  console.log(`\n${tag} Done.${APPLY ? '' : ' Re-run with --apply to write these changes.'}\n`);
}

main()
  .catch((e) => {
    console.error('[promote-account-to-org] failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
