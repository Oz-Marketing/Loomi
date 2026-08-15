/**
 * Tracked-call ingest — the write half of `/api/ingest/calls`.
 *
 * Mirrors `ingest-events.ts`: idempotent on a per-row key so the Sunday
 * full-history sweep is safe to re-run, and tolerant of a bad row rather than
 * failing the batch (one malformed call must not cost a dealer the other 400).
 *
 * NO CONTACT LINKING. `ingestEvents` resolves a contact by email/phone; this
 * deliberately does not, because doing so would mean carrying the caller's
 * phone number across the bridge — see the `CallEvent` model comment. Calls are
 * reported in aggregate; they are not part of a person's timeline.
 */
import { prisma } from '@/lib/prisma';

export interface IngestCallInput {
  idempotencyKey?: unknown;
  occurredAt?: unknown;
  status?: unknown;
  durationSeconds?: unknown;
  trackerName?: unknown;
  callerCity?: unknown;
  callerState?: unknown;
  callerZip?: unknown;
}

export interface IngestCallsSummary {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
  issues: { index: number; reason: string }[];
}

const MAX_ISSUES = 20;

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

function coerceDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Seconds, non-negative. Null for anything unusable — never a silent 0. */
function coerceDuration(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Statuses are lowercased so the report's `answered` comparison is stable —
 * the tracker has been seen to send both "Answered" and "answered", and a
 * case-sensitive match would split one status into two rows and halve the
 * reported answer rate.
 */
function coerceStatus(v: unknown): string {
  return str(v)?.toLowerCase() ?? 'unknown';
}

export async function ingestCalls(input: {
  accountKey: string;
  calls: IngestCallInput[];
}): Promise<IngestCallsSummary> {
  const { accountKey, calls } = input;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const issues: IngestCallsSummary['issues'] = [];

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const key = str(c.idempotencyKey);
    const occurredAt = coerceDate(c.occurredAt);

    // A call with no stable key can't be re-pushed safely, and one with no
    // timestamp can't be placed in any of the six summaries — both are
    // skipped loudly rather than stored as junk.
    if (!key || !occurredAt) {
      skipped += 1;
      if (issues.length < MAX_ISSUES) {
        issues.push({
          index: i,
          reason: !key ? 'Missing idempotencyKey' : 'Missing or invalid occurredAt',
        });
      }
      continue;
    }

    const data = {
      accountKey,
      occurredAt,
      status: coerceStatus(c.status),
      durationSeconds: coerceDuration(c.durationSeconds),
      trackerName: str(c.trackerName),
      callerCity: str(c.callerCity),
      callerState: str(c.callerState),
      callerZip: str(c.callerZip),
    };

    try {
      const existing = await prisma.callEvent.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (existing) {
        await prisma.callEvent.update({ where: { idempotencyKey: key }, data });
        updated += 1;
      } else {
        await prisma.callEvent.create({ data: { idempotencyKey: key, ...data } });
        created += 1;
      }
    } catch (err) {
      skipped += 1;
      if (issues.length < MAX_ISSUES) {
        issues.push({ index: i, reason: err instanceof Error ? err.message : 'Upsert failed' });
      }
    }
  }

  return { totalRows: calls.length, created, updated, skipped, issues };
}
