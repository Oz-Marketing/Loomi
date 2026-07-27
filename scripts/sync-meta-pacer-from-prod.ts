/**
 * Copy the Meta Ads Pacer dataset from one database to another — built to
 * refresh STAGING from PRODUCTION so the pacing cards can be tested against
 * real budgets + spend history.
 *
 * SCOPE — only the eleven MetaAdsPacer* tables are touched. These hold budgets,
 * spend series, and rep notes; they carry NO credentials. The Account and User
 * tables are never written, so no API tokens, SendGrid/Twilio keys, emails, or
 * password hashes are copied. (This assumes the target already has the same
 * Account rows — the pacer plans FK to Account.key. Any plan whose account is
 * missing on the target is skipped and reported, never force-inserted.)
 *
 * SAFETY:
 *   - Dry-run by default. Pass --apply to actually write.
 *   - Refuses to run if SOURCE and TARGET URLs are identical.
 *   - Every `...UserId` reference is nulled unless that user exists on the
 *     target, so owner/designer/author attribution never dangles or FK-fails.
 *   - The write runs in a single transaction on the target: truncate the pacer
 *     tables, then re-insert prod's rows in FK order preserving ids.
 *
 * RUN (from a host that can reach BOTH databases):
 *   SOURCE_DATABASE_URL='postgres://…prod…' \
 *   TARGET_DATABASE_URL='postgres://…staging…' \
 *   npx tsx scripts/sync-meta-pacer-from-prod.ts            # dry-run (reports only)
 *
 *   …same env… npx tsx scripts/sync-meta-pacer-from-prod.ts --apply   # writes
 */
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const APPLY = process.argv.includes('--apply');

function client(url: string): PrismaClient {
  const clean = url
    .replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : ''))
    .replace(/\?$/, '');
  const pool = new pg.Pool({
    connectionString: clean,
    ...(/[?&]sslmode=require/.test(url) && { ssl: { rejectUnauthorized: false } }),
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

/** Just the host:db of a URL, for logging — never prints credentials. */
function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

// Pacer tables in FK-parent-first order. Each row is copied verbatim (ids
// preserved so child FKs line up); `accountKey` rows need the account to exist
// on the target, `planId` rows need their plan to have been copied.
const TABLES = [
  { model: 'metaAdsPacerPlan', scope: 'account' as const },
  { model: 'metaAdsPacerAd', scope: 'plan' as const },
  { model: 'metaAdsPacerDesignNote', scope: 'ad' as const },
  { model: 'metaAdsPacerActivityLog', scope: 'ad' as const },
  { model: 'metaAdsPacerPeriodBudget', scope: 'plan' as const },
  { model: 'metaAdsPacerMonthSnapshot', scope: 'plan' as const },
  { model: 'metaAdsPacerAuditEntry', scope: 'plan' as const },
  { model: 'metaAdsPacerCarryoverApplication', scope: 'plan' as const },
  { model: 'metaAdsPacerDailySpend', scope: 'plan' as const },
  { model: 'metaAdsPacerAccountNote', scope: 'account' as const },
  { model: 'metaAdsPacerBudgetLog', scope: 'account' as const },
] as const;

type Row = Record<string, unknown>;

/** Null every `...UserId` value that doesn't exist on the target. */
function scrubUsers(rows: Row[], targetUserIds: Set<string>): number {
  let nulled = 0;
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key.endsWith('UserId') && row[key] != null && !targetUserIds.has(row[key] as string)) {
        row[key] = null;
        nulled += 1;
      }
    }
  }
  return nulled;
}

async function chunkedCreate(delegate: { createMany: (a: unknown) => Promise<unknown> }, rows: Row[]) {
  const SIZE = 1000;
  for (let i = 0; i < rows.length; i += SIZE) {
    await delegate.createMany({ data: rows.slice(i, i + SIZE), skipDuplicates: true });
  }
}

