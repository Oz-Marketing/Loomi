/**
 * Import the Oz Dealer Tools ad backlog + background plates into Loomi media
 * libraries, so dealers moving off ODT keep their creative history.
 *
 *  - Rendered ad exports (offer_creatives/{campaign_id}/*.png) → the matching
 *    ACCOUNT's media library, category "ad-creative", tagged `odt-archive`,
 *    with campaign name / vehicle / offer text as searchable alt text.
 *  - Background plates (assets/*, categories background/jellybean/graphic) →
 *    the ADMIN media library (accountKey null), tagged `odt-plates` + their
 *    ODT collection name, for template authoring. Logo-category rows are
 *    skipped (Loomi manages account logos separately).
 *
 * ODT org → Loomi account matching is by normalized name against
 * Account.dealer, with an explicit override map for naming drift. Unmatched
 * orgs are reported and their campaigns SKIPPED (never guessed).
 *
 * DRY-RUN BY DEFAULT — prints the mapping + what would be imported. Pass
 * --apply to write. Idempotent: rows are keyed by deterministic s3Key, so
 * re-runs skip existing imports.
 *
 * Run on the droplet (after unzipping the cPanel exports into <data-dir>
 * containing manifest.json, offer_creatives/, assets/):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/import-odt-backlog.ts <data-dir> [--apply]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { buildS3Key, isS3Configured, uploadToS3 } from '../src/lib/s3';

// ODT stores ~85% of plates on its CDN (assets.storage = 'cdn'), not on the
// server disk — those aren't in the cPanel zip. The CDN hotlink-protects, so
// fetch with the app's Referer.
const ODT_CDN_BASE = 'https://cdn.ozmktgweb5.com/uploads/assets';
const ODT_REFERER = 'https://ozdealertools.com/';

async function fetchCdnPlate(filename: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${ODT_CDN_BASE}/${encodeURIComponent(filename)}`, {
      headers: { Referer: ODT_REFERER },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

interface Manifest {
  organizations: { id: number; name: string }[];
  campaigns: {
    id: number;
    orgId: number;
    orgName: string | null;
    name: string;
    status: string;
    offerText: string | null;
    vehicle: string | null;
    createdAt: string | null;
  }[];
  assets: {
    id: number;
    filename: string;
    originalName: string | null;
    category: string | null;
    collectionName: string | null;
    brandLevel: boolean;
    width: number | null;
    height: number | null;
  }[];
}

/**
 * ODT org name → Loomi account key, for orgs whose ODT name doesn't normalize
 * to any Account.dealer (ODT drops "of", pluralizes "Trailers", reorders
 * CJDR makes, etc.). Confirmed 1:1 by name + zip against the Loomi prod account
 * list (2026-07-01). `null` = intentionally skipped.
 */
const ORG_OVERRIDES: Record<string, string | null> = {
  // Internal test data — never import.
  'Oz Marketing': null,
  // Renamed on Loomi (ODT name → Loomi key). Verified by name + zip.
  'Young Ford Ogden': 'youngFordOfOgden',
  'Young Ford Morgan': 'youngFordOfMorgan',
  'Young Ford of Brigham City': 'youngFordOfBrigham',
  'Young Chrysler Jeep Dodge Ram Fiat Idaho': 'youngChryslerDodgeJeepRamOfBurley', // Burley, ID (83318)
  'Young Chrysler Jeep Dodge Ram Layton': 'youngChryslerDodgeJeepRamOfLayton',
  'Young Chrysler Jeep Dodge Ram Morgan': 'youngChryslerDodgeJeepRamOfMorgan',
  'Genesis of Ogden': 'genesisOgden',
  'Young Mazda Missoula': 'youngMazdaOfMissoula',
  'Young Mazda Ogden': 'youngMazdaOfOgden',
  'Young Powersports Burley': 'youngPowersportsOfBurley',
  'Young Powersports Layton': 'youngPowersportsLayton',
  'Young Powersports Logan': 'youngPowersportsOfLogan',
  'Young Powersports Missoula': 'youngPowersportsOfMissoula',
  'Young Powersports Morgan': 'youngPowersportsOfMorgan',
  'Young Powersports Ogden': 'youngPowersportsOfOgden',
  'Young Truck and Trailers Kaysville': 'youngTruckAndTrailerOfKaysville',
  'Young Truck and Trailers Logan': 'youngTruckAndTrailerOfLogan',
  'Young Commercial': 'youngCommercialFleet',
  // Genuinely not in Loomi yet (no account) — left unmatched on purpose:
  //   Young Powersports Centerville, Xtreme Accessories, Young Nissan Riverdale
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'ad'
  );
}

