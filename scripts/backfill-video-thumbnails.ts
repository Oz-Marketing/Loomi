/**
 * Give every video already in the media library a poster thumbnail.
 *
 * DELIBERATELY NOT WIRED INTO THE DEPLOY. The deploy's SSH step dies at 15
 * minutes and runs every backfill on every release; this one's cost is unbounded
 * (one frame grab per clip, over the network) so it would eventually take the
 * deploy down with it. Run it by hand, once, per environment:
 *
 *   npx tsx scripts/backfill-video-thumbnails.ts            # report only
 *   npx tsx scripts/backfill-video-thumbnails.ts --apply
 *
 * Safe to re-run: only rows with no thumbnail are touched, and a failure on one
 * clip is reported and skipped rather than aborting the run.
 */
import { prisma } from '../src/lib/prisma';
import { buildThumbnailKey, isS3Configured, uploadToS3 } from '../src/lib/s3';
import { generateVideoThumbnail, videoThumbnailsAvailable } from '../src/lib/media-video-thumbnail';

async function main() {
  const apply = process.argv.includes('--apply');

  if (!isS3Configured()) {
    console.error('S3 is not configured in this environment — nothing to read or write.');
    process.exit(1);
  }
  if (!(await videoThumbnailsAvailable())) {
    console.error('No ffmpeg on this host, so no frames can be extracted. Install it (apt-get install -y ffmpeg) or set FFMPEG_PATH.');
    process.exit(1);
  }

  const rows = await prisma.mediaAsset.findMany({
    where: { mimeType: { startsWith: 'video/' }, thumbnailKey: null },
    select: { id: true, accountKey: true, s3Key: true, filename: true, mimeType: true, size: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${rows.length} video asset(s) without a poster thumbnail.`);
  if (!rows.length) return;
  if (!apply) {
    for (const r of rows) {
      console.log(`  · ${r.filename} (${Math.round(Number(r.size ?? 0) / 1024 / 1024)}MB) — ${r.accountKey ?? '_admin'}`);
    }
    console.log('\nDry run. Re-run with --apply to write thumbnails.');
    return;
  }

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const thumb = await generateVideoThumbnail({ s3Key: r.s3Key }, r.mimeType);
      if (!thumb) {
        failed++;
        console.warn(`  ! ${r.filename}: no frame could be read`);
        continue;
      }
      const thumbnailKey = buildThumbnailKey(r.accountKey, r.id);
      await uploadToS3(thumbnailKey, thumb.buffer, 'image/webp');
      await prisma.mediaAsset.update({
        where: { id: r.id },
        data: {
          thumbnailKey,
          // Recorded while we have it: a clip's real pixel size was never stored.
          ...(thumb.originalWidth && thumb.originalHeight
            ? { width: thumb.originalWidth, height: thumb.originalHeight }
            : {}),
        },
      });
      done++;
      console.log(`  ✓ ${r.filename} (${thumb.originalWidth}×${thumb.originalHeight})`);
    } catch (err) {
      failed++;
      console.warn(`  ! ${r.filename}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }
  console.log(`\nDone: ${done} thumbnailed, ${failed} skipped.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
