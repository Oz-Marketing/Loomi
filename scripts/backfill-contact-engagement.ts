// Backfill Contact engagement rollups from existing EmailEvent /
// SmsEvent history.
//
// The messaging fields (hasOpenedEmail, lastMessageDate, …) used to be
// computed at read time by aggregating those event tables. They're now
// denormalised columns, written forward by the SendGrid/Twilio webhook
// handlers as events arrive. Without this backfill the columns start
// null, so on the day the change ships every engagement segment would
// read as "nobody has ever opened anything" until new events trickle in.
//
// Idempotent and re-runnable: it recomputes each contact's rollups from
// the full event history and writes the max, so running it twice (or
// after the webhooks have already moved a value forward) converges on
// the same answer rather than double-counting.
//
// Events join to contacts through the blast recipient rows, which carry
// contactId — the same path the old read-time aggregate used, so the
// backfilled values match what the API would previously have reported.
//
//   npx tsx scripts/backfill-contact-engagement.ts [--dry-run]

// Deploy scripts run via `npx tsx` outside Next's env loading, so pull
// .env in explicitly — matching how the DB-backed tests bootstrap.
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Contacts per batch. Each batch issues a handful of grouped aggregate
// queries, so this trades round-trips against statement size.
const BATCH = 500;

interface Rollup {
  lastEmailDeliveredAt?: Date;
  lastEmailOpenedAt?: Date;
  lastEmailClickedAt?: Date;
  lastSmsAt?: Date;
}

async function main() {
  // Runs on every deploy, but the work is one-time: once the columns are
  // populated the webhook handlers keep them current. Skip when any
  // contact already carries a rollup, so this doesn't become a
  // full-table scan on every release.
  //
  // Ordering makes this safe: deploys run `db push` → this script → app
  // start, so the first deploy after the columns land sees them all null
  // and does the work. `--force` recomputes regardless (use it if event
  // history was imported after the fact).
  if (!FORCE) {
    const alreadyPopulated = await prisma.contact.findFirst({
      where: { lastMessageAt: { not: null } },
      select: { id: true },
    });
    if (alreadyPopulated) {
      console.log('Engagement rollups already populated — skipping (pass --force to recompute).');
      return;
    }
  }

  const total = await prisma.contact.count();
  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Backfilling engagement rollups for ${total.toLocaleString()} contacts…`,
  );

  let cursor: string | undefined;
  let processed = 0;
  let updated = 0;

  for (;;) {
    const contacts = await prisma.contact.findMany({
      select: { id: true, accountKey: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (contacts.length === 0) break;

    const ids = contacts.map((c) => c.id);
    const rollups = new Map<string, Rollup>();

    // ── Email: delivered / open / click, newest per contact ──
    const emailRows = await prisma.emailBlastRecipient.findMany({
      where: { contactId: { in: ids } },
      select: {
        contactId: true,
        events: {
          where: { eventType: { in: ['delivered', 'open', 'click'] } },
          select: { eventType: true, timestamp: true },
        },
      },
    });
    for (const row of emailRows) {
      if (!row.contactId) continue;
      const current = rollups.get(row.contactId) ?? {};
      for (const ev of row.events) {
        const key =
          ev.eventType === 'delivered'
            ? 'lastEmailDeliveredAt'
            : ev.eventType === 'open'
              ? 'lastEmailOpenedAt'
              : 'lastEmailClickedAt';
        current[key] = maxDate(current[key], ev.timestamp);
      }
      rollups.set(row.contactId, current);
    }

    // ── SMS: sent / delivered, newest per contact ──
    const smsRows = await prisma.smsBlastRecipient.findMany({
      where: { contactId: { in: ids } },
      select: {
        contactId: true,
        events: {
          where: { eventType: { in: ['sent', 'delivered'] } },
          select: { timestamp: true },
        },
      },
    });
    for (const row of smsRows) {
      if (!row.contactId) continue;
      const current = rollups.get(row.contactId) ?? {};
      for (const ev of row.events) {
        current.lastSmsAt = maxDate(current.lastSmsAt, ev.timestamp);
      }
      rollups.set(row.contactId, current);
    }

    for (const [contactId, rollup] of rollups) {
      // lastMessageAt is the union of "a message actually reached them"
      // across both channels — deliveries and SMS sends, not opens.
      const lastMessageAt = maxDate(rollup.lastEmailDeliveredAt, rollup.lastSmsAt);
      const data = { ...rollup, ...(lastMessageAt ? { lastMessageAt } : {}) };
      if (Object.keys(data).length === 0) continue;

      if (!DRY_RUN) {
        await prisma.contact.update({ where: { id: contactId }, data });
      }
      updated++;
    }

    processed += contacts.length;
    cursor = contacts[contacts.length - 1].id;
    if (processed % 5000 === 0 || contacts.length < BATCH) {
      console.log(`  …${processed.toLocaleString()}/${total.toLocaleString()} scanned, ${updated.toLocaleString()} with history`);
    }
    if (contacts.length < BATCH) break;
  }

  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}Done — ${processed.toLocaleString()} contacts scanned, ${updated.toLocaleString()} updated.`,
  );
}

function maxDate(a: Date | undefined, b: Date | null | undefined): Date | undefined {
  if (!b) return a;
  if (!a) return b;
  return b > a ? b : a;
}

main()
  .catch((err) => {
    console.error('[backfill-contact-engagement] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
