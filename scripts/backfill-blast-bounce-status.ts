// Reclassify delivery-time bounces on already-sent blasts.
//
// Bounces and carrier refusals used to be written onto the recipient row as
// `failed`, which fed `sentCount > 0 && failedCount > 0` and rendered a
// healthy send as "Sent with errors" — an alarm the client could do nothing
// about, on a blast that had worked. They now have their own statuses
// (`bounced` / `undelivered`) and their own counters; this brings the history
// into line so past blasts stop reporting the same false alarm.
//
// Four set-based statements, no per-row loop: production carries hundreds of
// thousands of recipient rows and the deploy's SSH step dies at 15 minutes.
//
// Idempotent by construction — every statement recomputes from the recipient
// rows, so a second run reclassifies nothing and rewrites the same counts. No
// global "already done?" guard, deliberately: a run cut short must be able to
// resume, and a guard would look satisfied and skip the rest forever.
//
//   npx tsx scripts/backfill-blast-bounce-status.ts [--dry-run]

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

// NOTE on the table names below: these four models all carry an @@map to
// their pre-rename physical names — EmailBlast is "EmailCampaign",
// SmsBlastRecipient is "SmsCampaignRecipient", and so on. Raw SQL has to use
// the physical name; the Prisma model name silently fails at runtime.

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * How a bounce is told apart from a real dispatch failure.
 *
 * The SendGrid webhook wrote these errors as `${eventType}${reason}`, so a
 * bounce row's error always starts with the literal event name. Dispatch
 * failures come from the send loop and start with 'SendGrid: ', an exception
 * message, or 'Account is not configured…' — none of which can collide.
 * Matching on the prefix rather than the reason text keeps a bounce message
 * that happens to quote an SMTP string from dragging a real failure with it.
 */
const EMAIL_BOUNCE_PREFIXES = ['bounce', 'dropped'];
/** Twilio's callback wrote `undelivered: <carrier message>` the same way. */
const SMS_UNDELIVERED_PREFIX = 'undelivered';

/**
 * The exact error text the send path used to write for an address it chose
 * not to attempt. Matched in full rather than by prefix — it is a fixed
 * string we control, and the replacement wording lives in email-blasts.ts.
 */
const LEGACY_HYGIENE_ERRORS = [
  'Recipient email is missing or blocked by hygiene policy',
] as const;

