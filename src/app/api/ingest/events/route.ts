import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ingestEvents, type IngestEventInput } from '@/lib/contacts/ingest-events';

// POST /api/ingest/events
//
// Machine-to-machine ingestion of per-visit / per-deal history (service
// appointments + purchases) — the timeline/garage data the Contact row
// collapses. Same Bearer secret (OZ_INGEST_SECRET) as /api/ingest/contacts.
// Idempotent on each event's idempotencyKey, so the backfill is re-runnable.
//
// Body: { accountKey, events: [ { idempotencyKey, type, email|phone, eventDate,
//         amount, vehicle*, sourceCrm, reference, details } ] }

const MAX_EVENTS_PER_REQUEST = 2000;

function timingSafeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function presentedSecret(req: NextRequest): string {
  const header = req.headers.get('x-oz-ingest-secret')?.trim() || '';
  if (header) return header;
  const auth = req.headers.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice('bearer '.length).trim();
  return '';
}

export async function POST(req: NextRequest) {
  const expected = (process.env.OZ_INGEST_SECRET || '').trim();
  if (!expected) {
    return NextResponse.json({ error: 'OZ_INGEST_SECRET is not configured' }, { status: 500 });
  }
  const presented = presentedSecret(req);
  if (!presented || !timingSafeCompare(presented, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const accountKey = typeof body.accountKey === 'string' ? body.accountKey.trim() : '';
  if (!accountKey) {
    return NextResponse.json({ error: 'Missing accountKey' }, { status: 400 });
  }

  const events = body.events;
  if (!Array.isArray(events)) {
    return NextResponse.json({ error: 'events must be an array' }, { status: 400 });
  }
  if (events.length === 0) {
    return NextResponse.json({ totalRows: 0, created: 0, updated: 0, skipped: 0, issues: [] });
  }
  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Batch exceeds ${MAX_EVENTS_PER_REQUEST} events; split into smaller requests` },
      { status: 413 },
    );
  }

  const account = await prisma.account.findUnique({
    where: { key: accountKey },
    select: { key: true },
  });
  if (!account) {
    return NextResponse.json({ error: `Unknown accountKey: ${accountKey}` }, { status: 404 });
  }

  const summary = await ingestEvents({ accountKey, events: events as IngestEventInput[] });

  console.log(
    `[ingest:events] account=${accountKey} received=${summary.totalRows} ` +
      `created=${summary.created} updated=${summary.updated} skipped=${summary.skipped}`,
  );

  return NextResponse.json(summary);
}
