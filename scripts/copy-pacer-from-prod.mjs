#!/usr/bin/env node
/**
 * Copy the Meta Ads Pacer/Planner data from PRODUCTION into the CURRENT database
 * (intended: staging), plus the Account + User rows those pacer rows reference.
 *
 * WHY a raw-SQL script and not Prisma: staging's schema is AHEAD of prod (it has
 * the new Google columns), so a Prisma client generated from staging would SELECT
 * columns prod doesn't have. This copies the COLUMN INTERSECTION via
 * jsonb_populate_recordset — prod's columns come across, staging-only columns keep
 * their defaults. No schema assumptions.
 *
 * SAFETY:
 *   • Dry-run by default — prints exactly what it would do and writes NOTHING.
 *     Pass --apply to actually write.
 *   • On --apply, ALL writes run in ONE transaction. Any error → full ROLLBACK,
 *     staging untouched.
 *   • Before modifying the pacer tables it snapshots each into a `_bak_<table>_<ts>`
 *     table (inside the same transaction). To roll back a committed run:
 *        TRUNCATE "MetaAdsPacerAd";
 *        INSERT INTO "MetaAdsPacerAd" SELECT * FROM "_bak_MetaAdsPacerAd_<ts>";
 *     (repeat per table, child→parent order), then DROP the _bak_ tables.
 *   • Accounts/Users are UPSERTED (never deleted) so the rest of staging is safe.
 *
 * RUN (on the staging droplet, which can reach the prod managed DB + local pg):
 *   PROD_DATABASE_URL='postgres://...PROD...' \
 *   DATABASE_URL='postgres://...STAGING...' \
 *   node scripts/copy-pacer-from-prod.mjs            # dry run — review the report
 *   ...same env... node scripts/copy-pacer-from-prod.mjs --apply
 *
 * DATABASE_URL is normally already set in the droplet's shared/.env.local; you only
 * need to supply PROD_DATABASE_URL. Only `pg` is required (already a dependency).
 */

import { Pool } from 'pg';

const PROD_URL = process.env.PROD_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;
const APPLY = process.argv.includes('--apply');

// Insert order — parents before children (reverse for deletes).
const PACER_TABLES = [
  'MetaAdsPacerPlan',
  'MetaAdsPacerPeriodBudget',
  'MetaAdsPacerMonthSnapshot',
  'MetaAdsPacerCarryoverApplication',
  'MetaAdsPacerAd',
  'MetaAdsPacerDesignNote',
  'MetaAdsPacerActivityLog',
  'MetaAdsPacerAuditEntry',
  'MetaAdsPacerAccountNote',
  'MetaAdsPacerBudgetLog',
];

// Which columns hold an Account.key / User.id reference (to gather what to copy).
const ACCOUNT_REF_COLS = {
  MetaAdsPacerPlan: ['accountKey'],
  MetaAdsPacerAccountNote: ['accountKey'],
  MetaAdsPacerBudgetLog: ['accountKey'],
};
const USER_REF_COLS = {
  MetaAdsPacerAd: ['ownerUserId', 'designerUserId', 'accountRepUserId'],
  MetaAdsPacerDesignNote: ['authorUserId'],
  MetaAdsPacerActivityLog: ['authorUserId'],
  MetaAdsPacerAccountNote: ['authorUserId'],
  MetaAdsPacerBudgetLog: ['authorUserId'],
};
// User columns on Account that must also be brought over (Account.accountRepId → User.id).
const ACCOUNT_USER_REF_COLS = ['accountRepId'];

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const redact = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '(unparseable url)';
  }
};
const log = (...a) => console.log(...a);

function fail(msg) {
  console.error('\n✖ ' + msg + '\n');
  process.exit(1);
}

/** Pool with SSL enabled when the URL asks for it (DO managed DB = sslmode=require;
 *  its CA isn't in the system store, so don't verify the chain). Local/staging
 *  (no sslmode) connects without SSL. */
