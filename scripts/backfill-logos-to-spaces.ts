/**
 * One-time backfill: move account logos that still live on the local disk
 * (served via /api/logos/...) up to object storage (DO Spaces), and rewrite
 * the stored URLs on each Account.
 *
 * Logo files used to be written to data/logos/<key>/ (lost on every deploy);
 * the committed seed logos live in public/logos/<key>/. This walks every
 * Account's logos JSON + customValues.storefront_image, uploads any local
 * /api/logos URL's backing file to Spaces, and replaces it with the public
 * Spaces URL.
 *
 * Usage:
 *   npx tsx scripts/backfill-logos-to-spaces.ts <logosDir> [publicLogosDir] [--confirm]
 *   e.g. ... /var/www/loomi-studio/current/data/logos /var/www/loomi-studio/current/public/logos --confirm
 *
 * Idempotent: URLs already pointing at Spaces (or external) are skipped. Safe
 * to leave in the deploy pipeline. Non-fatal if S3 is unconfigured.
 */
import fs from 'fs';
import path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { uploadToS3, s3PublicUrl, isS3Configured } from '../src/lib/s3';

const LOCAL_PREFIX = '/api/logos/';
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

let confirm = false;
let logosDir = '';
let publicLogosDir = '';

/** Resolve a /api/logos/<key>/<file> URL to a file on disk, or null. */
function resolveLocalFile(relPath: string): string | null {
  for (const dir of [logosDir, publicLogosDir].filter(Boolean)) {
    const candidate = path.join(dir, relPath);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * If `url` is a local /api/logos URL, upload its file to Spaces and return the
 * new public URL. Otherwise (already Spaces/external/empty) return it unchanged.
 */
async function migrateUrl(url: string | undefined | null): Promise<string | null | undefined> {
  if (!url || !url.startsWith(LOCAL_PREFIX)) return url;
  const relPath = url.slice(LOCAL_PREFIX.length).split('?')[0]; // "<key>/<file>"
  const file = resolveLocalFile(relPath);
  if (!file) {
    console.warn(`[backfill-logos]   missing file for ${url} — leaving as-is`);
    return url;
  }
  const ext = path.extname(file).slice(1).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';
  const s3Key = `logos/${relPath}`;
  if (!confirm) {
    console.log(`[backfill-logos]   would upload ${file} → ${s3Key}`);
    return url;
  }
  await uploadToS3(s3Key, fs.readFileSync(file), contentType);
  const newUrl = s3PublicUrl(s3Key);
  console.log(`[backfill-logos]   ${url} → ${newUrl}`);
  return newUrl;
}

async function main() {
  const args = process.argv.slice(2);
  confirm = args.includes('--confirm');
  const positionals = args.filter((a) => !a.startsWith('--'));
  logosDir = positionals[0] || '';
  publicLogosDir = positionals[1] || '';

  if (!logosDir) {
    console.error('[backfill-logos] Usage: backfill-logos-to-spaces.ts <logosDir> [publicLogosDir] [--confirm]');
    process.exit(1);
  }
  if (!isS3Configured()) {
    console.warn('[backfill-logos] S3 not configured (missing creds/bucket) — skipping. NOT an error.');
    return;
  }

  const accounts = await prisma.account.findMany({
    select: { key: true, logos: true, customValues: true },
  });

  let changed = 0;
  for (const account of accounts) {
    let dirty = false;

    // logos JSON: { light, dark, white?, black? }
    let logos: Record<string, string> = {};
    if (account.logos) {
      try {
        logos = JSON.parse(account.logos);
      } catch {
        logos = {};
      }
    }
    for (const [variant, url] of Object.entries(logos)) {
      const next = await migrateUrl(url);
      if (next !== url) {
        logos[variant] = next as string;
        dirty = true;
      }
    }

    // customValues.storefront_image.value
    let customValues: Record<string, { name?: string; value?: string }> = {};
    if (account.customValues) {
      try {
        customValues = JSON.parse(account.customValues);
      } catch {
        customValues = {};
      }
    }
    const sf = customValues.storefront_image;
    if (sf?.value) {
      const next = await migrateUrl(sf.value);
      if (next !== sf.value) {
        sf.value = next as string;
        dirty = true;
      }
    }

    if (dirty && confirm) {
      await prisma.account.update({
        where: { key: account.key },
        data: { logos: JSON.stringify(logos), customValues: JSON.stringify(customValues) },
      });
      changed++;
      console.log(`[backfill-logos] Updated ${account.key}`);
    } else if (dirty) {
      console.log(`[backfill-logos] (dry run) would update ${account.key}`);
    }
  }

  if (!confirm) {
    console.log('[backfill-logos] DRY RUN complete. Pass --confirm to write.');
  } else {
    console.log(`[backfill-logos] Done. Updated ${changed} account(s).`);
  }
}

main()
  .catch((e) => {
    console.error('[backfill-logos] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
