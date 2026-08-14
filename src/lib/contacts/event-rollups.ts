// Recompute the ContactEvent rollups denormalised onto Contact.
//
// RECOMPUTE, not increment. ContactEvent ingest is an upsert keyed on
// the source system's RO/deal id, so the same batch can legitimately be
// re-delivered — a nightly job that re-sends a 7-day window, a backfill,
// a bridge retry. Anything additive would double-count on every replay,
// and the drift would be invisible (nobody notices a lifetime-spend
// figure that's 15% high). Recomputing from the event table is
// idempotent by construction: run it once or fifty times, same answer.
//
// The aggregates are deliberately LIFETIME-only — see the schema comment
// on Contact. A rolling window changes with the clock rather than with
// the data, so it can't be maintained on write and would go stale
// between recomputes.

import { prisma } from '@/lib/prisma';

/** Contacts per aggregation pass. */
const CHUNK = 500;

export interface EventRollup {
  serviceVisitCount: number;
  saleCount: number;
  lifetimeSpend: number;
  firstServiceEventAt: Date | null;
  lastServiceEventAt: Date | null;
  firstSaleEventAt: Date | null;
  lastSaleEventAt: Date | null;
}

const EMPTY: EventRollup = {
  serviceVisitCount: 0,
  saleCount: 0,
  lifetimeSpend: 0,
  firstServiceEventAt: null,
  lastServiceEventAt: null,
  firstSaleEventAt: null,
  lastSaleEventAt: null,
};

/**
 * Recompute and persist rollups for the given contacts.
 *
 * Contacts with no events are reset to zero rather than skipped — an
 * event can be deleted or re-keyed, and a stale non-zero count is worse
 * than no count at all when it's deciding who lands in an ad audience.
 */
export async function recomputeContactEventRollups(
  accountKey: string,
  contactIds: string[],
): Promise<number> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const rollups = await aggregateForContacts(accountKey, slice);

    for (const contactId of slice) {
      const rollup = rollups.get(contactId) ?? EMPTY;
      await prisma.contact.update({
        where: { id: contactId },
        data: rollup,
      });
      written += 1;
    }
  }
  return written;
}

/** Aggregate the event table for a bounded set of contacts. */
async function aggregateForContacts(
  accountKey: string,
  contactIds: string[],
): Promise<Map<string, EventRollup>> {
  const grouped = await prisma.contactEvent.groupBy({
    by: ['contactId', 'type'],
    where: { accountKey, contactId: { in: contactIds } },
    _count: { _all: true },
    _sum: { amount: true },
    _min: { eventDate: true },
    _max: { eventDate: true },
  });

  const out = new Map<string, EventRollup>();
  for (const row of grouped) {
    if (!row.contactId) continue;
    const current = out.get(row.contactId) ?? { ...EMPTY };

    // Spend is the sum across BOTH event types: a service RO total and a
    // deal price are both money the customer has spent here, and
    // "lifetime value over $X" means the combined figure.
    current.lifetimeSpend += row._sum.amount ?? 0;

    if (row.type === 'service') {
      current.serviceVisitCount = row._count._all;
      current.firstServiceEventAt = row._min.eventDate;
      current.lastServiceEventAt = row._max.eventDate;
    } else if (row.type === 'sale') {
      current.saleCount = row._count._all;
      current.firstSaleEventAt = row._min.eventDate;
      current.lastSaleEventAt = row._max.eventDate;
    }

    out.set(row.contactId, current);
  }
  return out;
}
