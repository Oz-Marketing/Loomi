/**
 * Report measured OEM publication lead times from accumulated offer history.
 *
 * READ-ONLY. Issues nothing but counts and selects; safe to run against
 * production at any time.
 *
 * WHY THIS EXISTS. `AdAutomationConfig.runWindowMode` defaults to `next_month`,
 * and `fitToWindow` treats an offer as `expired` when its end date precedes the
 * window START. If OEMs publish only current-month programs, then from the 1st
 * to roughly the 25th every live offer is "expired" against next month, and
 * generation yields nothing at all — silently, because zero eligible offers looks
 * identical to zero offers.
 *
 * `observedLeadDays` was written to settle that from real data rather than a
 * guess, and until now had no caller. This is that caller.
 *
 * Local Postgres cannot answer the question — it holds a single 2026-07-29 poll
 * of one account. Run it where the history actually lives:
 *
 *   ssh <droplet>
 *   cd /var/www/loomi-studio/current
 *   DATABASE_URL="$(pm2 env <id> | grep '^DATABASE_URL' | cut -d= -f2-)" \
 *     npx tsx scripts/report-oem-lead-times.ts
 *
 * Take DATABASE_URL from the RUNNING PROCESS, not from a file — a stale root
 * `.env` pointing at a different managed database is a trap this repo has already
 * been caught by once.
 */

import { prisma } from '@/lib/prisma';
import { observedLeadDays } from '@/lib/ad-generator/automation/offer-timing';
import { normalizeEndDate } from '@/lib/ad-generator/automation/fingerprint';

/** Host + database name only — never the credentials. */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL ?? '';
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(DATABASE_URL unset or unparseable)';
  }
}

function pad(s: string | number, n: number): string {
  return String(s).padStart(n);
}

async function main(): Promise<void> {
  console.log(`Target: ${describeTarget()}\n`);

  const total = await prisma.oemOfferSnapshot.count();
  if (total === 0) {
    console.log('No OemOfferSnapshot rows — nothing to measure.');
    return;
  }

  const rows = await prisma.oemOfferSnapshot.findMany({
    select: {
      make: true,
      model: true,
      offerType: true,
      firstSeenAt: true,
      endDate: true,
      endedAt: true,
      accountKey: true,
    },
  });

  const accounts = new Set(rows.map((r) => r.accountKey));
  const polls = new Set(rows.map((r) => r.firstSeenAt.toISOString().slice(0, 10)));
  console.log(
    `${total} snapshot row(s) · ${accounts.size} account(s) · first seen across ${polls.size} distinct day(s)`,
  );
  if (polls.size < 5) {
    console.log(
      'WARNING: too few distinct poll days to call this a measurement. Treat the numbers below as anecdote.',
    );
  }
  console.log();

  // ── lead time per make ──
  // How many days before an offer's end date we first saw it. A make that
  // publishes only for the current month clusters low; one that publishes ahead
  // shows a long tail.
  const byMake = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.make.trim().toLowerCase();
    const list = byMake.get(k);
    if (list) list.push(r);
    else byMake.set(k, [r]);
  }

  console.log('Publication lead time — days between first sighting and offer end');
  console.log('make               rows   median    min    max    n');
  for (const [make, rs] of [...byMake.entries()].sort()) {
    const m = observedLeadDays(rs.map((r) => ({ firstSeenAt: r.firstSeenAt, endDate: r.endDate })));
    console.log(
      `${make.padEnd(18)} ${pad(rs.length, 4)}  ` +
        (m
          ? `${pad(m.median, 6)} ${pad(m.min, 6)} ${pad(m.max, 6)} ${pad(m.n, 4)}`
          : '     — no dated offers'),
    );
  }
  console.log();

  // ── the decision itself ──
  // Of the offers live RIGHT NOW, how many survive each candidate window? This is
  // the number that decides `current_month` vs `next_month`, because an offer
  // ending before a window opens is rejected outright.
  const now = new Date();
  const curStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const live = rows.filter((r) => !r.endedAt);
  const dated = live
    .map((r) => normalizeEndDate(r.endDate))
    .filter((iso): iso is string => !!iso)
    .map((iso) => new Date(`${iso}T23:59:59Z`));
  const undated = live.length - dated.length;
  const survives = (from: Date) => dated.filter((d) => d.getTime() >= from.getTime()).length;

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  console.log(`Live offers on file: ${live.length} (${dated.length} dated, ${undated} undated)`);
  console.log(`  eligible for current_month (ends >= ${iso(curStart)}):  ${survives(curStart)}`);
  console.log(`  eligible for next_month    (ends >= ${iso(nextStart)}): ${survives(nextStart)}`);
  console.log();

  // ── how far past this month does anything reach? ──
  const beyond = dated.filter((d) => d.getTime() >= nextStart.getTime()).length;
  console.log(
    beyond === 0
      ? 'No live offer reaches into next month — consistent with OEMs publishing current-month only.'
      : `${beyond} live offer(s) reach into next month, so at least some makes publish ahead.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
