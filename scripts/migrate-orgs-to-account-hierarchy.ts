/**
 * Organization → Account-hierarchy migration.
 *
 * Why: a group like Young Automotive Group is BOTH a marketing entity (sends
 * its own email/SMS/ads) and a parent that rolls up rooftops. The Organization
 * model only covers the second half, so the UI fakes the first by pointing
 * `primaryAccountKey` at one of the org's own children — which is what makes
 * the sidebar say "Demo Account 001 (house account)". Modelling the group as
 * its own Account with `children` collapses the two concepts into one.
 *
 * For each Organization this resolves a PARENT account, then plans:
 *   1. children  → set Account.parentAccountKey = parent.key
 *   2. org-owned Templates / Forms / LandingPages → reassign to the parent
 *
 * Parent resolution, in order:
 *   a. an Account whose key already equals the org key   (ideal — no new rows)
 *   b. the org's primaryAccountKey account               (promote the house account)
 *   c. none                                              → flagged, needs a decision
 *
 * DRY RUN BY DEFAULT. Pass --apply to write. Idempotent either way.
 *
 *   npx tsx scripts/migrate-orgs-to-account-hierarchy.ts
 *   npx tsx scripts/migrate-orgs-to-account-hierarchy.ts --apply
 */
import 'dotenv/config';
import { prisma } from '@/lib/prisma';

const APPLY = process.argv.includes('--apply');

type Plan = {
  org: string;
  orgName: string;
  parentKey: string | null;
  parentVia: 'same-key' | 'primary-account' | 'none';
  children: string[];
  alreadyLinked: string[];
  templates: number;
  forms: number;
  landingPages: number;
  warnings: string[];
};

async function main() {
  const orgs = await prisma.organization.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, key: true, name: true, slug: true, primaryAccountKey: true },
  });

  if (orgs.length === 0) {
    console.log('No organizations found — nothing to migrate.');
    return;
  }

  const plans: Plan[] = [];

  for (const org of orgs) {
    const warnings: string[] = [];

    const members = await prisma.account.findMany({
      where: { organizationId: org.id },
      select: { key: true, dealer: true, parentAccountKey: true },
      orderBy: { dealer: 'asc' },
    });

    // (a) an account already carrying the org's key is the natural parent.
    const sameKey = await prisma.account.findUnique({
      where: { key: org.key },
      select: { key: true, organizationId: true },
    });

    let parentKey: string | null = null;
    let parentVia: Plan['parentVia'] = 'none';

    if (sameKey) {
      parentKey = sameKey.key;
      parentVia = 'same-key';
      if (sameKey.organizationId && sameKey.organizationId !== org.id) {
        warnings.push(`account "${sameKey.key}" belongs to a different organization`);
      }
    } else if (org.primaryAccountKey) {
      const primary = await prisma.account.findUnique({
        where: { key: org.primaryAccountKey },
        select: { key: true },
      });
      if (primary) {
        parentKey = primary.key;
        parentVia = 'primary-account';
        warnings.push(
          `no account keyed "${org.key}" — promoting house account "${primary.key}" to parent`,
        );
      } else {
        warnings.push(`primaryAccountKey "${org.primaryAccountKey}" does not resolve to an account`);
      }
    }

    if (!parentKey) {
      warnings.push('NEEDS DECISION: no parent account could be resolved');
    }

    // Children = org members minus the parent itself (an account can't parent itself).
    const candidates = members.filter((m) => m.key !== parentKey);
    const children = candidates.filter((m) => m.parentAccountKey !== parentKey).map((m) => m.key);
    const alreadyLinked = candidates
      .filter((m) => m.parentAccountKey === parentKey)
      .map((m) => m.key);

    for (const m of candidates) {
      if (m.parentAccountKey && m.parentAccountKey !== parentKey) {
        warnings.push(`"${m.key}" already parented to "${m.parentAccountKey}" — would be repointed`);
      }
    }

    const [templates, forms, landingPages] = await Promise.all([
      prisma.template.count({ where: { organizationId: org.id } }),
      prisma.form.count({ where: { organizationId: org.id } }),
      prisma.landingPage.count({ where: { organizationId: org.id } }),
    ]);

    plans.push({
      org: org.key,
      orgName: org.name,
      parentKey,
      parentVia,
      children,
      alreadyLinked,
      templates,
      forms,
      landingPages,
      warnings,
    });
  }

  // ── Report ──
  console.log(`\n${APPLY ? 'APPLYING' : 'DRY RUN'} — ${plans.length} organization(s)\n`);
  for (const p of plans) {
    console.log(`━━ ${p.orgName}  (org key: ${p.org})`);
    console.log(
      `   parent account : ${p.parentKey ?? '⚠ UNRESOLVED'}${p.parentKey ? `  [via ${p.parentVia}]` : ''}`,
    );
    console.log(
      `   children       : ${p.children.length ? p.children.join(', ') : '(none to link)'}` +
        (p.alreadyLinked.length ? `   [already linked: ${p.alreadyLinked.length}]` : ''),
    );
    const owned = p.templates + p.forms + p.landingPages;
    console.log(
      `   org-owned      : ${owned === 0 ? 'none' : `${p.templates} template(s), ${p.forms} form(s), ${p.landingPages} landing page(s) → reassign to parent`}`,
    );
    for (const w of p.warnings) console.log(`   ⚠ ${w}`);
    console.log('');
  }

  const unresolved = plans.filter((p) => !p.parentKey);
  if (unresolved.length) {
    console.log(
      `⚠ ${unresolved.length} org(s) have no parent account: ${unresolved.map((p) => p.org).join(', ')}`,
    );
    console.log('  Create an Account for each (or set primaryAccountKey) before applying.\n');
  }

  if (!APPLY) {
    console.log('Dry run only — no writes. Re-run with --apply to execute.\n');
    return;
  }

  // ── Apply ──
  let linked = 0;
  let moved = 0;
  for (const p of plans) {
    if (!p.parentKey) {
      console.log(`skip ${p.org} — unresolved parent`);
      continue;
    }
    for (const childKey of p.children) {
      await prisma.account.update({
        where: { key: childKey },
        data: { parentAccountKey: p.parentKey },
      });
      linked++;
    }
    const org = orgs.find((o) => o.key === p.org)!;
    const reassign = { accountKey: p.parentKey, organizationId: null };
    const [t, f, l] = await Promise.all([
      prisma.template.updateMany({ where: { organizationId: org.id }, data: reassign }),
      prisma.form.updateMany({ where: { organizationId: org.id }, data: reassign }),
      prisma.landingPage.updateMany({ where: { organizationId: org.id }, data: reassign }),
    ]);
    moved += t.count + f.count + l.count;
  }
  console.log(`\nDone. Linked ${linked} child account(s); reassigned ${moved} org-owned record(s).\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
