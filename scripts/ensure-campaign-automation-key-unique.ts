/**
 * Create Campaign's `automationKey` column + unique index, and key the rows
 * that already exist.
 *
 * WHY. `automationKey` (`adgen:<accountKey>:<yyyy-mm>`) makes the OEM offer
 * run land in ONE campaign per account per cycle. The unique index is what
 * turns "already have this month's container" from a race between two
 * overlapping runs into a fact.
 *
 * It's a script rather than only `@unique` in the schema because `db push`
 * refuses to add a unique constraint to an existing table unsupervised — same
 * reason and shape as ensure-emailcampaign-automation-key-unique.ts, and it
 * runs in `deploy:prepare` BEFORE `db push` for the same reason.
 *
 * THE BACKFILL. Existing automation campaigns were created by the email step
 * with no key. Each gets one from the month of the run window its ads were
 * built for (newest linked AdAutomationRun's `detail.window.start`), or from
 * `createdAt` when no run is linked — equal to the runtime key only for
 * `current_month` accounts, which is why the run is preferred. Two rows
 * resolving to one key: the newest keeps it, the rest are archived (the old
 * fingerprint key had already produced duplicates in dev). Rows still carrying
 * the generated name "<dealer> — current offers" are renamed to the month
 * form; hand-renamed rows are left alone. A single still-draft offer email on a
 * container is re-keyed to the cycle key so the first cycle-keyed run refreshes
 * it instead of filing a second draft; sent or scheduled ones are untouched.
 *
 * Idempotent: catalog checks for the column and index, and the backfill only
 * touches rows with a null key.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';

const TAG = '[ensure-campaign-automation-key-unique]';
const INDEX = 'Campaign_automationKey_key';

function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function labelOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(`${TAG} DATABASE_URL is not set`);
    process.exit(1);
  }
  const needsSsl = /[?&]sslmode=require/.test(connectionString);
  const cleanUrl = connectionString.replace(/[?&]sslmode=require/, (m) => (m.startsWith('?') ? '?' : '')).replace(/\?$/, '');
  const pool = new pg.Pool({ connectionString: cleanUrl, ...(needsSsl && { ssl: { rejectUnauthorized: false } }) });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [{ exists }] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT to_regclass('public."Campaign"') IS NOT NULL AS exists`,
    );
    if (!exists) {
      console.log(`${TAG} Campaign does not exist yet — nothing to do`);
      return;
    }

    await prisma.$executeRawUnsafe(`ALTER TABLE public."Campaign" ADD COLUMN IF NOT EXISTS "automationKey" TEXT`);

    // ── backfill, before the index so duplicates can be resolved rather than refused ──
    const unkeyed = await prisma.$queryRawUnsafe<
      { id: string; accountKey: string | null; name: string; createdAt: Date; archivedAt: Date | null; dealer: string | null }[]
    >(
      `SELECT c.id, c."accountKey", c.name, c."createdAt", c."archivedAt", a.dealer
         FROM public."Campaign" c LEFT JOIN public."Account" a ON a.key = c."accountKey"
        WHERE c.source = 'automation' AND c."automationKey" IS NULL`,
    );
    let keyed = 0;
    let renamed = 0;
    let archivedDupes = 0;
    let rekeyedBlasts = 0;
    const byKey = new Map<string, { id: string; createdAt: Date; archived: boolean }[]>();

    for (const c of unkeyed) {
      if (!c.accountKey) continue;
      // The month the ads were FOR: the newest run linked to this container.
      const runs = await prisma.$queryRawUnsafe<{ detail: string | null }[]>(
        `SELECT r.detail FROM public."AdCreative" ad
           JOIN public."AdAutomationRun" r ON r.id = ad."runId"
          WHERE ad."campaignId" = $1 ORDER BY r."startedAt" DESC LIMIT 1`,
        c.id,
      );
      let month: string | null = null;
      try {
        const start = runs[0]?.detail ? JSON.parse(runs[0].detail)?.window?.start : null;
        if (start) month = monthOf(new Date(start));
      } catch {
        month = null;
      }
      if (!month) month = monthOf(new Date(c.createdAt));
      const key = `adgen:${c.accountKey}:${month}`;
      const list = byKey.get(key) ?? [];
      list.push({ id: c.id, createdAt: new Date(c.createdAt), archived: !!c.archivedAt });
      byKey.set(key, list);

      if (c.dealer && c.name === `${c.dealer} — current offers`) {
        await prisma.$executeRawUnsafe(`UPDATE public."Campaign" SET name = $2 WHERE id = $1`, c.id, `${labelOf(month)} offers — ${c.dealer}`);
        renamed += 1;
      }
    }

    for (const [key, rows] of byKey) {
      // Newest keeps the key; the rest are archived so the index can be built.
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const [keep, ...rest] = rows;
      await prisma.$executeRawUnsafe(`UPDATE public."Campaign" SET "automationKey" = $2 WHERE id = $1`, keep.id, key);
      keyed += 1;
      for (const r of rest) {
        if (!r.archived) {
          await prisma.$executeRawUnsafe(
            `UPDATE public."Campaign" SET status = 'archived', "archivedAt" = NOW() WHERE id = $1`,
            r.id,
          );
        }
        archivedDupes += 1;
      }
      // One still-draft offer email on the kept container follows it onto the cycle key.
      const drafts = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public."EmailCampaign" WHERE "campaignId" = $1 AND status = 'draft' AND "automationKey" IS NOT NULL`,
        keep.id,
      );
      if (drafts.length === 1) {
        const taken = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public."EmailCampaign" WHERE "automationKey" = $1 AND id <> $2`,
          key,
          drafts[0].id,
        );
        if (taken.length === 0) {
          await prisma.$executeRawUnsafe(`UPDATE public."EmailCampaign" SET "automationKey" = $2 WHERE id = $1`, drafts[0].id, key);
          rekeyedBlasts += 1;
        }
      }
    }
    if (unkeyed.length) {
      console.log(`${TAG} keyed ${keyed} campaign(s), renamed ${renamed}, archived ${archivedDupes} duplicate(s), re-keyed ${rekeyedBlasts} draft email(s)`);
    }

    const already = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
      INDEX,
    );
    if (already.length > 0) {
      console.log(`${TAG} ${INDEX} already present — no-op`);
      return;
    }
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX "${INDEX}" ON public."Campaign" ("automationKey")`);
    console.log(`${TAG} created ${INDEX}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`${TAG} failed:`, err);
  process.exit(1);
});
