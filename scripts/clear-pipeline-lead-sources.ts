// Clear ingest-pipeline labels out of Contact.source.
//
// The bridge labels each batch by feed ("oz-reports:automotive"), and the
// contacts ingest applied that batch label to any row without its own source.
// Rows from the automotive feed carry no per-contact source, so all of them
// inherited it — and `Contact.source` is what the Lead Performance report
// groups by, so the pipeline's own name was rendering to clients as their
// single biggest lead source, ahead of CDK and Dealer Website.
//
// The ingest no longer does this (see isPipelineSource in lib/contacts/ingest).
// This clears the rows already written.
//
// NULL rather than a placeholder: the report already folds null into "Unknown
// source" and its breakdown sums to the headline, so null is both honest and
// already handled. Provenance is not lost — IngestRun.source records which feed
// each batch came from, which is its documented job.
//
// One set-based UPDATE. Idempotent: after the first run nothing matches.
//
// DELIBERATELY NOT IN THE DEPLOY CHAIN. On production this touches ~255k of
// ~265k contacts (217,780 oz-reports:automotive + 37,804 oz-reports:powersports)
// — essentially the whole table. The deploy's SSH step already runs close to
// its 15-minute ceiling and was blown by a backfill of exactly this size a few
// hours ago. Run it ONCE, by hand, out of band:
//
//   npx tsx scripts/clear-pipeline-lead-sources.ts --dry-run   # counts only
//   npx tsx scripts/clear-pipeline-lead-sources.ts
//
// Checked before writing this: 44 audiences exist in production and none filter
// on `source`, so clearing it changes no audience membership and therefore no
// synced ad-platform list. Re-check with the same query if that changes —
// `source` IS an available smart-list filter field, it just is not used yet.

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

const DRY_RUN = process.argv.includes('--dry-run');

// Must stay in step with isPipelineSource() in src/lib/contacts/ingest.ts.
// Posix regex, case-insensitive, anchored: 'oz-reports' or 'oz-reports:<feed>'.
const PIPELINE_PATTERN = '^oz-reports(:|$)';

async function main() {
  const [{ n: affected }] = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM "Contact"
    WHERE "source" ~* ${PIPELINE_PATTERN}
  `;

  if (affected === 0) {
    console.log('[clear-pipeline-lead-sources] No pipeline labels in Contact.source.');
    return;
  }

  const breakdown = await prisma.$queryRaw<{ source: string; n: number }[]>`
    SELECT "source", count(*)::int AS n
    FROM "Contact"
    WHERE "source" ~* ${PIPELINE_PATTERN}
    GROUP BY "source"
    ORDER BY n DESC
  `;
  for (const b of breakdown) {
    console.log(`  ${b.source}: ${b.n.toLocaleString()} contact(s)`);
  }

  if (DRY_RUN) {
    console.log(`[dry run] Would clear ${affected.toLocaleString()} Contact.source value(s).`);
    return;
  }

  const started = Date.now();
  const updated = await prisma.$executeRaw`
    UPDATE "Contact"
    SET "source" = NULL
    WHERE "source" ~* ${PIPELINE_PATTERN}
  `;
  console.log(
    `[clear-pipeline-lead-sources] Cleared ${updated.toLocaleString()} in ${Date.now() - started}ms.`,
  );
}

main()
  .catch((err) => {
    console.error('[clear-pipeline-lead-sources] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
