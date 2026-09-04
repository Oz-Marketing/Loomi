/**
 * Engagement ordering for a warm-up send.
 *
 * The ramp in ./warmup.ts controls HOW MUCH goes out; this controls WHO it goes
 * to first, and that is the half that actually builds reputation. Mailbox
 * providers decide whether mail is wanted by watching what recipients do with
 * it, so a warm-up day spent on 500 people who open is worth more than one spent
 * on 500 who never will — and the never-will group is also where the bounces and
 * complaints live.
 *
 * So during warm-up the most recently engaged contacts go first and the
 * never-engaged go last. The set is unchanged; only the order is. Everyone still
 * gets the email, just on a later day.
 *
 * This runs ONLY while a cap is in force. Outside warm-up the whole audience
 * sends in one pass and the order is irrelevant, so the extra query is skipped.
 */
import { prisma } from '@/lib/prisma';

/** Only what the sort needs — callers pass their own richer recipient rows. */
export interface OrderableRecipient {
  contactId: string;
  accountKey: string;
}

/**
 * Engagement tiers, best first. A click is a stronger signal than an open, and
 * an open far stronger than a delivery nobody looked at.
 */
const TIER_CLICKED = 0;
const TIER_OPENED = 1;
const TIER_DELIVERED = 2;
const TIER_NONE = 3;

interface Rollup {
  lastEmailOpenedAt: Date | null;
  lastEmailClickedAt: Date | null;
  lastEmailDeliveredAt: Date | null;
}

function tierOf(rollup: Rollup | undefined): number {
  if (!rollup) return TIER_NONE;
  if (rollup.lastEmailClickedAt) return TIER_CLICKED;
  if (rollup.lastEmailOpenedAt) return TIER_OPENED;
  if (rollup.lastEmailDeliveredAt) return TIER_DELIVERED;
  return TIER_NONE;
}

/** Recency within a tier — the timestamp that put the contact in it. */
function recencyOf(rollup: Rollup | undefined, tier: number): number {
  if (!rollup) return 0;
  const at =
    tier === TIER_CLICKED
      ? rollup.lastEmailClickedAt
      : tier === TIER_OPENED
        ? rollup.lastEmailOpenedAt
        : rollup.lastEmailDeliveredAt;
  return at ? at.getTime() : 0;
}

/**
 * Sort `recipients` most-engaged first, using the denormalised rollups already
 * on Contact (written by the SendGrid webhook, so they're current — no
 * aggregation over EmailEvent needed here).
 *
 * Returns a new array; the input is not mutated. Recipients whose contact row is
 * missing sort last rather than being dropped — this decides ordering only, and
 * silently losing a recipient here would look identical to a send failure.
 */
export async function orderByEngagement<T extends OrderableRecipient>(
  recipients: T[],
): Promise<T[]> {
  if (recipients.length === 0) return recipients;

  const contactIds = [...new Set(recipients.map((r) => r.contactId))];
  const rows = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: {
      id: true,
      accountKey: true,
      lastEmailOpenedAt: true,
      lastEmailClickedAt: true,
      lastEmailDeliveredAt: true,
    },
  });

  // Keyed by (accountKey, contactId) to match how the blast services key
  // contacts everywhere else: a contact id is only unique within its account.
  const byKey = new Map<string, Rollup>();
  for (const row of rows) {
    byKey.set(`${row.accountKey}|${row.id}`, row);
  }

  // Decorate-sort-undecorate: tierOf/recencyOf would otherwise be recomputed on
  // every comparison, which on a six-figure audience is the difference between
  // a sort and a stall.
  return recipients
    .map((recipient, index) => {
      const rollup = byKey.get(`${recipient.accountKey}|${recipient.contactId}`);
      const tier = tierOf(rollup);
      return { recipient, tier, recency: recencyOf(rollup, tier), index };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.recency !== b.recency) return b.recency - a.recency;
      // Stable tiebreak so a re-run of the same day picks up where it left off
      // instead of reshuffling equivalent recipients.
      return a.index - b.index;
    })
    .map((entry) => entry.recipient);
}
