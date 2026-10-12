// Delivery-state writes that more than one code path makes: the suppression
// list, and a blast's sent / failed / bounced counters.
//
// The SendGrid Event Webhook is the main writer of both, but not the only one:
// the send loop rewrites the counters at the end of every pass, and the CRM
// sync and the suppression UI both write suppression rows. Each path used to
// have its own idea of how, and the differences were bugs — an unsubscribe
// overwritten to 'bounce' by a later drop (so deleting the row cleared the
// wrong SendGrid list and the address stayed blocked upstream), and counters
// nudged by increments that raced the send loop's own recount. These are the
// one way to do each, so every writer can converge on them.

import type { Prisma } from '@prisma/client';

/**
 * Suppression reasons, strongest first.
 *
 * A row holds ONE reason, and the reason is more than a label: deleting a
 * suppression clears the SendGrid list that matches it (see
 * `clearSendGridSuppression`), so a row that says 'bounce' for an address that
 * actually unsubscribed re-enables it in Loomi while SendGrid keeps dropping
 * every message to it. A weaker reason must therefore never replace a stronger
 * one:
 *
 *   spamreport  — the recipient complained. The strongest compliance and
 *                 reputation signal there is.
 *   unsubscribe — an explicit opt-out; CAN-SPAM makes it binding.
 *   manual      — an operator's deliberate decision.
 *   crm-optout  — an opt-out imported from the dealer's CRM.
 *   bounce      — a fact about deliverability, not a wish. Mailboxes come back.
 */
export const EMAIL_SUPPRESSION_PRECEDENCE = [
  'spamreport',
  'unsubscribe',
  'manual',
  'crm-optout',
  'bounce',
] as const;

export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_PRECEDENCE)[number];

/** The reasons `reason` may overwrite: strictly weaker ones, nothing else. */
export function weakerEmailSuppressionReasons(
  reason: EmailSuppressionReason,
): EmailSuppressionReason[] {
  return EMAIL_SUPPRESSION_PRECEDENCE.slice(EMAIL_SUPPRESSION_PRECEDENCE.indexOf(reason) + 1);
}

export interface EmailSuppressionWrite {
  /** Every account the row belongs on — the originating one plus its cascade. */
  accountKeys: string[];
  email: string;
  reason: EmailSuppressionReason;
  source: string;
  raw?: string | null;
}

/**
 * Suppress `email` on each account, upgrading a weaker existing reason and
 * never downgrading a stronger one.
 *
 * Two set-based statements rather than an upsert per account, because an
 * upsert cannot say "update only if weaker": insert whatever is missing
 * (ON CONFLICT DO NOTHING), then raise whatever is weaker. Both are safe
 * against a concurrent writer — the insert never turns a collision into an
 * error, and the conditional update re-checks the reason on the row it locks,
 * so two writers racing on one address both end at the stronger reason. A row
 * whose reason this code doesn't recognize is left alone, which is the
 * never-downgrade choice.
 *
 * Keys are sorted so every writer takes row locks in the same order; two
 * webhook deliveries suppressing one address from two rooftops of a group
 * could otherwise deadlock on each other's half of the cascade.
 */
export async function writeEmailSuppressions(
  db: Prisma.TransactionClient,
  input: EmailSuppressionWrite,
): Promise<void> {
  const email = input.email.toLowerCase().trim();
  const accountKeys = [...new Set(input.accountKeys.filter(Boolean))].sort();
  if (!email || accountKeys.length === 0) return;
  const raw = input.raw ?? null;

  await db.emailSuppression.createMany({
    data: accountKeys.map((accountKey) => ({
      accountKey,
      email,
      reason: input.reason,
      source: input.source,
      raw,
    })),
    skipDuplicates: true,
  });

  const weaker = weakerEmailSuppressionReasons(input.reason);
  if (weaker.length === 0) return;
  await db.emailSuppression.updateMany({
    where: { accountKey: { in: accountKeys }, email, reason: { in: weaker } },
    // createdAt is deliberately untouched: the suppression-age UX reads it,
    // and the address has been suppressed since the first row landed.
    data: { reason: input.reason, raw },
  });
}

/**
 * Rewrite a blast's sentCount / failedCount / bouncedCount from its recipient
 * rows. Call it INSIDE a transaction, after the recipient writes it should
 * reflect.
 *
 * The counters are a cache of "recipients grouped by status" — the same
 * definition `summarizeCampaign` and scripts/backfill-blast-bounce-status.ts
 * use: sent = status 'sent', failed = 'failed', bounced = 'bounced'. Nudging
 * them with increments drifted: the send loop overwrites them with a fresh
 * count at the end of each pass, so a webhook decrement landing between its
 * read and its write was lost or doubled, and on flow wrappers (whose counters
 * the flow engine never writes) a decrement from zero went negative. A
 * recount can't drift; at worst it is momentarily stale, and the next one
 * corrects it.
 *
 * The row lock comes first, as its own statement, and it is what makes two
 * concurrent recounts safe. Postgres gives each READ COMMITTED statement its
 * own snapshot; a recount that merely queued on the blast row inside its
 * UPDATE would wake holding a snapshot from BEFORE the other writer committed
 * and write a stale number over a fresh one. Locking first means the count
 * below starts after any earlier recount's transaction has committed, and
 * sees its rows.
 */
export async function recomputeEmailBlastCounters(
  db: Prisma.TransactionClient,
  campaignId: string,
): Promise<void> {
  // Physical table name: EmailBlast is @@map'd to "EmailCampaign", and raw SQL
  // naming the model fails at runtime, not at compile time.
  await db.$queryRaw`SELECT id FROM "EmailCampaign" WHERE id = ${campaignId} FOR UPDATE`;

  const groups = await db.emailBlastRecipient.groupBy({
    by: ['status'],
    where: { campaignId },
    _count: { _all: true },
  });
  const countOf = (status: string) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;

  // updateMany, not update: a blast purged since its recipient was read is
  // nothing to recount, not an error.
  await db.emailBlast.updateMany({
    where: { id: campaignId },
    data: {
      sentCount: countOf('sent'),
      failedCount: countOf('failed'),
      bouncedCount: countOf('bounced'),
    },
  });
}
