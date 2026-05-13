/**
 * One-off: push the 3 Audi Sales New Purchase Introduction emails to GHL
 * for the audiLayton account.
 *
 * Idempotent by template name — if a template with the target name already
 * exists on the location, it is PATCHed with the latest HTML. Otherwise a
 * new template is created.
 *
 * Writes to both GHL and the local Loomi Studio EspTemplate cache so the
 * templates appear in /templates (Audi Layton scope) immediately, without
 * needing a separate sync click.
 *
 * Usage (from repo root):
 *   npx tsx scripts/push-audi-sales-welcome-to-ghl.ts                # dry run
 *   npx tsx scripts/push-audi-sales-welcome-to-ghl.ts --confirm      # actually push
 *
 * Requires DATABASE_URL (and the audiLayton GHL OAuth connection to exist
 * with the emails/builder.write scope authorized).
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  resolveGhlCredentials,
} from '../src/lib/esp/adapters/ghl/contacts';
import {
  createTemplate,
  fetchTemplates,
  updateTemplate,
} from '../src/lib/esp/adapters/ghl/templates';

const ACCOUNT_KEY = 'audiLayton';
const WORKFLOW_PREFIX = 'YAG-001 | Sales — New Purchase Introduction';

const TEMPLATES_ROOT = path.resolve(
  process.cwd(),
  'src',
  'templates',
  'oem-html',
  'audi',
  'sales-welcome-series',
);

interface PushSpec {
  file: string;
  name: string;
  subject: string;
  previewText: string;
}

const SPECS: PushSpec[] = [
  {
    file: '01-welcome-and-next-steps.html',
    name: `${WORKFLOW_PREFIX} | E1 — Welcome and next steps`,
    subject: 'Welcome to Audi, {{contact.first_name}}.',
    previewText:
      'Your journey with the Four Rings begins now. Three steps to get started with your new Audi.',
  },
  {
    file: '02-service-department-intro.html',
    name: `${WORKFLOW_PREFIX} | E2 — Service department intro`,
    subject: 'Meet your Audi Service team.',
    previewText:
      'Audi-certified technicians. Genuine Audi parts. The standard your vehicle was built to receive.',
  },
  {
    file: '03-referral-program.html',
    name: `${WORKFLOW_PREFIX} | E3 — Referral program`,
    subject: 'Share Audi. Be rewarded.',
    previewText:
      'The only thing better than driving an Audi is sharing the experience. Refer a friend, both be rewarded.',
  },
];

function readHtml(file: string): string {
  const full = path.join(TEMPLATES_ROOT, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing template file: ${full}`);
  }
  return fs.readFileSync(full, 'utf8');
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const mode = confirm ? 'LIVE PUSH' : 'DRY RUN';

  console.log(`\n[${mode}] Audi Layton — Sales New Purchase Introduction → GHL\n`);
  console.log(`accountKey: ${ACCOUNT_KEY}`);
  console.log(`templates: ${SPECS.length}\n`);

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const creds = await resolveGhlCredentials(ACCOUNT_KEY);
  if (!creds) {
    console.error(
      `Could not resolve GHL credentials for "${ACCOUNT_KEY}". ` +
        'Make sure the OAuth connection exists and has emails/builder.write scope.',
    );
    process.exit(1);
  }
  console.log(`✓ Resolved GHL credentials. locationId=${creds.locationId}\n`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const existing = await fetchTemplates(creds.token, creds.locationId);
  const byName = new Map(existing.map((t) => [t.name, t]));

  for (const spec of SPECS) {
    const html = readHtml(spec.file);
    const match = byName.get(spec.name);
    const action = match ? 'UPDATE' : 'CREATE';
    console.log(`[${action}] ${spec.name}`);
    console.log(`  file:      ${spec.file}`);
    console.log(`  subject:   ${spec.subject}`);
    console.log(`  preview:   ${spec.previewText.slice(0, 80)}${spec.previewText.length > 80 ? '…' : ''}`);
    console.log(`  bytes:     ${html.length}`);
    if (match) console.log(`  remoteId:  ${match.id}`);

    if (!confirm) {
      console.log('  (dry run — not sent)\n');
      continue;
    }

    try {
      const result = match
        ? await updateTemplate(creds.token, creds.locationId, match.id, {
            name: spec.name,
            html,
            subject: spec.subject,
            previewText: spec.previewText,
          })
        : await createTemplate(creds.token, creds.locationId, {
            name: spec.name,
            html,
            subject: spec.subject,
            previewText: spec.previewText,
          });
      console.log(`  ✓ ${action.toLowerCase()}d on GHL. remoteId=${result.id}`);

      const now = new Date();
      await prisma.espTemplate.upsert({
        where: {
          accountKey_provider_remoteId: {
            accountKey: ACCOUNT_KEY,
            provider: 'ghl',
            remoteId: result.id,
          },
        },
        update: {
          name: spec.name,
          subject: spec.subject,
          previewText: spec.previewText,
          html,
          status: result.status || 'active',
          editorType: result.editorType || 'code',
          thumbnailUrl: result.thumbnailUrl || null,
          lastSyncedAt: now,
        },
        create: {
          accountKey: ACCOUNT_KEY,
          provider: 'ghl',
          remoteId: result.id,
          name: spec.name,
          subject: spec.subject,
          previewText: spec.previewText,
          html,
          status: result.status || 'active',
          editorType: result.editorType || 'code',
          thumbnailUrl: result.thumbnailUrl || null,
          lastSyncedAt: now,
        },
      });
      console.log(`  ✓ upserted into local EspTemplate cache\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${action.toLowerCase()} failed: ${msg}\n`);
    }
  }

  await prisma.$disconnect();
  await pool.end();

  console.log(confirm ? 'Done. Templates are live on GHL and in Loomi Studio.' : 'Dry run complete. Re-run with --confirm to push.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