function makePool(url) {
  let sslmode = null;
  try {
    sslmode = new URL(url).searchParams.get('sslmode');
  } catch {
    /* ignore */
  }
  const needSsl = sslmode && !['disable', 'allow'].includes(sslmode);
  return new Pool({
    connectionString: url,
    max: 4,
    ...(needSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
}

if (!PROD_URL) fail('PROD_DATABASE_URL is not set (the source / production DB).');
if (!TARGET_URL) fail('DATABASE_URL is not set (the target — should be staging).');
if (PROD_URL === TARGET_URL) fail('PROD_DATABASE_URL and DATABASE_URL are identical — refusing to run.');

async function columns(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

/** Read rows from a table as plain JS objects (json round-trip preserves types). */
async function read(pool, table, whereCol, keys) {
  let sql = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) AS data FROM ${q(table)} t`;
  const params = [];
  if (whereCol) {
    sql += ` WHERE t.${q(whereCol)} = ANY($1)`;
    params.push(keys);
  }
  const { rows } = await pool.query(sql, params);
  return rows[0].data;
}

/** How many of `keys` already exist in the target table's key column. */
async function existing(pool, table, keyCol, keys) {
  if (keys.length === 0) return 0;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM ${q(table)} WHERE ${q(keyCol)} = ANY($1)`,
    [keys],
  );
  return rows[0].n;
}

/**
 * Insert `rows` into `table` on the target, copying only the columns present in
 * BOTH the rows and the target table (staging-only columns get their defaults).
 * With conflictKey → upsert; without → plain insert (table is pre-cleared).
 */
async function copyInto(client, table, rows, conflictKey) {
  if (rows.length === 0) return 0;
  const targetCols = await columns(client, table);
  const present = new Set();
  for (const r of rows) for (const k of Object.keys(r)) present.add(k);
  const cols = targetCols.filter((c) => present.has(c));
  const colList = cols.map(q).join(', ');
  const json = JSON.stringify(rows);
  if (conflictKey) {
    const updates = cols
      .filter((c) => c !== conflictKey)
      .map((c) => `${q(c)} = EXCLUDED.${q(c)}`)
      .join(', ');
    await client.query(
      `INSERT INTO ${q(table)} (${colList})
       SELECT ${colList} FROM jsonb_populate_recordset(NULL::${q(table)}, $1::jsonb)
       ON CONFLICT (${q(conflictKey)}) DO UPDATE SET ${updates}`,
      [json],
    );
  } else {
    await client.query(
      `INSERT INTO ${q(table)} (${colList})
       SELECT ${colList} FROM jsonb_populate_recordset(NULL::${q(table)}, $1::jsonb)`,
      [json],
    );
  }
  return rows.length;
}

function collectRefs(prodData, refMap) {
  const set = new Set();
  for (const [table, cols] of Object.entries(refMap)) {
    for (const row of prodData[table] || []) {
      for (const c of cols) if (row[c]) set.add(row[c]);
    }
  }
  return set;
}

async function main() {
  log('Meta Pacer copy: PRODUCTION → target');
  log('  source (prod):   ' + redact(PROD_URL));
  log('  target (write):  ' + redact(TARGET_URL));
  log('  mode:            ' + (APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'));
  log('');

  const prod = makePool(PROD_URL);
  const target = makePool(TARGET_URL);

  try {
    // ── Read everything from prod ──
    const prodData = {};
    for (const t of PACER_TABLES) prodData[t] = await read(prod, t);

    const accountKeys = [...collectRefs(prodData, ACCOUNT_REF_COLS)];
    const userIds = collectRefs(prodData, USER_REF_COLS);

    const accounts = accountKeys.length ? await read(prod, 'Account', 'key', accountKeys) : [];
    for (const a of accounts) for (const c of ACCOUNT_USER_REF_COLS) if (a[c]) userIds.add(a[c]);
    const userIdList = [...userIds];
    const users = userIdList.length ? await read(prod, 'User', 'id', userIdList) : [];

    // ── Report ──
    log('Prod rows to copy:');
    for (const t of PACER_TABLES) log(`  ${t.padEnd(34)} ${prodData[t].length}`);
    log('');
    const accountsExisting = await existing(target, 'Account', 'key', accountKeys);
    const usersExisting = await existing(target, 'User', 'id', userIdList);
    log(`Referenced Accounts: ${accounts.length} (in staging already: ${accountsExisting}, new: ${accounts.length - accountsExisting})`);
    log(`Referenced Users:    ${users.length} (in staging already: ${usersExisting}, new: ${users.length - usersExisting})`);
    const missingAccounts = accountKeys.length - accounts.length;
    const missingUsers = userIdList.length - users.length;
    if (missingAccounts > 0) log(`  ⚠ ${missingAccounts} referenced accountKey(s) not found in PROD (orphans) — their pacer rows would fail; investigate.`);
    if (missingUsers > 0) log(`  ⚠ ${missingUsers} referenced userId(s) not found in PROD (orphans).`);
    log('');

    if (!APPLY) {
      log('DRY RUN complete — nothing written. Re-run with --apply to perform the copy.');
      return;
    }

    // ── Apply (single transaction) ──
    const ts = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const client = await target.connect();
    try {
      await client.query('BEGIN');

      log('Snapshotting staging pacer tables → _bak_*_' + ts + ' …');
      for (const t of PACER_TABLES) {
        await client.query(`CREATE TABLE ${q('_bak_' + t + '_' + ts)} AS TABLE ${q(t)}`);
      }

      log('Upserting Users + Accounts …');
      await copyInto(client, 'User', users, 'id');
      await copyInto(client, 'Account', accounts, 'key');

      log('Clearing staging pacer tables (reverse FK order) …');
      for (const t of [...PACER_TABLES].reverse()) await client.query(`DELETE FROM ${q(t)}`);

      log('Inserting prod pacer rows (FK order) …');
      for (const t of PACER_TABLES) {
        const n = await copyInto(client, t, prodData[t]);
        log(`  ${t.padEnd(34)} ${n}`);
      }

      await client.query('COMMIT');
      log('\n✔ COMMIT — staging Meta Pacer data now matches production.');
      log(`  Rollback snapshots: _bak_<table>_${ts}  (drop them once you're satisfied).`);
    } catch (e) {
      await client.query('ROLLBACK');
      log('\n✖ ROLLBACK — nothing changed.');
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await prod.end();
    await target.end();
  }
}

main().catch((e) => {
  console.error('\n✖ Failed:', e?.message || e);
  process.exit(1);
});