/** PNG pixel size from the IHDR chunk (bytes 16..24); null for non-PNG. */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  const dataDir = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!dataDir) throw new Error('usage: import-odt-backlog.ts <data-dir> [--apply]');
  if (apply && !isS3Configured()) throw new Error('S3 is not configured in this environment');

  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8')) as Manifest;
  const creativesDir = join(dataDir, 'offer_creatives');
  const platesDir = join(dataDir, 'assets');

  // ── org → account mapping ──
  const accounts = await prisma.account.findMany({ select: { key: true, dealer: true } });
  const byNorm = new Map(accounts.map((a) => [norm(a.dealer), a.key]));
  const validKeys = new Set(accounts.map((a) => a.key));
  const mapping = new Map<number, string | null>();
  for (const org of manifest.organizations) {
    let key: string | null;
    if (org.name in ORG_OVERRIDES) key = ORG_OVERRIDES[org.name];
    else key = byNorm.get(norm(org.name)) ?? null;
    // Guard: an override pointing at a nonexistent account would FK-fail mid
    // import. Warn and skip rather than abort the run partway through.
    if (key && !validKeys.has(key)) {
      console.warn(`  ! override for "${org.name}" → "${key}" has no matching account — skipping`);
      key = null;
    }
    mapping.set(org.id, key);
  }
  console.log('── org → account mapping ──');
  for (const org of manifest.organizations) {
    const key = mapping.get(org.id);
    console.log(`  ${String(org.id).padStart(3)}  ${org.name.padEnd(48)} → ${key ?? (org.name in ORG_OVERRIDES ? 'SKIP (override)' : 'UNMATCHED — campaigns skipped')}`);
  }

  const summary = { creatives: 0, creativesSkippedExisting: 0, creativesSkippedUnmatched: 0, plates: 0, platesFromCdn: 0, platesSkippedExisting: 0, missingFiles: 0 };

  // ── campaign creatives → account libraries ──
  for (const c of manifest.campaigns) {
    const dir = join(creativesDir, String(c.id));
    if (!existsSync(dir)) continue; // drafts often have no exports
    const images = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const accountKey = mapping.get(c.orgId);
    if (!accountKey) {
      summary.creativesSkippedUnmatched += images.length; // count images, matching the import loop
      continue;
    }
    for (const file of images) {
      const filename = `${slug(c.name)}-${file}`;
      const s3Key = buildS3Key(accountKey, `odt-c${c.id}`, filename);
      const exists = await prisma.mediaAsset.findUnique({ where: { s3Key } });
      if (exists) {
        summary.creativesSkippedExisting++;
        continue;
      }
      const buf = readFileSync(join(dir, file));
      const dims = pngSize(buf);
      const alt = [c.name, c.vehicle, c.offerText].filter(Boolean).join(' — ');
      if (apply) {
        await uploadToS3(s3Key, buf, file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
        await prisma.mediaAsset.create({
          data: {
            accountKey,
            s3Key,
            filename,
            mimeType: file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
            size: buf.length,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            category: 'ad-creative',
            tags: JSON.stringify(['odt-archive', c.status]),
            altText: alt || null,
          },
        });
      }
      summary.creatives++;
    }
  }

  // ── background plates → admin library (local file, else the ODT CDN) ──
  for (const a of manifest.assets) {
    if (!a.category || a.category === 'logo') continue;
    const path = join(platesDir, a.filename);
    const local = existsSync(path);
    const filename = a.originalName || a.filename;
    const s3Key = buildS3Key(null, `odt-asset-${a.id}`, filename);
    const exists = await prisma.mediaAsset.findUnique({ where: { s3Key } });
    if (exists) {
      summary.platesSkippedExisting++;
      continue;
    }
    if (apply) {
      const buf = local ? readFileSync(path) : await fetchCdnPlate(a.filename);
      if (!buf) {
        console.warn(`  ! plate unavailable locally and on the CDN: ${a.filename}`);
        summary.missingFiles++;
        continue;
      }
      const dims = pngSize(buf);
      await uploadToS3(s3Key, buf, filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg');
      await prisma.mediaAsset.create({
        data: {
          accountKey: null,
          s3Key,
          filename,
          mimeType: filename.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
          size: buf.length,
          width: dims?.width ?? a.width,
          height: dims?.height ?? a.height,
          category: a.category === 'background' ? 'ad-creative' : 'general',
          tags: JSON.stringify(['odt-plates', ...(a.collectionName ? [a.collectionName] : [])]),
          altText: [a.originalName, a.collectionName].filter(Boolean).join(' — ') || null,
        },
      });
    }
    summary.plates++;
    if (!local) summary.platesFromCdn++;
  }

  console.log('── summary ──');
  console.log(`  mode: ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}`);
  console.log(`  creatives ${apply ? 'imported' : 'to import'}: ${summary.creatives} (skipped existing: ${summary.creativesSkippedExisting}, unmatched org: ${summary.creativesSkippedUnmatched})`);
  console.log(`  plates ${apply ? 'imported' : 'to import'}: ${summary.plates} (${summary.platesFromCdn} via CDN fetch, skipped existing: ${summary.platesSkippedExisting}, unavailable: ${summary.missingFiles})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
