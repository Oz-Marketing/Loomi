/**
 * Import Oz Dealer Tools' billboard inventory into Loomi.
 *
 * ONE-TIME MOVE, NOT A SYNC. Every other ODT surface in the migration reads
 * through the Oz Reports bridge, because the DMS keeps feeding those tables.
 * Billboards are different: ODT was the system of record — someone typed each
 * board in by hand — and ODT is being retired. Pointing a recurring sync at a
 * dying application would build a dependency with an expiry date, so the rows
 * move once and Loomi owns them afterwards.
 *
 * ODT org → Loomi account matching reuses the shared resolver, so this can't
 * drift from the other two importers. Unmatched orgs are reported and their
 * boards SKIPPED — never guessed onto a neighbouring account.
 *
 * `is_group_level` becomes `sharedWithChildren` on the account the group org
 * resolves to; the read path walks the Loomi hierarchy from there
 * (src/lib/reporting/billboards.ts).
 *
 * DRY-RUN BY DEFAULT — prints the mapping and what would be written. Pass
 * --apply to write. Idempotent on externalId ("odt:billboards:<id>"), so
 * re-runs update in place rather than duplicating.
 *
 * ── PREPARING THE DUMP ──────────────────────────────────────────────────────
 * Run ON the ODT host — `database.default.hostname` is `localhost`, so the app
 * DB isn't reachable from anywhere else. Credentials are in ODT's `.env`
 * (`database.default.username` / `.password`); `scripts/odt-dump-billboards.sh`
 * reads them out of that file so nothing has to be typed or pasted.
 *
 *   ./scripts/odt-dump-billboards.sh > odt-billboards.json
 *
 * The query is JSON rather than the usual `-B` tab dump for one reason:
 * `notes` is free-form TEXT, and a newline or tab typed into it silently
 * corrupts a TSV — rows split, columns shift, and the import lands garbage
 * without failing. `JSON_OBJECT` escapes those characters, so the file is
 * either valid or it doesn't parse at all.
 *
 * Then run against Loomi (odt-billboards.json in <data-dir>):
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/import-odt-billboards.ts <data-dir> [--apply]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { resolveOrgAccounts } from './_odt-org-map';

/**
 * Values arrive as whatever MySQL's JSON functions produced — numbers stay
 * numbers, NULL becomes null. The coercions below take `unknown` and normalize,
 * so a hand-made dump that stringifies everything (a `-B` tab export piped
 * through a CSV reader, say) imports identically rather than throwing on the
 * first `.trim()` of a number.
 */