async function main() {
  const SOURCE = process.env.SOURCE_DATABASE_URL;
  const TARGET = process.env.TARGET_DATABASE_URL;
  if (!SOURCE || !TARGET) {
    console.error('Set SOURCE_DATABASE_URL (prod) and TARGET_DATABASE_URL (staging).');
    process.exit(1);
  }
  if (SOURCE === TARGET) {
    console.error('SOURCE and TARGET are identical — refusing to run.');
    process.exit(1);
  }

  console.log(`SOURCE (read):  ${hostOf(SOURCE)}`);
  console.log(`TARGET (write): ${hostOf(TARGET)}`);
  console.log(APPLY ? '\nMODE: APPLY — the target pacer tables will be replaced.\n' : '\nMODE: DRY-RUN — no writes. Pass --apply to execute.\n');

  const src = client(SOURCE);
  const dst = client(TARGET);

  try {
    // Target reference sets — which accounts + users the copied rows may point at.
    const [targetAccounts, targetUsers] = await Promise.all([
      dst.account.findMany({ select: { key: true } }),
      dst.user.findMany({ select: { id: true } }),
    ]);
    const accountKeys = new Set(targetAccounts.map((a) => a.key));
    const userIds = new Set(targetUsers.map((u) => u.id));
    console.log(`Target has ${accountKeys.size} accounts, ${userIds.size} users.\n`);

    // Read every pacer table from source. Which plans are insertable depends on
    // the account existing on the target; child rows follow their plan.
    const srcAny = src as unknown as Record<string, { findMany: () => Promise<Row[]> }>;
    const data: Record<string, Row[]> = {};
    for (const { model } of TABLES) {
      data[model] = await srcAny[model].findMany();
    }

    const insertablePlanIds = new Set(
      data.metaAdsPacerPlan
        .filter((p) => accountKeys.has(p.accountKey as string))
        .map((p) => p.id as string),
    );
    const skippedPlans = data.metaAdsPacerPlan.filter(
      (p) => !accountKeys.has(p.accountKey as string),
    );
    if (skippedPlans.length > 0) {
      console.log(
        `WARNING: ${skippedPlans.length} plan(s) skipped — account missing on target: ` +
          skippedPlans.map((p) => p.accountKey).join(', ') +
          '\n',
      );
    }

    // Filter each table to rows whose parent will exist, and scrub user FKs.
    let totalNulled = 0;
    const filtered: Record<string, Row[]> = {};
    for (const { model, scope } of TABLES) {
      let rows = data[model];
      if (scope === 'plan') rows = rows.filter((r) => insertablePlanIds.has(r.planId as string));
      if (scope === 'account') rows = rows.filter((r) => accountKeys.has(r.accountKey as string));
      if (scope === 'ad') {
        const adIds = new Set((filtered.metaAdsPacerAd ?? []).map((a) => a.id as string));
        rows = rows.filter((r) => adIds.has(r.adId as string));
      }
      totalNulled += scrubUsers(rows, userIds);
      filtered[model] = rows;
    }

    console.log('Rows to copy:');
    for (const { model } of TABLES) {
      console.log(`  ${model.padEnd(34)} ${filtered[model].length}`);
    }
    console.log(`\n(${totalNulled} user references nulled — authors/owners absent on target.)`);

    if (!APPLY) {
      console.log('\nDRY-RUN complete — nothing written. Re-run with --apply to execute.');
      return;
    }

    await dst.$transaction(
      async (tx) => {
        const txAny = tx as unknown as Record<
          string,
          { deleteMany: () => Promise<unknown>; createMany: (a: unknown) => Promise<unknown> }
        >;
        // Delete children-first (reverse of TABLES), then insert parents-first.
        for (const { model } of [...TABLES].reverse()) {
          await txAny[model].deleteMany();
        }
        for (const { model } of TABLES) {
          await chunkedCreate(txAny[model], filtered[model]);
        }
      },
      { timeout: 120_000 },
    );

    console.log('\nDONE — target Meta pacer tables now mirror the source.');
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
