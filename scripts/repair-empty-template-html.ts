/**
 * Repair EspTemplate rows whose html field is empty by re-fetching the
 * full template body from GHL via fetchTemplateById.
 *
 * Background: GHL's list endpoint (used by the sync route) returns template
 * metadata only — no HTML body — so any template first discovered via sync
 * ends up with an empty html column. Until the sync CREATE path falls back
 * to fetchTemplateById, this script repairs the existing rows.
 *
 * Usage (from the active release dir on the droplet):
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/repair-empty-template-html.ts                 # dry run
 *   npx tsx scripts/repair-empty-template-html.ts --confirm       # write to DB
 *   npx tsx scripts/repair-empty-template-html.ts --confirm \
 *     --account audiLayton                                        # one account
 */

import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { resolveGhlCredentials } from '../src/lib/esp/adapters/ghl/contacts';
import { fetchTemplateById } from '../src/lib/esp/adapters/ghl/templates';

function arg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const onlyAccount = arg('--account');

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const mode = confirm ? 'LIVE' : 'DRY RUN';
  console.log(`\n[${mode}] Repairing empty-html EspTemplate rows${onlyAccount ? ` for ${onlyAccount}` : ''}\n`);

  const rows = await prisma.espTemplate.findMany({
    where: {
      provider: 'ghl',
      remoteId: { not: null },
      html: '',
      status: { not: 'deleted-local' },
      ...(onlyAccount ? { accountKey: onlyAccount } : {}),
    },
    select: { id: true, accountKey: true, name: true, remoteId: true },
    orderBy: { accountKey: 'asc' },
  });

  console.log(`Found ${rows.length} rows to repair.\n`);
  if (rows.length === 0) {
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  // Resolve credentials once per account
  const credCache = new Map<string, { token: string; locationId: string } | null>();
  async function getCreds(accountKey: string) {
    if (credCache.has(accountKey)) return credCache.get(accountKey)!;
    const creds = await resolveGhlCredentials(accountKey);
    credCache.set(accountKey, creds);
    return creds;
  }

  let repaired = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.remoteId) { skipped++; continue; }
    const creds = await getCreds(row.accountKey);
    if (!creds) {
      console.log(`[skip] ${row.accountKey} — no GHL credentials`);
      skipped++;
      continue;
    }

    try {
      const remote = await fetchTemplateById(creds.token, creds.locationId, row.remoteId);
      if (!remote) {
        console.log(`[skip] ${row.name} — not found on GHL (remoteId=${row.remoteId})`);
        skipped++;
        continue;
      }
      const html = remote.html || '';
      if (html.length === 0) {
        console.log(`[skip] ${row.name} — GHL also returned empty html`);
        skipped++;
        continue;
      }

      console.log(`[fix]  ${row.name} → ${html.length} bytes (account=${row.accountKey})`);
      if (confirm) {
        await prisma.espTemplate.update({
          where: { id: row.id },
          data: { html, lastSyncedAt: new Date() },
        });
        repaired++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[fail] ${row.name} — ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone. repaired=${repaired} skipped=${skipped} failed=${failed}`);
  if (!confirm) console.log('(dry run — re-run with --confirm to write to DB)');

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
