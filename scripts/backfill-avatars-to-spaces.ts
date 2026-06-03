/**
 * One-time backfill: move user avatars that still live on the local disk
 * (served via /api/avatars/...) up to object storage (DO Spaces), and rewrite
 * User.avatarUrl.
 *
 * Avatars used to be written to data/avatars and survived deploys only via a
 * shared-dir symlink — which won't work on an ephemeral, multi-instance host.
 *
 * Usage:
 *   npx tsx scripts/backfill-avatars-to-spaces.ts <avatarsDir> [--confirm]
 *   e.g. ... /var/www/loomi-studio/shared/avatars --confirm
 *
 * Idempotent: avatarUrls already pointing at Spaces (or external) are skipped.
 * Safe to leave in the deploy pipeline. Non-fatal if S3 is unconfigured.
 */
import fs from 'fs';
import path from 'path';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { uploadToS3, s3PublicUrl, isS3Configured } from '../src/lib/s3';

const LOCAL_PREFIX = '/api/avatars/';
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const avatarsDir = args.find((a) => !a.startsWith('--'));

  if (!avatarsDir) {
    console.error('[backfill-avatars] Usage: backfill-avatars-to-spaces.ts <avatarsDir> [--confirm]');
    process.exit(1);
  }
  if (!isS3Configured()) {
    console.warn('[backfill-avatars] S3 not configured (missing creds/bucket) — skipping. NOT an error.');
    return;
  }

  const users = await prisma.user.findMany({
    where: { avatarUrl: { startsWith: LOCAL_PREFIX } },
    select: { id: true, avatarUrl: true },
  });

  if (users.length === 0) {
    console.log('[backfill-avatars] No users with local avatar URLs — nothing to do.');
    return;
  }
  console.log(`[backfill-avatars] ${users.length} user(s) with local avatars.`);

  let changed = 0;
  for (const user of users) {
    const fileName = user.avatarUrl!.slice(LOCAL_PREFIX.length).split('?')[0];
    const file = path.join(avatarsDir, fileName);
    if (!fs.existsSync(file)) {
      console.warn(`[backfill-avatars]   missing file ${file} for user ${user.id} — leaving as-is`);
      continue;
    }
    const ext = path.extname(file).slice(1).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const s3Key = `avatars/${fileName}`;

    if (!confirm) {
      console.log(`[backfill-avatars]   would upload ${file} → ${s3Key}`);
      continue;
    }

    await uploadToS3(s3Key, fs.readFileSync(file), contentType);
    const avatarUrl = s3PublicUrl(s3Key);
    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl } });
    changed++;
    console.log(`[backfill-avatars] ${user.id}: ${user.avatarUrl} → ${avatarUrl}`);
  }

  if (!confirm) {
    console.log('[backfill-avatars] DRY RUN complete. Pass --confirm to write.');
  } else {
    console.log(`[backfill-avatars] Done. Updated ${changed} user(s).`);
  }
}

main()
  .catch((e) => {
    console.error('[backfill-avatars] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
