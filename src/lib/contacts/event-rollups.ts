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
// SET-BASED, not row-by-row. The first version issued one UPDATE per
// contact. Harmless for the ingest path, where a batch touches a handful
// of customers — catastrophic for a backfill: on production's 259,307
// contacts-with-history it was still going after 11 minutes and took the
// deploy down with it. Both entry points are now a single statement per
// account.
//
// AND IT WRITES ONLY WHAT CHANGED. Set-based alone was still not enough.
// Rewriting every contact-with-history on every deploy cost ~88s for one
// 17.7k rooftop — an UPDATE to an identical value still forces a new MVCC
// tuple, seven index entries and a WAL record. On 2026-08-16 that blew the
// deploy's 15-minute SSH budget 23 accounts into 34. `applyUpdate` now
// carries an IS DISTINCT FROM guard, so a steady-state run writes nothing.
// See its doc comment before removing it.
//
// The aggregates are deliberately LIFETIME-only — see the schema comment
// on Contact. A rolling window changes with the clock rather than with
// the data, so it can't be maintained on write and would go stale
// between recomputes.

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * The aggregate itself, shared by both entry points so the targeted
 * recompute and the whole-account backfill can't drift apart.
 *
 * `lifetimeSpend` sums across BOTH event types: a service RO total and a
 * deal price are both money the customer spent here, and "lifetime value
 * over $X" means the combined figure.
 */
function aggregateSelect(accountKey: string, scope: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      "contactId",
      COUNT(*) FILTER (WHERE "type" = 'service')                      AS service_count,
      COUNT(*) FILTER (WHERE "type" = 'sale')                         AS sale_count,
      COALESCE(SUM("amount"), 0)                                      AS spend,
      MIN("eventDate") FILTER (WHERE "type" = 'service')              AS first_service,
      MAX("eventDate") FILTER (WHERE "type" = 'service')              AS last_service,
      MIN("eventDate") FILTER (WHERE "type" = 'sale')                 AS first_sale,
      MAX("eventDate") FILTER (WHERE "type" = 'sale')                 AS last_sale
    FROM "ContactEvent"
    WHERE "accountKey" = ${accountKey}
      AND "contactId" IS NOT NULL
      ${scope}
    GROUP BY "contactId"
  `;
}

/**
 * Apply the aggregate, SKIPPING rows whose values already match.
 *
 * Being set-based was necessary but not sufficient. One UPDATE per account
 * still rewrote every contact-with-history on every run, and in Postgres an
 * UPDATE is never free even when the new value equals the old one: MVCC writes
 * a whole new tuple, seven indexed columns get new entries, and it all goes
 * through WAL. On production that was ~88s for a single 17.7k-contact rooftop,
 * and the deploy's 15-minute SSH budget ran out 23 accounts into 34 — killing
 * the release even though the numbers had not changed since the last deploy.
 *
 * The `IS DISTINCT FROM` predicate makes the steady-state case write nothing.
 * The aggregate still runs for every account every time, so this is NOT the
 * "already populated?" skip guard the backfill's header warns about — that one
 * looked satisfied after a partial run and abandoned the remaining rooftops
 * forever. Here every account is still visited and every contact still
 * compared; only the redundant WRITE is skipped, so a genuinely stale row is
 * still found and fixed on the next run.
 *
 * `IS DISTINCT FROM` rather than `<>` because four of these columns are
 * nullable, and `NULL <> NULL` is NULL — which would drop exactly the rows
 * that need fixing. Casts are explicit so COUNT's bigint and SUM's numeric
 * don't compare as "different" against the int4/float8 columns forever.
 */
function applyUpdate(accountKey: string, agg: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    UPDATE "Contact" c SET
      "serviceVisitCount"   = agg.service_count,
      "saleCount"           = agg.sale_count,
      "lifetimeSpend"       = agg.spend,
      "firstServiceEventAt" = agg.first_service,
      "lastServiceEventAt"  = agg.last_service,
      "firstSaleEventAt"    = agg.first_sale,
      "lastSaleEventAt"     = agg.last_sale
    FROM (${agg}) agg
    WHERE c."id" = agg."contactId"
      AND c."accountKey" = ${accountKey}
      AND (
        c."serviceVisitCount"   IS DISTINCT FROM agg.service_count::int
        OR c."saleCount"        IS DISTINCT FROM agg.sale_count::int
        OR c."lifetimeSpend"    IS DISTINCT FROM agg.spend::double precision
        OR c."firstServiceEventAt" IS DISTINCT FROM agg.first_service
        OR c."lastServiceEventAt"  IS DISTINCT FROM agg.last_service
        OR c."firstSaleEventAt"    IS DISTINCT FROM agg.first_sale
        OR c."lastSaleEventAt"     IS DISTINCT FROM agg.last_sale
      )
  `;
}

/**
 * Recompute rollups for specific contacts — the ingest path, called with
 * whoever a batch touched.
 *
 * Contacts in `contactIds` with no events are reset to zero rather than
 * skipped: an event can be deleted or re-keyed, and a stale non-zero
 * count is worse than no count at all when it's deciding who lands in an
 * ad audience.
 */
export async function recomputeContactEventRollups(
  accountKey: string,
  contactIds: string[],
): Promise<number> {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  const scope = Prisma.sql`AND "contactId" IN (${Prisma.join(ids)})`;
  const updated = await prisma.$executeRaw(
    applyUpdate(accountKey, aggregateSelect(accountKey, scope)),
  );

  // Zero out anyone in the set whose events have all gone away. Scoped
  // to the ids we were asked about, and skipped entirely when they're
  // already zero so this doesn't churn rows on every ingest.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "Contact" c SET
      "serviceVisitCount"   = 0,
      "saleCount"           = 0,
      "lifetimeSpend"       = 0,
      "firstServiceEventAt" = NULL,
      "lastServiceEventAt"  = NULL,
      "firstSaleEventAt"    = NULL,
      "lastSaleEventAt"     = NULL
    WHERE c."accountKey" = ${accountKey}
      AND c."id" IN (${Prisma.join(ids)})
      AND NOT EXISTS (
        SELECT 1 FROM "ContactEvent" e
        WHERE e."contactId" = c."id" AND e."accountKey" = ${accountKey}
      )
      AND (c."serviceVisitCount" <> 0 OR c."saleCount" <> 0 OR c."lifetimeSpend" <> 0
           OR c."lastServiceEventAt" IS NOT NULL OR c."lastSaleEventAt" IS NOT NULL)
  `);

  return updated;
}

/**
 * Recompute every contact in an account that has event history — the
 * backfill path.
 *
 * One statement for the whole account. Contacts with no events are left
 * alone rather than zeroed: they're already at the column defaults, and
 * touching all 265k of them would be a pointless rewrite of the table.
 */
export async function recomputeAllContactEventRollups(
  accountKey: string,
): Promise<number> {
  return prisma.$executeRaw(
    applyUpdate(accountKey, aggregateSelect(accountKey, Prisma.empty)),
  );
}