type OdtBoard = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  // "NULL" is what a tab dump writes for a null; a JSON dump never produces it.
  return s === '' || s === 'NULL' ? null : s;
};
const int = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
};
const dec = (v: unknown): number | null => {
  const s = str(v);
  if (s === null) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const date = (v: unknown): Date | null => {
  const s = str(v);
  // MySQL's zero-date is not a date; it is a missing value wearing a costume.
  if (s === null || s.startsWith('0000-00-00')) return null;
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** TINYINT(1) arrives as 1 from a JSON dump and "1" from a tab dump. */
const bool = (v: unknown): boolean => str(v) === '1' || v === true;

/**
 * A board with no usable coordinates can't be plotted, and ODT's form let one
 * through — the columns default to 0, which is a real place in the Atlantic.
 * These are imported anyway (the contract and its renewal date still matter)
 * but reported, so someone can fill the coordinates in.
 */
function coordsMissing(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return true;
  if (lat === 0 && lng === 0) return true;
  return Math.abs(lat) > 90 || Math.abs(lng) > 180;
}

async function main() {
  const dataDir = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!dataDir) throw new Error('usage: import-odt-billboards.ts <data-dir> [--apply]');

  const dump = JSON.parse(
    readFileSync(join(dataDir, 'odt-billboards.json'), 'utf8'),
  ) as { boards: OdtBoard[] };
  const boards = dump.boards ?? [];
  console.log(`Read ${boards.length} board(s) from the ODT dump.\n`);

  // `organization_id` is nullable in ODT and the dump LEFT JOINs, so an
  // orphaned board reaches here with no org. It can't be assigned to an account,
  // but it is counted and named below rather than dropped in the SQL — a board
  // that vanishes between ODT and Loomi should be something someone decided,
  // not something a JOIN did quietly.
  const orgs = [
    ...new Map(
      boards
        .filter((b) => int(b.organization_id) !== null && str(b.org_name) !== null)
        .map((b) => {
          const id = int(b.organization_id) as number;
          return [id, { id, name: str(b.org_name) as string }] as const;
        }),
    ).values(),
  ];
  const accounts = await prisma.account.findMany({ select: { key: true, dealer: true } });
  const mapping = resolveOrgAccounts(orgs, accounts);

  console.log('ODT org → Loomi account');
  for (const org of orgs) {
    console.log(`  ${org.name} → ${mapping.get(org.id) ?? '(unmatched — boards skipped)'}`);
  }
  console.log('');

  const summary = { created: 0, updated: 0, skippedUnmatched: 0, skippedNoOrg: 0, noCoords: 0 };

  for (const b of boards) {
    const orgId = int(b.organization_id);
    if (orgId === null) {
      summary.skippedNoOrg++;
      console.warn(
        `  ! board #${str(b.billboard_number) ?? String(b.id)} has no organization in ODT — skipped`,
      );
      continue;
    }
    const accountKey = mapping.get(orgId);
    if (!accountKey) {
      summary.skippedUnmatched++;
      continue;
    }

    const lat = dec(b.latitude);
    const lng = dec(b.longitude);
    if (coordsMissing(lat, lng)) {
      summary.noCoords++;
      console.warn(
        `  ! board #${str(b.billboard_number) ?? String(b.id)} (${accountKey}) has no usable coordinates — imported, will not plot`,
      );
    }

    const externalId = `odt:billboards:${String(b.id)}`;
    const data = {
      accountKey,
      // ODT's flag lived on the board; Loomi reads it against the real account
      // hierarchy, so the flag is all that has to come across.
      sharedWithChildren: bool(b.is_group_level),
      providerName: str(b.provider_name) ?? 'Unknown provider',
      billboardNumber: str(b.billboard_number) ?? String(b.id),
      artworkUrl: str(b.artwork_url),
      facingDirection: str(b.facing_direction),
      avgDailyTraffic: int(b.avg_daily_traffic),
      pricePerPeriod: dec(b.price_per_period),
      numPeriods: int(b.num_periods) ?? 1,
      periodType: str(b.period_type) ?? '4-week',
      expirationDate: date(b.expiration_date),
      renewedAt: date(b.renewed_at),
      latitude: lat ?? 0,
      longitude: lng ?? 0,
      // ODT's `expired` status was written by a sweep on page load; Loomi
      // derives expiry from the date at read time, so anything that isn't a
      // deliberate archive comes in as active and lets the date speak.
      status: str(b.status) === 'archived' ? 'archived' : 'active',
      notes: str(b.notes),
    };

    if (!apply) {
      const existing = await prisma.billboard.findUnique({ where: { externalId } });
      if (existing) summary.updated++;
      else summary.created++;
      continue;
    }

    const res = await prisma.billboard.upsert({
      where: { externalId },
      create: { ...data, externalId },
      update: data,
    });
    if (res.createdAt.getTime() === res.updatedAt.getTime()) summary.created++;
    else summary.updated++;
  }

  console.log('');
  console.log(apply ? 'Applied:' : 'Dry run — nothing written:');
  console.log(`  created            ${summary.created}`);
  console.log(`  updated            ${summary.updated}`);
  console.log(`  skipped (no acct)  ${summary.skippedUnmatched}`);
  console.log(`  skipped (no org)   ${summary.skippedNoOrg}`);
  console.log(`  missing coords     ${summary.noCoords}`);
  if (!apply) console.log('\nRe-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
