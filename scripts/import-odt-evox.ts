/**
 * Backfill ODT's EVOX vehicle cutouts into Loomi media libraries.
 *
 * ODT never stored EVOX images — the Monthly Offers canvas referenced them by a
 * live proxy URL (`/admin/offers/ajax-evox-image?url=<EVOX CloudFront URL>`) and
 * baked the result into each flattened export. `extract-evox.mjs` (local prep)
 * pulls every unique EVOX CloudFront URL out of campaign_media.canvas_json,
 * attributes it to its campaign's org, dedupes per (org, vehicle), and writes
 * evox-backfill.json. This script downloads each (the CloudFront URLs are still
 * public), stores it in the matching dealer's Loomi library as a reusable
 * transparent PNG tagged `evox` + `odt-archive`.
 *
 * DRY-RUN BY DEFAULT — pass --apply to write. Idempotent by deterministic
 * s3Key (per account + EVOX filename), so re-runs skip what's already imported.
 *
 * Run on the droplet (evox-backfill.json must be in <data-dir>):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/import-odt-evox.ts <data-dir> [--apply]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { buildS3Key, isS3Configured, uploadToS3 } from '../src/lib/s3';
import { resolveOrgAccounts } from './_odt-org-map';

interface Backfill {
  items: { orgId: number; orgName: string; evoxUrl: string; file: string }[];
}

/** PNG pixel size from the IHDR chunk; null for non-PNG. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  const dataDir = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!dataDir) throw new Error('usage: import-odt-evox.ts <data-dir> [--apply]');
  if (apply && !isS3Configured()) throw new Error('S3 is not configured in this environment');

  const backfill = JSON.parse(readFileSync(join(dataDir, 'evox-backfill.json'), 'utf8')) as Backfill;

  // org → account: reuse the shared resolver keyed off the orgs present here.
  const orgs = [...new Map(backfill.items.map((i) => [i.orgId, { id: i.orgId, name: i.orgName }])).values()];
  const accounts = await prisma.account.findMany({ select: { key: true, dealer: true } });
  const mapping = resolveOrgAccounts(orgs, accounts);

  const summary = { imported: 0, skippedExisting: 0, skippedUnmatched: 0, fetchFailed: 0 };

  for (const it of backfill.items) {
    const accountKey = mapping.get(it.orgId);
    if (!accountKey) {
      summary.skippedUnmatched++;
      continue;
    }
    // Deterministic key per account + EVOX file → idempotent re-runs.
    const s3Key = buildS3Key(accountKey, `odt-evox-${it.file.replace(/\.[a-z]+$/i, '')}`, it.file);
    const exists = await prisma.mediaAsset.findUnique({ where: { s3Key } });
    if (exists) {
      summary.skippedExisting++;
      continue;
    }
    if (apply) {
      let buf: Buffer;
      try {
        const res = await fetch(it.evoxUrl, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 1).toString('latin1') === '{') throw new Error('non-image');
      } catch (err) {
        console.warn(`  ! fetch failed for ${it.file} (${it.orgName}): ${err instanceof Error ? err.message : 'error'}`);
        summary.fetchFailed++;
        continue;
      }
      const dims = pngSize(buf);
      await uploadToS3(s3Key, buf, 'image/png');
      await prisma.mediaAsset.create({
        data: {
          accountKey,
          s3Key,
          filename: it.file,
          mimeType: 'image/png',
          size: buf.length,
          width: dims?.width ?? null,
          height: dims?.height ?? null,
          category: 'ad-creative',
          tags: JSON.stringify(['evox', 'odt-archive']),
          altText: `EVOX vehicle — ${it.orgName}`,
        },
      });
    }
    summary.imported++;
  }

  console.log('── summary ──');
  console.log(`  mode: ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
  console.log(`  EVOX cutouts ${apply ? 'imported' : 'to import'}: ${summary.imported} (skipped existing: ${summary.skippedExisting}, unmatched org: ${summary.skippedUnmatched}, fetch failed: ${summary.fetchFailed})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
