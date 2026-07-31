/**
 * Register the co-op guideline library into `AdGuidelineDoc`.
 *
 *   npx tsx scripts/register-coop-guidelines.ts [dir] [--upload] [--dry]
 *
 * Default dir: ~/Oz Marketing/Projects/Loomi/co-op-guidelines
 *
 * WHAT THIS DOES, AND WHAT IT POINTEDLY DOES NOT
 *
 * It hashes each document, records make + title + hash, and renders page 1 to a
 * cover thumbnail. That's the whole change-detection mechanism: when a manufacturer
 * reissues a document its hash moves, the previous hash is kept as history, and the
 * OEM guidelines page flags it. It does NOT read rules out of the documents — see
 * the header of `guideline-docs.ts` for why that was designed and rejected.
 *
 * `--upload` additionally puts each file in the Loomi media library (category
 * "oem") and attaches it, so agency staff can open the source a citation points at.
 * That needs S3, so it's a no-op locally and has to be run per environment — same
 * constraint as the OEM/disclaimer seed data.
 *
 * Idempotent. Re-running with unchanged files is a no-op (and skips re-rendering the
 * covers); re-running after a file is REPLACED moves the hash and stamps
 * `replacedAt`, which is what surfaces the change.
 *
 * ── THE MAKE MAP IS HAND-REVIEWED ON PURPOSE ──
 *
 * Filenames don't reliably carry the brand ("Attachment N Consolidated 03.04.26",
 * "TDMCJune2022Covenant-Final", "11185944_HMAClaimStatusDefinitionsUpdated"), so
 * every entry below was confirmed by reading the document's first page. Inferring
 * the make from the filename would silently file a document under the wrong brand,
 * and a document filed under the wrong brand is worse than one that's missing: the
 * page would report coverage that doesn't exist.
 *
 * `make` must match the vehicle make as it arrives from the inventory feeds and
 * MarketCheck, because that's what `loadCoopPack` and the report group on.
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prisma } from '@/lib/prisma';
import { registerGuidelineDoc } from '@/lib/ad-generator/guideline-docs';
import { withPreviewRenderer } from '@/lib/ad-generator/guideline-preview';
import { isS3Configured, s3PublicUrl, uploadToS3 } from '@/lib/s3';

interface Entry {
  file: string;
  make: string;
  title: string;
  /** Set when the document is not advertising rules, so the register says why. */
  note?: string;
}

/**
 * Filename → (make, title). Titles are what a human would call the document; they
 * form half of the `@@unique([make, title])` key, so several documents per make
 * coexist (a brand guide and a co-op program guide are genuinely different things).
 */