async function main() {
  const label = DRY_RUN ? '[dry-run] would reclassify' : 'reclassified';

  // ── 1. Email recipients: failed + bounce-shaped error → bounced ──
  const emailRows = DRY_RUN
    ? await prisma.emailBlastRecipient.count({
        where: {
          status: 'failed',
          OR: EMAIL_BOUNCE_PREFIXES.map((prefix) => ({
            error: { startsWith: prefix },
          })),
        },
      })
    : await prisma.$executeRaw`
        UPDATE "EmailCampaignRecipient"
           SET status = 'bounced'
         WHERE status = 'failed'
           AND (error LIKE 'bounce%' OR error LIKE 'dropped%')
      `;
  console.log(`[blast-bounce] ${label} ${emailRows} email recipient row(s)`);

  // ── 2. SMS recipients: failed + carrier-refusal error → undelivered ──
  const smsRows = DRY_RUN
    ? await prisma.smsBlastRecipient.count({
        where: {
          status: 'failed',
          error: { startsWith: SMS_UNDELIVERED_PREFIX },
        },
      })
    : await prisma.$executeRaw`
        UPDATE "SmsCampaignRecipient"
           SET status = 'undelivered'
         WHERE status = 'failed'
           AND error LIKE 'undelivered%'
      `;
  console.log(`[blast-bounce] ${label} ${smsRows} SMS recipient row(s)`);

  // ── 3. Addresses we never attempted → skipped, not failed ──
  //
  // An address missing or on a domain that cannot receive mail was recorded
  // as a send failure, though nothing was ever sent to it. It is a decision,
  // like a suppression, and belongs in the same bucket.
  const hygieneRows = DRY_RUN
    ? await prisma.emailBlastRecipient.count({
        where: { status: 'failed', error: { in: [...LEGACY_HYGIENE_ERRORS] } },
      })
    : await prisma.$executeRaw`
        UPDATE "EmailCampaignRecipient"
           SET status = 'skipped'
         WHERE status = 'failed'
           AND error = 'Recipient email is missing or blocked by hygiene policy'
      `;
  console.log(`[blast-bounce] ${label} ${hygieneRows} never-attempted address(es)`);

  if (DRY_RUN) {
    console.log('[blast-bounce] dry run — counters and statuses left alone');
    return;
  }

  // ── 4. Recompute each blast's counters from its recipients ──
  //
  // One aggregate per table rather than per blast. The counters drifted from
  // the rows anyway (they were written once at send time while bounce
  // webhooks landed for hours afterwards), so this is a repair as well as a
  // migration — recomputing from the rows is the only way to get an answer
  // that ties out.
  //
  // `sentCount` is recomputed too: the webhook decremented it when it flipped
  // a row, and a run of this script must not double-count that.
  const emailCounts = await prisma.$executeRaw`
    UPDATE "EmailCampaign" b
       SET "sentCount"    = c.sent,
           "failedCount"  = c.failed,
           "bouncedCount" = c.bounced
      FROM (
        SELECT "campaignId",
               COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
               COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
               COUNT(*) FILTER (WHERE status = 'bounced') AS bounced
          FROM "EmailCampaignRecipient"
         GROUP BY "campaignId"
      ) c
     WHERE b.id = c."campaignId"
       AND (b."sentCount"    IS DISTINCT FROM c.sent
        OR  b."failedCount"  IS DISTINCT FROM c.failed
        OR  b."bouncedCount" IS DISTINCT FROM c.bounced)
  `;
  console.log(`[blast-bounce] recomputed counters on ${emailCounts} email blast(s)`);

  const smsCounts = await prisma.$executeRaw`
    UPDATE "SmsCampaign" b
       SET "sentCount"        = c.sent,
           "failedCount"      = c.failed,
           "undeliveredCount" = c.undelivered
      FROM (
        SELECT "campaignId",
               COUNT(*) FILTER (WHERE status = 'sent')        AS sent,
               COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
               COUNT(*) FILTER (WHERE status = 'undelivered') AS undelivered
          FROM "SmsCampaignRecipient"
         GROUP BY "campaignId"
      ) c
     WHERE b.id = c."campaignId"
       AND (b."sentCount"        IS DISTINCT FROM c.sent
        OR  b."failedCount"      IS DISTINCT FROM c.failed
        OR  b."undeliveredCount" IS DISTINCT FROM c.undelivered)
  `;
  console.log(`[blast-bounce] recomputed counters on ${smsCounts} SMS blast(s)`);

  // ── 5. Demote 'partial' blasts that only ever bounced ──
  //
  // Mirrors resolveBlastStatus: 'partial' means some dispatched and some
  // could not be dispatched. A blast with zero remaining dispatch failures
  // never qualified; it just had no other way to be recorded at the time.
  //
  // `error` is cleared with it — that column held the first recipient error,
  // which for these rows is a bounce message, and it is what the failure
  // banner reads for its detail line.
  //
  // Terminal statuses only. A blast still processing resolves its own status
  // when it finishes, and touching one mid-flight would race the worker.
  const emailStatus = await prisma.$executeRaw`
    UPDATE "EmailCampaign"
       SET status = 'completed', error = NULL
     WHERE status = 'partial'
       AND "failedCount" = 0
       AND "sentCount" > 0
  `;
  console.log(`[blast-bounce] ${emailStatus} email blast(s) no longer report errors`);

  const smsStatus = await prisma.$executeRaw`
    UPDATE "SmsCampaign"
       SET status = 'completed', error = NULL
     WHERE status = 'partial'
       AND "failedCount" = 0
       AND "sentCount" > 0
  `;
  console.log(`[blast-bounce] ${smsStatus} SMS blast(s) no longer report errors`);
}

main()
  .catch((err) => {
    console.error('[blast-bounce] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
