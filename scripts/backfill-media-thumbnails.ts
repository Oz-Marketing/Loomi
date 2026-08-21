/**
 * Generate the missing thumbnails for library images that never got one.
 *
 * Images uploaded through the direct-to-S3 path (`/api/media/upload-url` +
 * `/api/media/finalize`) never had a thumbnail generated, because the app never
 * holds those bytes. The asset grid then fell back to the ORIGINAL — rendering a
 * megabyte-plus PNG into a 140px tile. Measured on production before writing
 * this: 809 of the 940 images in the library had no thumbnail, 420MB in total,
 * and the largest single image was 5MB.
 *
 * `finalize` now generates one on upload for anything under
 * THUMBNAIL_SOURCE_MAX, so this is for the backlog only. It is idempotent and
 * safe to re-run: it only ever looks at rows where `thumbnailKey` is null.
 *
 *   npx tsx scripts/backfill-media-thumbnails.ts --dry-run   # count and size it
 *   npx tsx scripts/backfill-media-thumbnails.ts             # do it
 *   npx tsx scripts/backfill-media-thumbnails.ts --limit 50  # a slice at a time
 *
 * NOT added to the deploy chain. It reads every object back out of storage, and
 * the deploy's SSH step is capped at 15 minutes — a backfill that grows past
 * that would start failing deploys rather than finishing. Run it by hand, once.
 *
 * Memory: one image at a time, by design. The prod droplet is 2GB/1vCPU with an
 * app process pm2 restarts at 512MB RSS, so a parallel pool over 5MB buffers is
 * a genuinely bad idea here. Sequential and slow is the correct trade.
 */

import { prisma } from '../src/lib/prisma';
import {
  generateThumbnail,
  shouldThumbnailOnFinalize,
  THUMBNAIL_SOURCE_MAX,
} from '../src/lib/media-thumbnails';
import { buildThumbnailKey, downloadFromS3, isS3Configured, uploadToS3 } from '../src/lib/s3';

const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : undefined;

const mb = (n: number) => (n / 1048576).toFixed(2);

async function main() {
  if (!isS3Configured() && !dryRun) {
    throw new Error('Object storage is not configured — nothing to read or write.');
  }

  const candidates = await prisma.mediaAsset.findMany({
    where: { thumbnailKey: null, mimeType: { startsWith: 'image/' } },
    select: { id: true, accountKey: true, s3Key: true, filename: true, mimeType: true, size: true },
    orderBy: { size: 'asc' }, // cheapest first, so a partial run still helps most rows
    ...(limit && Number.isFinite(limit) ? { take: limit } : {}),
  });

  const eligible = candidates.filter((a) => shouldThumbnailOnFinalize(a.mimeType, a.size));
  const skipped = candidates.filter((a) => !shouldThumbnailOnFinalize(a.mimeType, a.size));

  console.log(`\nImages with no thumbnail: ${candidates.length}`);
  console.log(`  eligible:  ${eligible.length}  (${mb(eligible.reduce((s, a) => s + a.size, 0))} MB to read back)`);
  if (skipped.length) {
    console.log(`  skipped:   ${skipped.length}  (over the ${mb(THUMBNAIL_SOURCE_MAX)} MB cap, or not a raster image)`);
    for (const a of skipped.slice(0, 5)) {
      console.log(`     ${a.filename} — ${a.mimeType}, ${mb(a.size)} MB`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return;
  }
  if (eligible.length === 0) {
    console.log('\nNothing to do.\n');
    return;
  }

  let made = 0;
  const failures: { filename: string; reason: string }[] = [];

  for (const [i, asset] of eligible.entries()) {
    const label = `[${i + 1}/${eligible.length}] ${asset.filename}`;
    try {
      const bytes = await downloadFromS3(asset.s3Key);
      const thumb = await generateThumbnail(bytes, asset.mimeType);
      if (!thumb) {
        // sharp could not decode it. A real answer, not an error — record it and
        // move on rather than retrying forever on a corrupt file.
        failures.push({ filename: asset.filename, reason: 'not decodable as an image' });
        console.log(`${label} — skipped, not decodable`);
        continue;
      }
      const thumbnailKey = buildThumbnailKey(asset.accountKey, asset.id);
      await uploadToS3(thumbnailKey, thumb.buffer, 'image/webp');
      await prisma.mediaAsset.update({
        where: { id: asset.id },
        data: {
          thumbnailKey,
          // Backfill the intrinsic dimensions too while the bytes are decoded —
          // the grid needs them to reserve space and stop the layout shifting.
          ...(thumb.originalWidth && thumb.originalHeight
            ? { width: thumb.originalWidth, height: thumb.originalHeight }
            : {}),
        },
      });
      made += 1;
      if (made % 25 === 0 || i === eligible.length - 1) console.log(`${label} — ok`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push({ filename: asset.filename, reason });
      console.log(`${label} — FAILED: ${reason}`);
    }
  }

  console.log(`\nthumbnails created: ${made}/${eligible.length}`);
  if (failures.length) {
    console.log(`failures: ${failures.length}`);
    for (const f of failures.slice(0, 20)) console.log(`  ${f.filename}: ${f.reason}`);
    console.log('\nRe-running is safe — it only looks at rows still missing a thumbnail.');
  }
  console.log();
}

main()
  .catch((err) => {
    console.error(`\nBackfill failed: ${err instanceof Error ? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