const ENTRIES: Entry[] = [
  // ── Automotive ──
  { file: 'imrProgramGuidelines.pdf', make: 'Chevrolet', title: 'GM iMR Program Guidelines' },
  { file: 'GMCAdStandards.pdf', make: 'GMC', title: 'GMC Brand Style Guide' },
  { file: 'Subaru_SAF_Guidelines_2026.pdf', make: 'Subaru', title: 'Subaru SAF Guidelines 2026' },
  { file: 'MCAP_Interactive_Guidelines_Aug_2025.pdf', make: 'Mazda', title: 'MCAP Interactive Guidelines Aug 2025' },
  { file: '11875443_Honda DMA Program Overview_vJan 2025.pdf', make: 'Honda', title: 'Honda DMA Program Overview (Jan 2025)' },
  { file: 'TDMCJune2022Covenant-Final.pdf', make: 'Toyota', title: 'Toyota Dealer Marketing Covenant (June 2022)' },
  { file: 'Ford Coop Tier III Marketing Program_April 20261.pdf', make: 'Ford', title: 'Ford Co-op Tier III Marketing Program (April 2026)' },
  { file: 'CDJR 2026 Guidelines.pdf', make: 'CDJR', title: 'CDJR 2026 Guidelines' },
  { file: '2026 CDJR Dealer Accelerate Co-Op Program.pdf', make: 'CDJR', title: 'CDJR Dealer Accelerate Co-Op Program 2026' },
  { file: '2026 Hyundai Guidelines.pdf', make: 'Hyundai', title: 'Hyundai Guidelines 2026' },
  { file: '14257276_2026 Q2 Hyundai Dealer Advertising Co-op Program Guidelines v1.pdf', make: 'Hyundai', title: 'Hyundai Dealer Advertising Co-op Program Guidelines 2026 Q2' },
  {
    file: 'Attachment N Consolidated 03.04.26.pdf',
    make: 'Hyundai',
    title: 'Hyundai Attachment N — Digital Advertising Specifications (Mar 2026)',
  },
  {
    file: '11185944_HMAClaimStatusDefinitionsUpdated.pdf',
    make: 'Hyundai',
    title: 'Hyundai Co-op Claim Status Definitions',
    note: 'Claim lifecycle reference, not advertising rules — nothing here is machine-checkable.',
  },
  { file: 'KIA 2025 Guidelines.pdf', make: 'Kia', title: 'Kia 2025 Guidelines' },
  { file: 'KiaDealerAdvertisingGuidelinesVer2.02025Apr638967455042013902.pdf', make: 'Kia', title: 'Kia Dealer Advertising Guidelines v2.0 (Apr 2025)' },
  { file: 'Genesis Brand Guidelines_April2026.pdf', make: 'Genesis', title: 'Genesis Retailer Marketing Guidelines (April 2026)' },
  { file: 'Genesis 2.docx', make: 'Genesis', title: 'Genesis Tier 3 Retail Brand Guidelines R6 (June 2024)' },
  { file: 'Audi Tier 3 Guidelines 2026.pdf', make: 'Audi', title: 'Audi Tier 3 Guidelines 2026' },
  { file: 'Audi Marketing Compliance Program - November 2024.pdf', make: 'Audi', title: 'Audi Marketing Compliance Program (Nov 2024)' },
  { file: 'VW DMP Guidelines - March 2026.pdf', make: 'Volkswagen', title: 'VW DMP Guidelines (March 2026)' },

  // ── Powersports / equipment ──
  // Separate makes from their automotive namesakes where the brand differs, and a
  // distinct TITLE where it doesn't: Honda auto and Honda Powersports run different
  // co-op programmes, and the unique key is (make, title).
  { file: '2025 Honda Powersports CoOp Guidelines.pdf', make: 'Honda', title: 'Honda Powersports Co-op Guidelines 2025' },
  { file: '2026 Kawasaki Co-op Advertising Guidelines.pdf', make: 'Kawasaki', title: 'Kawasaki Co-op Advertising Guidelines 2026' },
  { file: '2025 Suzuki Dealer Coop Advertising Guidelines.pdf', make: 'Suzuki', title: 'Suzuki Dealer Co-op Advertising Guidelines 2025' },
  { file: '2025 Yamaha Co-op Guidelines.pdf', make: 'Yamaha', title: 'Yamaha Co-op Guidelines 2025' },
  { file: '2025 Yamaha WaterCraft-Dealer Manual Final.pdf', make: 'Yamaha', title: 'Yamaha WaterCraft Dealer Manual 2025' },
  { file: '2026 Polaris ORV, Snow, PXD Co-Op Guidelines.pdf', make: 'Polaris', title: 'Polaris ORV/Snow/PXD Co-Op Guidelines 2026' },
  { file: '14047372_2026 Indian Motorcycle Co-Op Guidelines.pdf', make: 'Indian Motorcycle', title: 'Indian Motorcycle Co-Op Guidelines 2026' },
  { file: '2026 Harley-Davidson MDF Guidelines.pdf', make: 'Harley-Davidson', title: 'Harley-Davidson MDF Guidelines 2026' },
  { file: '2026 BRP (Can-Am, Ski-Doo, Sea-Doo, Lynx) Co-op Guidelines.pdf', make: 'BRP', title: 'BRP (Can-Am, Ski-Doo, Sea-Doo, Lynx) Co-op Guidelines 2026' },
  { file: 'Arctic Cat Co-Op Guidelines.pdf', make: 'Arctic Cat', title: 'Arctic Cat Co-Op Guidelines' },
  { file: 'CFMOTO Co-Op Guidelines_Final10_1_25.pdf', make: 'CFMOTO', title: 'CFMOTO Co-Op Guidelines (Oct 2025)' },
  { file: '2026_BMW_Motorrad_retail_coop_final_share.pdf', make: 'BMW Motorrad', title: 'BMW Motorrad Retail Co-op 2026' },
  { file: '2026 LS Tractor Guidelines.pdf', make: 'LS Tractor', title: 'LS Tractor Co-op Advertising Program Guidelines 2026' },
];

/**
 * Files present in the directory that are deliberately NOT registered, with the
 * reason. Listed explicitly so the script can assert it has accounted for every
 * file — a new document appearing in the folder should show up as unaccounted-for
 * rather than being silently ignored.
 */
const EXCLUDED: Record<string, string> = {
  'README.txt': 'Not a document — the folder README.',
  'Young_Credit_Education_Portal_Proposal.md.pdf':
    'Not a co-op guideline — an unrelated Oz Marketing proposal that ended up in the folder.',
  '13840869_2026 ORV, Snow, PXD Co-Op Guidelines Redesign FINAL.pdf':
    'Byte-identical duplicate of "2026 Polaris ORV, Snow, PXD Co-Op Guidelines.pdf".',
  '2026 Kawasaki Co-op Advertising Guidelines.docx':
    'Same document as the Kawasaki PDF, in .docx — the PDF is registered instead.',
};

const DEFAULT_DIR = path.join(os.homedir(), 'Oz Marketing', 'Projects', 'Loomi', 'co-op-guidelines');

