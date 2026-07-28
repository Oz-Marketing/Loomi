// Ingest run bookkeeping — the heartbeat behind the contact-sync health
// check (GET /api/internal/contact-sync/health).
//
// Every accepted batch on /api/ingest/contacts and /api/ingest/events
// writes one IngestRun row. That row is what lets monitoring tell the
// difference between:
//
//   - the sync ran and the rolling window held nothing new (fine), and
//   - the sync stopped running days ago (not fine),
//
// which are otherwise indistinguishable — both leave every Contact row
// untouched. Contact.updatedAt alone can't carry this signal.

import { prisma } from '@/lib/prisma';

export type IngestKind = 'contacts' | 'events';

export interface IngestRunRecord {
  accountKey: string;
  kind: IngestKind;
  source?: string | null;
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  issueCount: number;
}

/**
 * Record one ingest batch.
 *
 * Never throws: this is telemetry, and a failure to write the audit row
 * must not turn an otherwise-successful contact upsert into a 500 that
 * makes the bridge retry (and re-upsert) the whole batch. On failure we
 * log loudly — a run that silently stops being recorded would make the
 * health check cry wolf, so it needs to be visible in the app logs.
 */
export async function recordIngestRun(run: IngestRunRecord): Promise<void> {
  try {
    await prisma.ingestRun.create({
      data: {
        accountKey: run.accountKey,
        kind: run.kind,
        source: run.source ?? null,
        totalRows: run.totalRows,
        created: run.created,
        updated: run.updated,
        skipped: run.skipped,
        issueCount: run.issueCount,
      },
    });
  } catch (err) {
    console.error(
      `[ingest:run-log] failed to record ${run.kind} run for ${run.accountKey}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
