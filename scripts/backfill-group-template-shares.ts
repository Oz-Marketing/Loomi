/**
 * Make a group's implicit reach explicit, once, before it stops working.
 *
 * WHAT CHANGED. `canAccountUseTemplate` used to grant a template to every
 * account beneath its owner: authored at the group, inherited by each rooftop,
 * with nothing stored to say so. That made the Publish modal a liar — a group
 * choosing "self" was in fact publishing to its whole fleet, there was no
 * setting that said so, and no way to take one rooftop back out. Access is now
 * exactly the owner plus the share list.
 *
 * WHAT THAT COSTS WITHOUT THIS. Every group-owned template silently disappears
 * from the accounts beneath it on deploy. The designers did nothing wrong and
 * have no way to know why; the fix is only obvious if you happened to read this
 * changelog entry.
 *
 * So: write down what the old rule was already granting. Each group-owned
 * template gets its descendants added to `sharedAccountKeys`. Nobody's access
 * changes — the same accounts see the same templates — but now it is a fact in
 * a column that a person can look at and revoke.
 *
 * ONCE, AND ONLY ONCE. This lives in `deploy:prepare`, which runs on every
 * deploy, and re-running it would undo real work: a group that deliberately
 * un-shares a rooftop next month would find it re-shared by the next release.
 * "Only rows with an empty list" is not enough of a guard either — "self only"
 * is a legitimate new choice, and it looks identical to a row this never
 * touched. So completion is recorded in `AppSetting`, and a second run reads
 * that and stops.
 *
 * Set-based within a template, and the whole thing is a handful of UPDATEs
 * against a small table. The deploy's SSH step times out at 15 minutes and this
 * repo has been bitten by per-row loops before.
 */

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { expandWithDescendants, type AccountEdge } from '../src/lib/account-hierarchy';
import { parseSharedKeys } from '../src/lib/ad-generator/template-access';

/** Set once this has run. Its presence is the whole re-run guard. */
const DONE_KEY = 'backfill:group-template-shares';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[backfill-group-template-shares] DATABASE_URL unset — skipping');
    return;
  }
  const needsSsl = /[?&]sslmode=require/.test(connectionString);
  const cleanUrl = connectionString
    .replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : ''))
    .replace(/\?$/, '');
  const pool = new pg.Pool({
    connectionString: cleanUrl,
    ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
  });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const done = await prisma.appSetting.findUnique({ where: { key: DONE_KEY } });
    if (done) {
      console.log(`[backfill-group-template-shares] already run on ${done.value} — skipping`);
      return;
    }

    const edges: AccountEdge[] = await prisma.account.findMany({
      select: { key: true, parentAccountKey: true },
    });
    const templates = await prisma.adTemplateDoc.findMany({
      where: { accountKey: { not: null }, deletedAt: null },
      select: { id: true, name: true, accountKey: true, sharedAccountKeys: true },
    });

    let widened = 0;
    let granted = 0;
    for (const t of templates) {
      const owner = t.accountKey!;
      // `expandWithDescendants` returns the owner too; it is granted by
      // ownership, so listing it again in the share column would be noise.
      const descendants = expandWithDescendants(edges, [owner]).filter((k) => k !== owner);
      if (descendants.length === 0) continue; // a leaf account owns it — nothing was inherited

      const current = parseSharedKeys(t.sharedAccountKeys);
      const missing = descendants.filter((k) => !current.includes(k));
      if (missing.length === 0) continue; // already covers its fleet

      const next = [...current, ...missing];
      await prisma.adTemplateDoc.update({
        where: { id: t.id },
        data: { sharedAccountKeys: JSON.stringify(next) },
      });
      widened += 1;
      granted += missing.length;
      console.log(
        `[backfill-group-template-shares] ${t.name} (${owner}): +${missing.length} account(s)`,
      );
    }

    // Written only after every update succeeded, so a crash halfway leaves the
    // marker absent and the next deploy finishes the job — the per-template
    // checks above skip whatever already landed.
    await prisma.appSetting.upsert({
      where: { key: DONE_KEY },
      create: { key: DONE_KEY, value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });

    console.log(
      widened === 0
        ? '[backfill-group-template-shares] no group-owned templates needed widening'
        : `[backfill-group-template-shares] wrote ${granted} grant(s) across ${widened} template(s)`,
    );
  } catch (err) {
    // Never fail the deploy over this. On a fresh environment the tables may not
    // exist yet, and an un-run backfill is self-healing: the marker is only
    // written on success, so the next deploy tries again.
    console.warn('[backfill-group-template-shares] skipped:', err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
