/**
 * Catalogue every account's existing logos and fonts into the media library.
 *
 * Both have been uploading to S3 and recording their URL on the Account for as
 * long as they've existed, without ever creating a library row — so the DAM
 * couldn't see the most-reused assets the agency owns. New uploads now sync
 * themselves; this covers everything already there.
 *
 * Idempotent: `syncAccountBrandAssets` reconciles rather than inserts, so
 * re-running is a no-op. Safe to include in the deploy chain alongside the other
 * backfills.
 *
 *   npx tsx scripts/backfill-brand-assets.ts
 */
import { prisma } from '@/lib/prisma';
import { isS3Configured } from '@/lib/s3';
import { syncAccountBrandAssets } from '@/lib/services/brand-assets';

async function main() {
  // Without a bucket every object read fails and the sync would catalogue
  // nothing while reporting success. Skipping is the honest outcome.
  if (!isS3Configured()) {
    console.log('[backfill-brand-assets] S3 not configured — skipping.');
    return;
  }

  const accounts = await prisma.account.findMany({
    select: { key: true, logos: true, customFonts: true, customValues: true },
  });

  // Only accounts that actually claim a brand asset. Most don't, and reading
  // every object for them would make this needlessly slow.
  const candidates = accounts.filter(
    (a) =>
      (a.logos && a.logos !== '{}')
      || (a.customFonts && a.customFonts !== '[]')
      || (a.customValues && a.customValues.includes('storefront_image')),
  );

  let created = 0;
  let updated = 0;
  let removed = 0;
  let failed = 0;

  for (const account of candidates) {
    try {
      const r = await syncAccountBrandAssets(account.key);
      created += r.created;
      updated += r.updated;
      removed += r.removed;
    } catch (err) {
      failed += 1;
      console.warn(`[backfill-brand-assets] ${account.key} failed:`, err);
    }
  }

  console.log(
    `[backfill-brand-assets] ${candidates.length} account(s) with brand assets: `
      + `${created} catalogued, ${updated} updated, ${removed} stale row(s) removed`
      + (failed ? `, ${failed} failed` : ''),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-brand-assets] fatal:', err);
    process.exit(1);
  });
