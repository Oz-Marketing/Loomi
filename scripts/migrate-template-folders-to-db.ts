/**
 * One-off migration: import legacy esp-template-folders.json (file-based
 * store) into the new Postgres-backed EspTemplateFolder + EspTemplate.folderId
 * schema.
 *
 * Idempotent: a folder whose accountKey + remoteId already exists in DB is
 * left alone. A folder without a remoteId is matched by (accountKey, name,
 * parentId) to avoid duplicates on re-runs. Template assignments are applied
 * via EspTemplate.folderId.
 *
 * Usage (from the active release dir on the droplet):
 *   set -a; source .env.local; set +a
 *   npx tsx scripts/migrate-template-folders-to-db.ts <path-to-json>            # dry run
 *   npx tsx scripts/migrate-template-folders-to-db.ts <path-to-json> --confirm  # write
 *
 * Where <path-to-json> points at the legacy file, e.g.
 *   /var/www/loomi-studio/releases/<old-release-id>/src/data/esp-template-folders.json
 * If the old release dir is gone, pass any saved backup of that JSON.
 */

import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

interface LegacyFolder {
  id: string;
  accountKey: string;
  name: string;
  parentId: string | null;
  remoteId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface LegacyStore {
  folders: LegacyFolder[];
  assignments: Record<string, Record<string, string>>;
}

function parseStore(raw: unknown): LegacyStore {
  const empty: LegacyStore = { folders: [], assignments: {} };
  if (!raw || typeof raw !== 'object') return empty;
  const src = raw as Partial<LegacyStore>;
  return {
    folders: Array.isArray(src.folders) ? src.folders : [],
    assignments: src.assignments && typeof src.assignments === 'object' ? src.assignments : {},
  };
}

async function main() {
  const jsonPath = process.argv[2];
  const confirm = process.argv.includes('--confirm');

  if (!jsonPath) {
    console.error('Usage: npx tsx scripts/migrate-template-folders-to-db.ts <path-to-json> [--confirm]');
    process.exit(1);
  }
  if (!fs.existsSync(jsonPath)) {
    console.error(`File not found: ${jsonPath}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const store = parseStore(raw);
  const mode = confirm ? 'LIVE' : 'DRY RUN';
  console.log(`\n[${mode}] Migrating folder store from ${jsonPath}\n`);
  console.log(`Folders: ${store.folders.length}`);
  const assignmentCount = Object.values(store.assignments).reduce((acc, m) => acc + Object.keys(m || {}).length, 0);
  console.log(`Assignments: ${assignmentCount}\n`);

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  // Map legacy folder.id (the JSON-store ID) → new DB folder.id (cuid). We
  // need this so we can translate template assignments which reference the
  // legacy IDs.
  const legacyIdToDbId = new Map<string, string>();
  let foldersCreated = 0;
  let foldersMatched = 0;
  let parentLinksSet = 0;
  let templatesAssigned = 0;
  let templatesMissing = 0;

  // Pass 1: ensure every legacy folder has a DB row (match by remoteId when
  // present, otherwise by (accountKey, name, parentId=null) to avoid dupes).
  for (const f of store.folders) {
    let dbFolder = null as null | { id: string };
    if (f.remoteId) {
      dbFolder = await prisma.espTemplateFolder.findFirst({
        where: { accountKey: f.accountKey, remoteId: f.remoteId },
        select: { id: true },
      });
    }
    if (!dbFolder) {
      dbFolder = await prisma.espTemplateFolder.findFirst({
        where: {
          accountKey: f.accountKey,
          name: f.name,
          parentId: null,
          remoteId: f.remoteId ?? null,
        },
        select: { id: true },
      });
    }
    if (dbFolder) {
      legacyIdToDbId.set(f.id, dbFolder.id);
      foldersMatched++;
      console.log(`[match] ${f.accountKey} / ${f.name}${f.remoteId ? ` (remote=${f.remoteId})` : ''} → ${dbFolder.id}`);
      continue;
    }

    console.log(`[create] ${f.accountKey} / ${f.name}${f.remoteId ? ` (remote=${f.remoteId})` : ''}`);
    if (confirm) {
      const created = await prisma.espTemplateFolder.create({
        data: {
          accountKey: f.accountKey,
          name: f.name,
          parentId: null,           // resolved in pass 2
          remoteId: f.remoteId ?? null,
        },
        select: { id: true },
      });
      legacyIdToDbId.set(f.id, created.id);
      foldersCreated++;
    } else {
      // For dry-run continuity, fake a placeholder ID so pass-2/pass-3 logging works.
      legacyIdToDbId.set(f.id, `would-create:${f.id}`);
    }
  }

  // Pass 2: link parents
  for (const f of store.folders) {
    if (!f.parentId) continue;
    const childDb = legacyIdToDbId.get(f.id);
    const parentDb = legacyIdToDbId.get(f.parentId);
    if (!childDb || !parentDb) continue;
    console.log(`[link]  ${f.name} parent → ${f.parentId}`);
    if (confirm && !childDb.startsWith('would-create:') && !parentDb.startsWith('would-create:')) {
      await prisma.espTemplateFolder.update({
        where: { id: childDb },
        data: { parentId: parentDb },
      });
      parentLinksSet++;
    }
  }

  // Pass 3: template assignments
  for (const [accountKey, accountAssignments] of Object.entries(store.assignments || {})) {
    for (const [templateId, legacyFolderId] of Object.entries(accountAssignments || {})) {
      const dbFolderId = legacyIdToDbId.get(legacyFolderId);
      if (!dbFolderId || dbFolderId.startsWith('would-create:')) {
        if (!confirm && legacyIdToDbId.has(legacyFolderId)) {
          // dry-run with placeholder — pretend the assignment would happen
          console.log(`[assign] (dry) ${accountKey} / template ${templateId} → folder ${legacyFolderId}`);
        } else {
          console.log(`[skip]   ${accountKey} / template ${templateId} — folder ${legacyFolderId} not found in DB`);
        }
        continue;
      }
      const template = await prisma.espTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, accountKey: true },
      });
      if (!template) {
        console.log(`[skip]   template ${templateId} not found in DB (would assign to folder ${legacyFolderId})`);
        templatesMissing++;
        continue;
      }
      if (template.accountKey !== accountKey) {
        console.log(`[skip]   template ${templateId} belongs to ${template.accountKey}, not ${accountKey}`);
        templatesMissing++;
        continue;
      }
      console.log(`[assign] ${accountKey} / template ${templateId} → folder ${dbFolderId}`);
      if (confirm) {
        await prisma.espTemplate.update({
          where: { id: templateId },
          data: { folderId: dbFolderId },
        });
        templatesAssigned++;
      }
    }
  }

  console.log(`\nDone. created=${foldersCreated} matched=${foldersMatched} parentLinks=${parentLinksSet} templatesAssigned=${templatesAssigned} templatesMissing=${templatesMissing}`);
  if (!confirm) console.log('(dry run — re-run with --confirm to write to DB)');

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