function mimeFor(file: string): string {
  if (file.toLowerCase().endsWith('.pdf')) return 'application/pdf';
  if (file.toLowerCase().endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return 'application/octet-stream';
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? DEFAULT_DIR;
  const doUpload = args.includes('--upload');
  const dryRun = args.includes('--dry');

  console.log(`[register-coop-guidelines] dir: ${dir}`);
  console.log(`[register-coop-guidelines] upload: ${doUpload ? (isS3Configured() ? 'yes' : 'REQUESTED BUT S3 NOT CONFIGURED') : 'no'}`);
  if (dryRun) console.log('[register-coop-guidelines] DRY RUN — nothing will be written\n');

  const present = (await readdir(dir)).filter((f) => !f.startsWith('.'));
  const mapped = new Set(ENTRIES.map((e) => e.file));

  // Anything on disk that's neither mapped nor explicitly excluded. A new document
  // dropped in the folder lands here, which is the point: it must be a deliberate
  // decision to file it under a make, not a filename guess.
  const unaccounted = present.filter((f) => !mapped.has(f) && !(f in EXCLUDED));
  const missing = ENTRIES.filter((e) => !present.includes(e.file)).map((e) => e.file);

  let registered = 0;
  let changed = 0;
  let uploaded = 0;
  let previews = 0;
  const failures: string[] = [];

  await withPreviewRenderer(async (render) => {
  for (const entry of ENTRIES) {
    const full = path.join(dir, entry.file);
    let bytes: Buffer;
    try {
      bytes = await readFile(full);
    } catch {
      failures.push(`${entry.file}: unreadable`);
      continue;
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    const sizeMb = (bytes.byteLength / 1048576).toFixed(1);

    // Was this already registered with a different hash? That's a reissue, and the
    // interesting line in the output.
    const existing = await prisma.adGuidelineDoc
      .findUnique({
        where: { make_title: { make: entry.make, title: entry.title } },
        select: { contentHash: true, sourceAssetId: true },
      })
      .catch(() => null);
    const isNew = !existing;
    const isChanged = !!existing?.contentHash && existing.contentHash !== hash;

    let sourceAssetId = existing?.sourceAssetId ?? null;
    let sourceUrl: string | null = null;

    if (doUpload && isS3Configured() && !dryRun) {
      // No size cap here: these are admin-only reference documents and the real
      // library runs to 66MB. The media route's 25MB limit exists for account-level
      // image uploads, which is a different problem.
      try {
        const assetId = createHash('sha256').update(`${entry.make}:${entry.title}`).digest('hex').slice(0, 24);
        const s3Key = `media/_admin/${assetId}/${entry.file}`;
        await uploadToS3(s3Key, bytes, mimeFor(entry.file));
        await prisma.mediaAsset.upsert({
          where: { s3Key },
          create: {
            id: assetId,
            accountKey: null,
            s3Key,
            filename: entry.file,
            mimeType: mimeFor(entry.file),
            size: bytes.byteLength,
            category: 'oem',
          },
          update: { size: bytes.byteLength },
        });
        sourceAssetId = assetId;
        sourceUrl = s3PublicUrl(s3Key);
        uploaded++;
      } catch (err) {
        failures.push(`${entry.file}: upload failed — ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    const flag = isNew ? 'NEW    ' : isChanged ? 'CHANGED' : 'same   ';
    console.log(
      `  ${flag} ${entry.make.padEnd(18)} ${sizeMb.padStart(6)} MB  ${hash.slice(0, 12)}  ${entry.title}` +
        (entry.note ? `\n            ↳ ${entry.note}` : ''),
    );

    if (!dryRun) {
      const row = await registerGuidelineDoc({
        make: entry.make,
        title: entry.title,
        sourceUrl,
        sourceAssetId,
        bytes,
        mimeType: mimeFor(entry.file),
        // One shared browser across all 33 — a launch per document was slow and
        // flaky enough that one cover failed under the memory pressure.
        render,
        // The caveat lives on the row so it travels with the document rather than
        // only in this script.
        notes: entry.note ?? null,
      });
      if (!row) {
        failures.push(`${entry.file}: register failed`);
        continue;
      }
      if (row.previewImage) previews++;
    }
    registered++;
    if (isChanged) changed++;
  }
  });

  console.log(`\n── summary`);
  console.log(`   registered      ${registered}/${ENTRIES.length}`);
  if (changed) console.log(`   CHANGED         ${changed} (hash moved since last run)`);
  if (doUpload) console.log(`   uploaded        ${uploaded}`);
  console.log(`   covers rendered ${previews}`);
  console.log(`   excluded        ${Object.keys(EXCLUDED).length}`);
  for (const [f, why] of Object.entries(EXCLUDED)) console.log(`      · ${f} — ${why}`);
  if (missing.length) {
    console.log(`   MAPPED BUT ABSENT ${missing.length} — these are in the map but not on disk:`);
    for (const f of missing) console.log(`      · ${f}`);
  }
  if (unaccounted.length) {
    console.log(`   UNACCOUNTED FOR ${unaccounted.length} — add to ENTRIES or EXCLUDED in this script:`);
    for (const f of unaccounted) console.log(`      · ${f}`);
  }
  if (failures.length) {
    console.log(`   FAILURES        ${failures.length}`);
    for (const f of failures) console.log(`      · ${f}`);
  }
  if (!doUpload) {
    console.log(
      `\n   Documents are registered by HASH only — nothing was uploaded, so "open →"\n` +
        `   has no target yet. Re-run with --upload in an environment that has S3\n` +
        `   configured to attach the files for agency reading.`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
